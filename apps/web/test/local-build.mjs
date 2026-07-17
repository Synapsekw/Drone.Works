import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const nextBin = join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

await rm(join(webRoot, '.next'), { force: true, recursive: true });
await new Promise((resolveBuild, reject) => {
  const child = spawn(process.execPath, [nextBin, 'build'], {
    cwd: webRoot,
    env: {
      ...process.env,
      API_INTERNAL_URL: 'http://127.0.0.1:9',
      DRONE_WORKS_ENV: 'local',
      DRONE_WORKS_LOCAL_IDENTITY_ENABLED: 'true',
    },
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0
      ? resolveBuild()
      : reject(new Error(`Local Next.js build exited ${code}.`)),
  );
});
