import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { startDisposablePostgres } from '../../../packages/database/scripts/disposable-postgres.mjs';

const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error('Run upload tests through pnpm.');

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate a dependency port.'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dependency process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Dependency did not become ready: ${url}`);
}

const rollbackDigest = createHash('sha256')
  .update('rollback-raw-upload')
  .digest('hex');
const database = await startDisposablePostgres({
  setupSql: `
    CREATE FUNCTION droneworks.reject_generated_rollback_source()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.content_sha256 = '${rollbackDigest}' THEN
        RAISE EXCEPTION 'generated rollback proof';
      END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER reject_generated_rollback_source
      BEFORE INSERT ON droneworks.raw_sources
      FOR EACH ROW EXECUTE FUNCTION droneworks.reject_generated_rollback_source();
    INSERT INTO droneworks.import_batches (
      organization_id, id, uploaded_by_user_id, state, created_at, completed_at
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a1',
      '50000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-0000000000a2',
      'completed', '2026-07-20T08:00:00.000Z', '2026-07-20T08:00:00.000Z'
    );
    INSERT INTO droneworks.import_items (
      organization_id, id, import_batch_id, client_file_id,
      original_filename, state, failure_code, created_at, updated_at
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a1',
      '50000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000000',
      'generated-retry', 'generated-key-unavailable.txt', 'failed',
      'key_service_unavailable', '2026-07-20T08:00:00.000Z',
      '2026-07-20T08:00:00.000Z'
    );
    INSERT INTO droneworks.import_attempts (
      organization_id, id, import_item_id, attempt_number, state,
      parser_revision, failure_code, started_at, finished_at
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a1',
      '51000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000005', 1, 'failed',
      'generated-test-v1', 'key_service_unavailable',
      '2026-07-20T08:00:00.000Z', '2026-07-20T08:00:00.000Z'
    );
    INSERT INTO droneworks_jobs.outbox (
      organization_id, id, job_type, payload_version, resource_id, state,
      available_at, created_at, attempt_count, queue_job_id, dispatched_at
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a1',
      '52000000-0000-4000-8000-000000000005',
      'raw-source-processing-v1', 1,
      '50000000-0000-4000-8000-000000000005', 'dispatched',
      '2026-07-20T08:00:00.000Z', '2026-07-20T08:00:00.000Z', 1,
      '53000000-0000-4000-8000-000000000005',
      '2026-07-20T08:00:00.000Z'
    );
  `,
});
const [objectPort, emailPort] = await Promise.all([
  availablePort(),
  availablePort(),
]);
const objectUrl = `http://127.0.0.1:${objectPort}`;
const dependencies = spawn(
  process.execPath,
  [new URL('../../../scripts/dev/dependencies.mjs', import.meta.url).pathname],
  {
    env: {
      ...process.env,
      EMAIL_PORT: String(emailPort),
      OBJECT_PORT: String(objectPort),
    },
    stdio: 'inherit',
  },
);

try {
  await waitFor(`${objectUrl}/health`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [pnpmPath, 'exec', 'vitest', 'run', 'test/upload.test.mjs'],
      {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          ...database.environment,
          OBJECT_INTERNAL_URL: objectUrl,
        },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Vitest exited with ${code ?? signal}.`));
    });
  });
} finally {
  dependencies.kill('SIGTERM');
  await database.close();
}
