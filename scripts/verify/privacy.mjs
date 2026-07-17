import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const roots = ['apps', 'packages', 'scripts'].map((path) => join(root, path));
const extensions = new Set([
  '.js',
  '.json',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const reviewedKeychainProtocolFiles = new Set([
  'packages/parser/src/keychain.ts',
  'packages/parser/test/keychain.test.mjs',
]);
const forbidden = [
  ['/Users' + '/', 'machine-specific absolute path', new Set()],
  ['DJIFlight' + 'Record_', 'private fixture filename', new Set()],
  [
    'keychains' + 'Array',
    'private keychain material',
    reviewedKeychainProtocolFiles,
  ],
  [
    'aes' + 'Ciphertext',
    'private ciphertext material',
    reviewedKeychainProtocolFiles,
  ],
  ['dotenv' + '/config', 'implicit repository-root secret loading', new Set()],
];

async function files(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.next', 'dist', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await files(path)));
    if (entry.isFile() && extensions.has(extname(entry.name)))
      results.push(path);
  }
  return results;
}

for (const directory of roots) {
  for (const file of await files(directory)) {
    const contents = await readFile(file, 'utf8');
    const repositoryPath = relative(root, file);
    for (const [pattern, description, allowedFiles] of forbidden) {
      if (contents.includes(pattern) && !allowedFiles.has(repositoryPath)) {
        throw new Error(`${description} found in ${repositoryPath}.`);
      }
    }
  }
}

process.stdout.write('Source privacy verification passed.\n');
