import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { readRuntimeState, waitForHttp, waitForPage } from './runtime-lib.mjs';

const execFileAsync = promisify(execFile);
const state = await readRuntimeState();

const personaResponse = await fetch(
  new URL('/_local/generated-personas/select', state.endpoints.api),
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ persona: 'alpha_owner' }),
  },
);
if (!personaResponse.ok) {
  throw new Error('The local generated-persona control is unavailable.');
}
const persona = await personaResponse.json();
const selectionResponse = await fetch(
  new URL(
    `/api/v1/organizations/${state.alpha_organization_id}/selection`,
    state.endpoints.api,
  ),
  {
    method: 'PUT',
    headers: {
      'x-drone-works-local-persona-token': persona.token,
    },
  },
);
const selection = await selectionResponse.json();
if (
  !selectionResponse.ok ||
  selection.organization_id !== state.alpha_organization_id ||
  selection.role !== 'owner'
) {
  throw new Error('The local identity-to-organization path did not pass.');
}

const rawContent = Buffer.from('generated-local-smoke-upload');
const rawDigest = createHash('sha256').update(rawContent).digest('hex');
const declarationResponse = await fetch(
  new URL(
    `/api/v1/organizations/${state.alpha_organization_id}/uploads`,
    state.endpoints.api,
  ),
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'local-smoke-declaration',
      'x-drone-works-local-persona-token': persona.token,
    },
    body: JSON.stringify({
      client_file_id: 'local-smoke-file',
      original_filename: '../generated-local-smoke.bin',
      content_sha256: rawDigest,
      byte_size: rawContent.byteLength,
      media_type: 'application/octet-stream',
    }),
  },
);
const declaration = await declarationResponse.json();
if (!declarationResponse.ok || declaration.state !== 'declared') {
  throw new Error('The local raw-upload declaration did not pass.');
}
const contentResponse = await fetch(
  new URL(
    `/api/v1/organizations/${state.alpha_organization_id}/uploads/${declaration.upload_id}/content`,
    state.endpoints.api,
  ),
  {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-drone-works-local-persona-token': persona.token,
    },
    body: rawContent,
  },
);
const stored = await contentResponse.json();
if (!contentResponse.ok || stored.content_sha256 !== rawDigest) {
  throw new Error('The local immutable object write did not pass.');
}
const completionResponse = await fetch(
  new URL(
    `/api/v1/organizations/${state.alpha_organization_id}/uploads/${declaration.upload_id}/completion`,
    state.endpoints.api,
  ),
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'local-smoke-completion',
      'x-drone-works-local-persona-token': persona.token,
    },
    body: JSON.stringify({ object_version_id: stored.object_version_id }),
  },
);
const completedUpload = await completionResponse.json();
if (
  !completionResponse.ok ||
  completedUpload.state !== 'completed' ||
  completedUpload.raw_source_id !== declaration.upload_id
) {
  throw new Error('The local raw-upload completion did not pass.');
}

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
  `Local smoke passed: ${[api.service, worker.service, objects.service, email.service].join(', ')}, generated identity/authorization, immutable upload, and web/postgres.\n`,
);
