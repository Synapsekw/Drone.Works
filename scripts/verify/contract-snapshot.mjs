import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) throw new Error('Run contract checks through pnpm.');

await execFileAsync(
  process.execPath,
  ['--import', 'tsx', 'apps/api/scripts/generate-openapi.ts', '--check'],
  { cwd: root },
);

const temporary = await mkdtemp(join(tmpdir(), 'drone-works-openapi-'));
const generated = join(temporary, 'openapi.ts');
try {
  await execFileAsync(
    process.execPath,
    [
      npmExecPath,
      'exec',
      'openapi-typescript',
      'packages/contracts/openapi/openapi.json',
      '-o',
      generated,
    ],
    { cwd: root },
  );
  const [actual, expected] = await Promise.all([
    readFile(generated, 'utf8'),
    readFile(join(root, 'packages/contracts/src/generated/openapi.ts'), 'utf8'),
  ]);
  if (actual !== expected) {
    throw new Error(
      'Generated API client is stale. Run pnpm contract:generate.',
    );
  }
} finally {
  await rm(temporary, { force: true, recursive: true });
}

process.stdout.write('OpenAPI and generated-client snapshots are current.\n');
