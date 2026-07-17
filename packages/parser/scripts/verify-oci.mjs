import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { CliOciRuntime, ParserSupervisor } from '../dist/index.js';

const execFileAsync = promisify(execFile);
const image = process.env.DRONEWORKS_PARSER_TEST_IMAGE;
if (!image) throw new Error('DRONEWORKS_PARSER_TEST_IMAGE is required.');

const { stdout } = await execFileAsync('docker', [
  'image',
  'inspect',
  '--format',
  '{{.Id}}',
  image,
]);
const imageId = stdout.trim();
if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) {
  throw new Error('The local parser image is not content-addressed.');
}

const directory = await mkdtemp(resolve(tmpdir(), 'droneworks-a08-oci-'));
const sourcePath = resolve(directory, 'source.bin');
const content = Buffer.from('generated invalid parser envelope');
await writeFile(sourcePath, content, { mode: 0o444 });
const source = {
  bytes: content.length,
  path: sourcePath,
  sha256: createHash('sha256').update(content).digest('hex'),
};
content.fill(0);

try {
  const supervisor = new ParserSupervisor({
    image: imageId,
    runtime: new CliOciRuntime('docker'),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const privateInput = Buffer.from('{"keychains":[]}');
    const result = await supervisor.run(source, privateInput);
    if (result.status !== 'failed' || result.failureCode !== 'invalid_source') {
      throw new Error('The production parser image did not fail safely.');
    }
    if (privateInput.some((value) => value !== 0)) {
      throw new Error('Private parser input was not cleared.');
    }
    if (JSON.stringify(result).includes(source.sha256)) {
      throw new Error('Parser result exposed the source identity.');
    }
  }
  process.stdout.write('Native parser OCI execution verification passed.\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}
