import { closeSync, openSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  execFileAsync,
  findAvailablePort,
  findPostgresBin,
  readRuntimeState,
  removeRuntimeState,
  repositoryRoot,
  runtimeRoot,
  runtimeStatePath,
  terminateProcessGroup,
  waitForHttp,
  waitForPage,
} from './runtime-lib.mjs';

try {
  const existing = await readRuntimeState();
  await waitForHttp(existing.endpoints.api, 'api', 1_000);
  process.stdout.write(
    `Drone.Works local runtime is already running at ${existing.endpoints.web}.\n`,
  );
  process.exit(0);
} catch {
  await removeRuntimeState();
}

const postgresBin = await findPostgresBin();
const ports = {
  api: await findAvailablePort(),
  dispatcher: await findAvailablePort(),
  email: await findAvailablePort(),
  objects: await findAvailablePort(),
  postgres: await findAvailablePort(),
  web: await findAvailablePort(),
  worker: await findAvailablePort(),
};
const postgresData = join(runtimeRoot, 'postgres', 'data');
const postgresSocket = join(runtimeRoot, 'postgres', 'socket');
const logs = join(runtimeRoot, 'logs');
const localKmsKeyFile = join(runtimeRoot, 'dji-cache-key.bin');
const verifiedAuthEnabled = process.env.DRONE_WORKS_AUTH_ENABLED === 'true';
const localIdentityEnabled = !verifiedAuthEnabled;
const authSecret = verifiedAuthEnabled
  ? randomBytes(32).toString('base64url')
  : '';
const processRecords = [];
let postgresStarted = false;

function spawnService(
  name,
  command,
  args,
  environment,
  workingDirectory = repositoryRoot,
) {
  const logPath = join(logs, `${name}.log`);
  const descriptor = openSync(logPath, 'a');
  const child = spawn(command, args, {
    cwd: workingDirectory,
    detached: true,
    env: { ...process.env, ...environment },
    stdio: ['ignore', descriptor, descriptor],
  });
  closeSync(descriptor);
  child.unref();
  processRecords.push({ name, pid: child.pid, log: logPath });
}

async function runPnpm(args, environment = {}) {
  const executable = process.env.npm_execpath;
  if (!executable) {
    throw new Error(
      'Run local development commands through the pinned pnpm script.',
    );
  }
  await execFileAsync(process.execPath, [executable, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    maxBuffer: 20 * 1024 * 1024,
  });
}

