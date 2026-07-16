import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { readRuntimeState, waitForHttp, waitForPage } from './runtime-lib.mjs';

const execFileAsync = promisify(execFile);
const state = await readRuntimeState();

const [api, worker, objects, email, , proxiedApi] = await Promise.all([
  waitForHttp(state.endpoints.api, 'api', 5_000),
  waitForHttp(state.endpoints.worker, 'worker', 5_000),
  waitForHttp(state.endpoints.objects, 'objects', 5_000),
  waitForHttp(state.endpoints.email, 'email', 5_000),
  waitForPage(state.endpoints.web, 'Local foundation', 5_000),
  waitForHttp(`${state.endpoints.web}/api/v1/health`, 'api', 5_000),
]);

if (proxiedApi.version !== 'v1') {
  throw new Error('The web API proxy did not return the v1 contract.');
}

const { stdout } = await execFileAsync(join(state.postgres.bin, 'psql'), [
  '--host',
  state.postgres.socket,
  '--port',
  String(state.postgres.port),
  '--username',
  state.postgres.user,
  '--dbname',
  state.postgres.database,
  '--tuples-only',
  '--no-align',
  '--command',
  `SELECT
     (SELECT count(*) FROM droneworks.organizations)::text || ':' ||
     (SELECT count(*) FROM droneworks_ops.migration_runs)::text;`,
]);

if (stdout.trim() !== `${state.generated_organizations}:1`) {
  throw new Error('The migrated local PostgreSQL seed or ledger is missing.');
}

process.stdout.write(
  `Local smoke passed: ${[api.service, worker.service, objects.service, email.service].join(', ')} and web/postgres.\n`,
);
