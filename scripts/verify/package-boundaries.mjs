import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const webRoot = join(root, 'apps', 'web');
const productionRoots = ['apps', 'packages'].map((path) => join(root, path));
const requiredPackages = [
  'apps/api',
  'apps/dispatcher',
  'apps/web',
  'apps/worker',
  'packages/config',
  'packages/contracts',
  'packages/database',
  'packages/domain',
  'packages/jobs',
  'packages/parser',
  'packages/telemetry',
  'packages/testing',
];

for (const packagePath of requiredPackages) {
  await readFile(join(root, packagePath, 'package.json'), 'utf8');
}

async function sourceFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.next', 'dist', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await sourceFiles(path)));
    if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) {
      results.push(path);
    }
  }
  return results;
}

for (const file of await sourceFiles(webRoot)) {
  const contents = await readFile(file, 'utf8');
  if (contents.includes('@drone-works/database')) {
    throw new Error(
      `Web-to-database import forbidden: ${relative(root, file)}`,
    );
  }
  if (/^['"]use server['"];?/m.test(contents)) {
    throw new Error(`Web server action forbidden: ${relative(root, file)}`);
  }
}

for (const productionRoot of productionRoots) {
  for (const file of await sourceFiles(productionRoot)) {
    if (
      file.startsWith(join(root, 'packages', 'database')) ||
      file.startsWith(join(root, 'packages', 'jobs'))
    ) {
      continue;
    }
    const contents = await readFile(file, 'utf8');
    if (/from ['"]pg['"]|require\(['"]pg['"]\)/.test(contents)) {
      throw new Error(
        `Direct PostgreSQL import outside database package: ${relative(root, file)}`,
      );
    }
  }
}

process.stdout.write('Package-boundary verification passed.\n');
