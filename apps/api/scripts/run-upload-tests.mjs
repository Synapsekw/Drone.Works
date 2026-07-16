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
