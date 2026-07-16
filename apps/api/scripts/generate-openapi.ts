import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildApi } from '../src/app.js';

const { app } = await buildApi();
const document = app.swagger();
const target = resolve('packages/contracts/openapi/openapi.json');
const serialized = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const committed = await readFile(target, 'utf8');
  if (committed !== serialized) {
    throw new Error('OpenAPI snapshot is stale. Run pnpm contract:generate.');
  }
} else {
  await writeFile(target, serialized, 'utf8');
}
await app.close();
