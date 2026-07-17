import { spawn } from 'node:child_process';

import { startDisposablePostgres } from '../../../packages/database/scripts/disposable-postgres.mjs';

const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error('Run normalization tests through pnpm.');

const database = await startDisposablePostgres();
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [pnpmPath, 'exec', 'vitest', 'run', 'test/normalization.test.mjs'],
      {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, ...database.environment },
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
  await database.close();
}
