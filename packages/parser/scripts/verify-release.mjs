import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const release = JSON.parse(
  await readFile(resolve(packageRoot, 'release/parser-release.json'), 'utf8'),
);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

if (
  release.schema_version !== 1 ||
  !/^[0-9a-f]{40}$/.test(release.parser?.source_commit ?? '') ||
  !/^[0-9a-f]{64}$/.test(release.linux_artifact?.sha256 ?? '') ||
  !release.oci?.base?.includes('@sha256:')
) {
  throw new Error('The parser release manifest is invalid or unpinned.');
}

for (const input of release.reviewed_inputs ?? []) {
  const value = await readFile(resolve(repositoryRoot, input.path));
  if (sha256(value) !== input.sha256) {
    throw new Error(`Reviewed parser input changed: ${input.path}`);
  }
}

const source = JSON.parse(
  await readFile(
    resolve(repositoryRoot, 'spikes/dji-parser/internal-build/source.json'),
    'utf8',
  ),
);
if (
  source.upstream?.commit !== release.parser.source_commit ||
  source.tools?.rust !== release.tools.rust ||
  source.tools?.cargo_cyclonedx !== release.tools.cargo_cyclonedx
) {
  throw new Error('The parser release does not match the pinned source tools.');
}

const containerfile = await readFile(
  resolve(packageRoot, 'oci/Containerfile'),
  'utf8',
);
if (
  !containerfile.startsWith(`FROM ${release.oci.base}\n`) ||
  !containerfile.includes(`USER ${release.oci.user}\n`) ||
  !containerfile.includes(`ENTRYPOINT ["${release.oci.entrypoint}"`)
) {
  throw new Error('The parser OCI image differs from its release manifest.');
}

const workflow = await readFile(
  resolve(repositoryRoot, '.github/workflows/dji-parser.yml'),
  'utf8',
);
for (const required of [
  'packages/parser/oci/Containerfile',
  'packages/parser/scripts/verify-oci.mjs',
  'Attest the native parser OCI image',
  'Attest the native Linux binary SBOM',
  'Verify native artifact reproducibility',
]) {
  if (!workflow.includes(required)) {
    throw new Error(`Parser workflow is missing: ${required}`);
  }
}

const evidenceRoot = process.argv[2];
if (evidenceRoot) {
  const artifact = await readFile(
    resolve(evidenceRoot, 'droneworks-dji-parser-cli'),
  );
  if (sha256(artifact) !== release.linux_artifact.sha256) {
    throw new Error('The rebuilt native Linux parser digest changed.');
  }
  const manifest = JSON.parse(
    await readFile(resolve(evidenceRoot, 'artifact-manifest.json'), 'utf8'),
  );
  if (
    manifest.source?.commit !== release.parser.source_commit ||
    manifest.target !== release.linux_artifact.target ||
    manifest.artifact?.sha256 !== release.linux_artifact.sha256
  ) {
    throw new Error('The rebuilt parser evidence differs from the release.');
  }
  await readFile(resolve(evidenceRoot, 'sbom.cdx.json'));
  await readFile(resolve(evidenceRoot, 'THIRD_PARTY_NOTICES.md'));
}

process.stdout.write('Parser release manifest verification passed.\n');