try {
  await mkdir(postgresSocket, { recursive: true });
  await mkdir(logs, { recursive: true });
  const localKmsKey = randomBytes(32);
  await writeFile(localKmsKeyFile, localKmsKey, { mode: 0o600 });
  localKmsKey.fill(0);

  await execFileAsync(join(postgresBin, 'initdb'), [
    '--pgdata',
    postgresData,
    '--encoding',
    'UTF8',
    '--locale',
    'C',
    '--auth',
    'trust',
    '--no-sync',
  ]);
  await execFileAsync(join(postgresBin, 'pg_ctl'), [
    '--pgdata',
    postgresData,
    '--log',
    join(logs, 'postgres.log'),
    '--options',
    `-F -h '' -k ${postgresSocket} -p ${ports.postgres}`,
    '--wait',
    'start',
  ]);
  postgresStarted = true;

  const postgresArguments = [
    '--host',
    postgresSocket,
    '--port',
    String(ports.postgres),
    '--username',
    userInfo().username,
    '--dbname',
    'postgres',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    'CREATE DATABASE droneworks_local;',
  ];
  await execFileAsync(join(postgresBin, 'psql'), postgresArguments);
  await execFileAsync(join(postgresBin, 'psql'), [
    '--host',
    postgresSocket,
    '--port',
    String(ports.postgres),
    '--username',
    userInfo().username,
    '--dbname',
    'droneworks_local',
    '--set',
    'ON_ERROR_STOP=1',
    '--file',
    join(repositoryRoot, 'packages/database/sql/bootstrap.sql'),
  ]);

  await runPnpm(['--filter', '@drone-works/database', 'run', 'build']);
  const databaseEnvironment = {
    PGHOST: postgresSocket,
    PGPORT: String(ports.postgres),
    PGDATABASE: 'droneworks_local',
  };
  await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'packages/database/scripts/migrate.mjs')],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...databaseEnvironment,
        PGUSER: 'droneworks_migration_runner',
      },
    },
  );
  await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'packages/database/scripts/migrate-jobs.mjs')],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...databaseEnvironment,
        PGUSER: 'droneworks_queue',
      },
    },
  );
  await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'packages/database/scripts/seed-local.mjs')],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...databaseEnvironment,
        PGUSER: 'droneworks_app',
      },
    },
  );

  const apiUrl = `http://127.0.0.1:${ports.api}`;
  await runPnpm(['build'], {
    API_INTERNAL_URL: apiUrl,
    DRONE_WORKS_AUTH_ENABLED: String(verifiedAuthEnabled),
    DRONE_WORKS_ENV: 'local',
    DRONE_WORKS_LOCAL_IDENTITY_ENABLED: String(localIdentityEnabled),
  });

  spawnService(
    'dependencies',
    process.execPath,
    [join(repositoryRoot, 'scripts/dev/dependencies.mjs')],
    { EMAIL_PORT: String(ports.email), OBJECT_PORT: String(ports.objects) },
  );
  const objectInternalUrl = `http://127.0.0.1:${ports.objects}`;
  await waitForHttp(`${objectInternalUrl}/health`, 'objects');
  await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'scripts/dev/seed-demo-flights.mjs')],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...databaseEnvironment,
        OBJECT_INTERNAL_URL: objectInternalUrl,
        PGUSER: userInfo().username,
      },
    },
  );
  spawnService(
    'api',
    process.execPath,
    [join(repositoryRoot, 'apps/api/dist/server.js')],
    {
      ...databaseEnvironment,
      BETTER_AUTH_SECRET: authSecret,
      BETTER_AUTH_URL: `http://127.0.0.1:${ports.web}`,
      DRONE_WORKS_AUTH_ENABLED: String(verifiedAuthEnabled),
      DRONE_WORKS_AUTH_TRUSTED_ORIGINS: `http://127.0.0.1:${ports.web}`,
      DRONE_WORKS_ENV: 'local',
      DRONE_WORKS_LOCAL_IDENTITY_ENABLED: String(localIdentityEnabled),
      EMAIL_INTERNAL_URL: `http://127.0.0.1:${ports.email}`,
      HOST: '127.0.0.1',
      OBJECT_INTERNAL_URL: objectInternalUrl,
      PGUSER: 'droneworks_app',
      PORT: String(ports.api),
    },
  );
  spawnService(
    'dispatcher',
    process.execPath,
    [join(repositoryRoot, 'apps/dispatcher/dist/server.js')],
    {
      ...databaseEnvironment,
      DRONE_WORKS_ENV: 'local',
      DRONE_WORKS_PROCESSING_JOB_EXPIRE_SECONDS:
        process.env.DRONE_WORKS_PROCESSING_JOB_EXPIRE_SECONDS ?? '60',
      HOST: '127.0.0.1',
      PORT: String(ports.dispatcher),
    },
  );
  spawnService(
    'worker',
    process.execPath,
    [join(repositoryRoot, 'apps/worker/dist/server.js')],
    {
      ...databaseEnvironment,
      DRONE_WORKS_DJI_KMS_KEY_REFERENCE:
        process.env.DRONE_WORKS_DJI_KMS_KEY_REFERENCE ?? 'kms://local/a13a',
      DRONE_WORKS_DJI_KMS_KEY_VERSION:
        process.env.DRONE_WORKS_DJI_KMS_KEY_VERSION ?? 'local-v1',
      DRONE_WORKS_DJI_NOTICE_VERSION:
        process.env.DRONE_WORKS_DJI_NOTICE_VERSION ?? 'dji-keychain-notice-v1',
      DRONE_WORKS_DJI_PROVIDER_ENABLED:
        process.env.DRONE_WORKS_DJI_PROVIDER_ENABLED ?? 'false',
      DRONE_WORKS_DJI_SECRET_REFERENCE:
        process.env.DRONE_WORKS_DJI_SECRET_REFERENCE ??
        'secret://local/dji-flight-record-api',
      DRONE_WORKS_DJI_TERMS_VERSION:
        process.env.DRONE_WORKS_DJI_TERMS_VERSION ??
        'dji-flight-record-api-review-2026-07-17',
      DRONE_WORKS_ENV: 'local',
      DRONE_WORKS_LOCAL_CREDENTIAL_FILE:
        process.env.DRONE_WORKS_LOCAL_CREDENTIAL_FILE ??
        join(repositoryRoot, '.env.local'),
      DRONE_WORKS_LOCAL_KMS_KEY_FILE: localKmsKeyFile,
      DRONE_WORKS_LOCAL_PARSER_EXECUTABLE:
        process.env.DRONE_WORKS_LOCAL_PARSER_EXECUTABLE ?? '',
      DRONE_WORKS_LOCAL_PARSER_SHA256:
        process.env.DRONE_WORKS_LOCAL_PARSER_SHA256 ?? '',
      DRONE_WORKS_LOCAL_WORKER_RECOVERY_PROBE_MS:
        process.env.DRONE_WORKS_LOCAL_WORKER_RECOVERY_PROBE_MS ?? '0',
      HOST: '127.0.0.1',
      OBJECT_INTERNAL_URL: objectInternalUrl,
      PGUSER: 'droneworks_app',
      PORT: String(ports.worker),
    },
  );
  spawnService(
    'web',
    process.execPath,
    [
      join(repositoryRoot, 'apps/web/node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(ports.web),
    ],
    {
      API_INTERNAL_URL: apiUrl,
      DRONE_WORKS_AUTH_ENABLED: String(verifiedAuthEnabled),
      DRONE_WORKS_ENV: 'local',
      DRONE_WORKS_LOCAL_IDENTITY_ENABLED: String(localIdentityEnabled),
    },
    join(repositoryRoot, 'apps/web'),
  );

  const state = {
    version: 1,
    alpha_organization_id: '00000000-0000-4000-8000-0000000000a1',
    generated_organizations: 2,
    generated_personas: ['alpha_owner', 'beta_owner'],
    identity_mode: verifiedAuthEnabled
      ? 'verified-session'
      : 'generated-persona',
    endpoints: {
      api: `${apiUrl}/api/v1/health`,
      dispatcher: `http://127.0.0.1:${ports.dispatcher}/health`,
      email: `http://127.0.0.1:${ports.email}/health`,
      objects: `http://127.0.0.1:${ports.objects}/health`,
      web: `http://127.0.0.1:${ports.web}`,
      worker: `http://127.0.0.1:${ports.worker}/health`,
    },
    postgres: {
      bin: postgresBin,
      data: postgresData,
      database: 'droneworks_local',
      port: ports.postgres,
      socket: postgresSocket,
      user: userInfo().username,
    },
    processes: processRecords,
    worker: {
      credentialFile:
        process.env.DRONE_WORKS_LOCAL_CREDENTIAL_FILE ??
        join(repositoryRoot, '.env.local'),
      jobExpireSeconds:
        process.env.DRONE_WORKS_PROCESSING_JOB_EXPIRE_SECONDS ?? '60',
      kmsKeyFile: localKmsKeyFile,
      parserExecutable: process.env.DRONE_WORKS_LOCAL_PARSER_EXECUTABLE ?? '',
      parserSha256: process.env.DRONE_WORKS_LOCAL_PARSER_SHA256 ?? '',
      providerEnabled: process.env.DRONE_WORKS_DJI_PROVIDER_ENABLED ?? 'false',
      recoveryProbeMs:
        process.env.DRONE_WORKS_LOCAL_WORKER_RECOVERY_PROBE_MS ?? '0',
    },
  };
  await writeFile(
    runtimeStatePath,
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );

  await Promise.all([
    waitForHttp(state.endpoints.api, 'api'),
    waitForHttp(state.endpoints.dispatcher, 'dispatcher'),
    waitForHttp(state.endpoints.worker, 'worker'),
    waitForHttp(state.endpoints.objects, 'objects'),
    waitForHttp(state.endpoints.email, 'email'),
  ]);
  await waitForPage(
    state.endpoints.web,
    verifiedAuthEnabled ? 'Verified access' : 'Every source accounted',
  );
  await waitForHttp(`${state.endpoints.web}/api/v1/health`, 'api');

  process.stdout.write(
    `Drone.Works local runtime ready: ${state.endpoints.web}\n`,
  );
} catch (error) {
  for (const processRecord of processRecords.reverse()) {
    terminateProcessGroup(processRecord.pid);
  }
  if (postgresStarted) {
    await execFileAsync(join(postgresBin, 'pg_ctl'), [
      '--pgdata',
      postgresData,
      '--mode',
      'immediate',
      '--wait',
      'stop',
    ]).catch(() => undefined);
  }
  await removeRuntimeState();
  throw error;
}
