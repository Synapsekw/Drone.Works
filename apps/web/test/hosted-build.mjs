import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const nextBin = join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

function run(args, environment) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [nextBin, ...args], {
      cwd: webRoot,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`next ${args[0]} exited ${code}`)),
    );
  });
}

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('No port.'));
      server.close(() => resolvePort(address.port));
    });
  });
}

await rm(join(webRoot, '.next'), { force: true, recursive: true });
await run(['build'], {
  API_INTERNAL_URL: 'http://127.0.0.1:9',
  DRONE_WORKS_ENV: 'production',
  DRONE_WORKS_LOCAL_IDENTITY_ENABLED: 'false',
});

async function emittedText(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      contents.push(await emittedText(path));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.map')) {
      contents.push(await readFile(path, 'utf8'));
    }
  }
  return contents.join('\n');
}

const hostedArtifacts = await emittedText(join(webRoot, '.next'));
assert.equal(
  hostedArtifacts.includes('/_local/generated-personas/select'),
  false,
  'Hosted artifacts must not compile the generated-persona endpoint.',
);
assert.equal(
  hostedArtifacts.includes('Generated Alpha owner'),
  false,
  'Hosted artifacts must not compile the generated-persona controls.',
);

const routes = JSON.parse(
  await readFile(join(webRoot, '.next', 'routes-manifest.json'), 'utf8'),
);
assert.equal(
  JSON.stringify(routes.rewrites).includes('/_local/'),
  false,
  'Hosted build must not contain the generated-persona rewrite.',
);

const port = await availablePort();
const server = spawn(
  process.execPath,
  [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: webRoot,
    detached: true,
    env: {
      ...process.env,
      API_INTERNAL_URL: 'http://127.0.0.1:9',
      DRONE_WORKS_ENV: 'production',
      DRONE_WORKS_LOCAL_IDENTITY_ENABLED: 'false',
    },
    stdio: 'ignore',
  },
);

try {
  let response;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) break;
    } catch {
      // Continue until the bounded startup deadline.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(response?.ok, 'Hosted web build did not become ready.');
  const html = await response.text();
  assert.equal(html.includes('Generated Alpha owner'), false);
  assert.equal(html.includes('Local development identity'), false);
  assert.match(html, /Verified identity required/);
  const localControl = await fetch(
    `http://127.0.0.1:${port}/_local/generated-personas/select`,
    { method: 'POST' },
  );
  assert.equal(localControl.status, 404);
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch (error) {
    assert.equal(error.code, 'ESRCH');
  }
}
