import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { startDisposablePostgres } from '../../../packages/database/scripts/disposable-postgres.mjs';

const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error('Run jobs tests through pnpm.');

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
      // The loopback dependency is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Dependency did not become ready: ${url}`);
}

const rollbackDigest = createHash('sha256')
  .update('atomic-jobs-rollback')
  .digest('hex');
const database = await startDisposablePostgres({
  setupSql: `
    CREATE FUNCTION droneworks.reject_generated_jobs_audit()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'raw_upload.completed' AND EXISTS (
        SELECT 1
          FROM droneworks.raw_sources
         WHERE organization_id = NEW.organization_id
           AND id = NEW.resource_id
           AND content_sha256 = '${rollbackDigest}'
      ) THEN
        RAISE EXCEPTION 'generated jobs atomicity proof';
      END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER reject_generated_jobs_audit
      BEFORE INSERT ON droneworks.audit_events
      FOR EACH ROW EXECUTE FUNCTION droneworks.reject_generated_jobs_audit();
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
      [pnpmPath, 'exec', 'vitest', 'run', 'test/jobs.test.mjs'],
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
