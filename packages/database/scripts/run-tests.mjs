import { execFile, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import pg from 'pg';

import {
  applyReviewedJobsMigration,
  applyReviewedMigrations,
  IsolationContractError,
  withOrganizationTransaction,
} from '../dist/index.js';
import {
  generatedOrganizations,
  seedOrganization,
} from '../test/generated-seed.mjs';

const execFileAsync = promisify(execFile);
const { Client, Pool } = pg;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findPostgresBin() {
  const candidates = [
    process.env.POSTGRES_BIN,
    '/opt/homebrew/opt/postgresql@18/bin',
    '/usr/local/opt/postgresql@18/bin',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await Promise.all(
        ['initdb', 'pg_ctl', 'postgres'].map((binary) =>
          access(join(candidate, binary)),
        ),
      );
      return candidate;
    } catch {
      // Continue to the next explicit native PostgreSQL installation.
    }
  }
  throw new Error(
    'PostgreSQL 18 server binaries were not found. Install postgresql@18 natively or set POSTGRES_BIN. Docker is not used.',
  );
}

async function runVitest(environment) {
  const pnpmPath = process.env.npm_execpath;
  if (!pnpmPath) throw new Error('Run database tests through pnpm.');
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [pnpmPath, 'exec', 'vitest', 'run', 'test/database.test.mjs'],
      {
        cwd: packageRoot,
        env: { ...process.env, ...environment },
        stdio: 'inherit',
      },
    );
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Vitest exited with ${code ?? signal}.`));
    });
  });
}

const postgresBin = await findPostgresBin();
const temporaryRoot = await mkdtemp(join(tmpdir(), 'droneworks-a04-'));
const dataDirectory = join(temporaryRoot, 'data');
const socketDirectory = join(temporaryRoot, 'socket');
const logPath = join(temporaryRoot, 'postgres.log');
const port = 55_432;
const bootstrapUser = userInfo().username;
let serverStarted = false;

try {
  await execFileAsync(join(postgresBin, 'initdb'), [
    '--pgdata',
    dataDirectory,
    '--encoding',
    'UTF8',
    '--locale',
    'C',
    '--auth',
    'trust',
    '--no-sync',
  ]);
  await mkdir(socketDirectory);
  await execFileAsync(join(postgresBin, 'pg_ctl'), [
    '--pgdata',
    dataDirectory,
    '--log',
    logPath,
    '--options',
    `-F -h '' -k ${socketDirectory} -p ${port}`,
    '--wait',
    'start',
  ]);
  serverStarted = true;

  const bootstrap = new Client({
    host: socketDirectory,
    port,
    database: 'postgres',
    user: bootstrapUser,
  });
  await bootstrap.connect();
  try {
    const bootstrapSql = await readFile(
      new URL('../sql/bootstrap.sql', import.meta.url),
      'utf8',
    );
    await bootstrap.query(bootstrapSql);
  } finally {
    await bootstrap.end();
  }

  const migrationClient = new Client({
    host: socketDirectory,
    port,
    database: 'postgres',
    user: 'droneworks_migration_runner',
    application_name: 'droneworks-reviewed-migration',
  });
  await migrationClient.connect();
  let migrationResults;
  try {
    migrationResults = await applyReviewedMigrations(
      migrationClient,
      new Date('2026-07-16T00:00:00.000Z'),
    );
    const replay = await applyReviewedMigrations(
      migrationClient,
      new Date('2026-07-16T00:00:00.000Z'),
    );
    if (replay.some((result) => result.status !== 'already_applied')) {
      throw new Error('Reviewed migration replay was not a no-op.');
    }
  } catch (error) {
    if (error instanceof IsolationContractError) {
      process.stderr.write(
        `Isolation digest expected ${error.expectedSha256}; actual ${error.actualSha256}.\n`,
      );
    }
    throw error;
  } finally {
    await migrationClient.end();
  }

  const jobsMigrationClient = new Client({
    host: socketDirectory,
    port,
    database: 'postgres',
    user: 'droneworks_queue',
    application_name: 'droneworks-reviewed-jobs-migration',
  });
  await jobsMigrationClient.connect();
  try {
    await applyReviewedJobsMigration(
      jobsMigrationClient,
      new Date('2026-07-16T00:00:00.000Z'),
    );
    const replay = await applyReviewedJobsMigration(
      jobsMigrationClient,
      new Date('2026-07-16T00:00:00.000Z'),
    );
    if (replay.status !== 'already_applied') {
      throw new Error('Reviewed jobs migration replay was not a no-op.');
    }
  } finally {
    await jobsMigrationClient.end();
  }

  const appPool = new Pool({
    host: socketDirectory,
    port,
    database: 'postgres',
    user: 'droneworks_app',
    max: 1,
  });
  try {
    for (const seed of Object.values(generatedOrganizations)) {
      await withOrganizationTransaction(
        appPool,
        seed.organizationId,
        async (transaction) => seedOrganization(transaction, seed),
      );
    }
  } finally {
    await appPool.end();
  }

  await runVitest({
    PGHOST: socketDirectory,
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: 'droneworks_app',
    DRONEWORKS_PG_BOOTSTRAP_USER: bootstrapUser,
    DRONEWORKS_PG_MIGRATION_USER: 'droneworks_migration_runner',
    DRONEWORKS_PG_QUEUE_USER: 'droneworks_queue',
    DRONEWORKS_PG_DISPATCHER_USER: 'droneworks_dispatcher',
    DRONEWORKS_PG_MIGRATION_ID: migrationResults[0].migrationId,
    DRONEWORKS_PG_MIGRATION_SHA256: migrationResults[0].sha256,
    DRONEWORKS_PG_ISOLATION_SHA256: migrationResults[0].isolationSha256,
  });
} catch (error) {
  if (serverStarted) {
    const log = await readFile(logPath, 'utf8').catch(() => 'unavailable');
    process.stderr.write(`\nPostgreSQL log:\n${log}\n`);
  }
  throw error;
} finally {
  if (serverStarted) {
    await execFileAsync(join(postgresBin, 'pg_ctl'), [
      '--pgdata',
      dataDirectory,
      '--mode',
      'immediate',
      '--wait',
      'stop',
    ]).catch(() => undefined);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
