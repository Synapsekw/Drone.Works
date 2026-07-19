import { execFile } from 'node:child_process';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../..');
const statePath = join(repositoryRoot, '.drone-works/local/state.json');
const fixturePath = join(repositoryRoot, 'fixtures/local/dji-log-003.txt');
const reportPath = join(
  repositoryRoot,
  '.drone-works/a13a-functional-report.json',
);
const canary = 'A13A_REDACTION_CANARY_7F2C9B';
const pnpm = process.env.npm_execpath;
const parserExecutable = process.env.DRONE_WORKS_LOCAL_PARSER_EXECUTABLE;
const parserSha256 = process.env.DRONE_WORKS_LOCAL_PARSER_SHA256;

if (!pnpm || !parserExecutable || !/^[0-9a-f]{64}$/.test(parserSha256 ?? '')) {
  throw new Error(
    'Run through pnpm with the approved local parser executable and SHA-256 references.',
  );
}
await Promise.all([
  access(fixturePath),
  access(parserExecutable),
  access(join(repositoryRoot, '.env.local')),
]);

async function runPnpm(args, environment = {}) {
  await execFileAsync(process.execPath, [pnpm, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    maxBuffer: 20 * 1024 * 1024,
  });
}

const runtimeEnvironment = {
  DRONE_WORKS_DJI_PROVIDER_ENABLED: 'true',
  DRONE_WORKS_LOCAL_PARSER_EXECUTABLE: parserExecutable,
  DRONE_WORKS_LOCAL_PARSER_SHA256: parserSha256,
  DRONE_WORKS_LOCAL_WORKER_RECOVERY_PROBE_MS: '8000',
  DRONE_WORKS_PROCESSING_JOB_EXPIRE_SECONDS: '3',
};

await runPnpm(['dev:down']).catch(() => undefined);
let started = false;
try {
  await execFileAsync(
    process.execPath,
    [
      join(repositoryRoot, 'scripts/fixtures/verify-manifest.mjs'),
      '--require-local',
    ],
    {
      cwd: repositoryRoot,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  await runPnpm(['dev:up'], runtimeEnvironment);
  started = true;
  await runPnpm(
    [
      '--filter',
      '@drone-works/web',
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.functional.config.ts',
    ],
    runtimeEnvironment,
  );

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const logDirectory = join(repositoryRoot, '.drone-works/local/logs');
  const logFiles = await readdir(logDirectory);
  for (const name of logFiles) {
    const log = await readFile(join(logDirectory, name), 'utf8');
    if (log.includes(canary)) {
      throw new Error(
        'The redaction canary appeared in a generated service log.',
      );
    }
  }
  const purge = await execFileAsync(
    process.execPath,
    [
      join(
        repositoryRoot,
        'packages/database/scripts/purge-local-organization.mjs',
      ),
      state.alpha_organization_id,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        OBJECT_INTERNAL_URL: state.endpoints.objects.replace(/\/health$/, ''),
        PGDATABASE: state.postgres.database,
        PGHOST: state.postgres.socket,
        PGPORT: String(state.postgres.port),
        PGUSER: state.postgres.user,
      },
    },
  );
  const absence = JSON.parse(purge.stdout.trim());
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        authorization_isolation: 'passed',
        browser_api_boundary: 'passed',
        controlled_corrupt_source: 'passed',
        coordinate_network_privacy: 'passed',
        exact_duplicate_reuse: 'passed',
        generated_identity_vertical_path: 'passed',
        organization_purge: absence.status,
        redaction_canary_scan: 'passed',
        worker_recovery: 'passed',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write(
    'A13a functional gate passed with sanitized retained evidence.\n',
  );
} finally {
  if (started) await runPnpm(['dev:down']).catch(() => undefined);
}
