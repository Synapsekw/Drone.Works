import { execFile } from 'node:child_process';
import { access, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);
export const repositoryRoot = resolve(import.meta.dirname, '../..');
export const runtimeRoot = join(repositoryRoot, '.drone-works', 'local');
export const runtimeStatePath = join(runtimeRoot, 'state.json');

export async function findPostgresBin() {
  const candidates = [
    process.env.POSTGRES_BIN,
    '/opt/homebrew/opt/postgresql@18/bin',
    '/usr/local/opt/postgresql@18/bin',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await Promise.all(
        ['initdb', 'pg_ctl', 'psql'].map((binary) =>
          access(join(candidate, binary)),
        ),
      );
      return candidate;
    } catch {
      // Continue to the next explicit native PostgreSQL installation.
    }
  }

  throw new Error(
    'PostgreSQL 18 was not found. Install postgresql@18 with Homebrew or set POSTGRES_BIN. Docker is not used.',
  );
}

export async function findAvailablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate a local TCP port.'));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

export async function readRuntimeState() {
  return JSON.parse(await readFile(runtimeStatePath, 'utf8'));
}

export function terminateProcessGroup(pid, signal = 'SIGTERM') {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

export async function removeRuntimeState() {
  await rm(runtimeRoot, { force: true, recursive: true });
}

export async function waitForHttp(url, expectedService, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.json();
      if (
        response.ok &&
        body.status === 'ok' &&
        body.service === expectedService
      ) {
        return body;
      }
      lastError = new Error(`Unexpected readiness response from ${url}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(
    `Timed out waiting for ${url}: ${lastError?.message ?? 'unknown error'}`,
  );
}

export async function waitForPage(url, expectedText, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (response.ok && body.includes(expectedText)) {
        return;
      }
      lastError = new Error(`Unexpected page response from ${url}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(
    `Timed out waiting for ${url}: ${lastError?.message ?? 'unknown error'}`,
  );
}
