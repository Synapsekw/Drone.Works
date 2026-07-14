import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(process.argv[2] ?? "");
const outputRoot = resolve(process.argv[3] ?? "");

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node generate-compliance.mjs <source-root> <output-root>");
}

const overrides = JSON.parse(readFileSync(join(scriptDirectory, "license-overrides.json"), "utf8"));
const metadata = JSON.parse(execFileSync("cargo", [
  "metadata",
  "--locked",
  "--filter-platform",
  "wasm32-unknown-unknown",
  "--format-version",
  "1",
], { cwd: sourceRoot, encoding: "utf8" }));

const rootPackage = metadata.packages.find((candidate) => (
  candidate.name === "dji-log-parser-js" && candidate.source === null
));
if (!rootPackage) {
  throw new Error("Unable to identify dji-log-parser-js in Cargo metadata");
}

const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const includedIds = new Set();
function include(id) {
  if (includedIds.has(id)) return;
  includedIds.add(id);
  for (const dependency of nodes.get(id)?.deps ?? []) include(dependency.pkg);
}
include(rootPackage.id);

const packages = metadata.packages
  .filter((candidate) => includedIds.has(candidate.id))
  .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));

const licenseRoot = join(outputRoot, "licenses");
mkdirSync(licenseRoot, { recursive: true });

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeName(value) {
  return value.replaceAll(/[^a-zA-Z0-9._@+-]/g, "_");
}

function licenseFiles(directory) {
  return readdirSync(directory)
    .filter((name) => /^(license|copying|notice)([._-].*)?$/i.test(name))
    .sort();
}

function vcsIdentity(packageDirectory) {
  const path = join(packageDirectory, ".cargo_vcs_info.json");
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8"));
  return value?.git?.sha1 ?? null;
}

const sharedLicenses = new Map();
for (const packageValue of packages) {
  const packageDirectory = dirname(packageValue.manifest_path);
  const files = licenseFiles(packageDirectory);
  const identity = vcsIdentity(packageDirectory);
  if (identity && files.length > 0 && !sharedLicenses.has(identity)) {
    sharedLicenses.set(identity, { directory: packageDirectory, files });
  }
}

const index = [];
for (const packageValue of packages) {
  const key = `${packageValue.name}@${packageValue.version}`;
  const packageDirectory = dirname(packageValue.manifest_path);
  const destination = join(licenseRoot, safeName(key));
  mkdirSync(destination, { recursive: true });

  let files = licenseFiles(packageDirectory).map((name) => ({
    name,
    source: join(packageDirectory, name),
    url: null,
    expectedHash: null,
  }));

  if (files.length === 0) {
    const shared = sharedLicenses.get(vcsIdentity(packageDirectory));
    if (shared) {
      files = shared.files.map((name) => ({
        name,
        source: join(shared.directory, name),
        url: null,
        expectedHash: null,
      }));
    }
  }

  if (files.length === 0 && overrides.packages[key]) {
    files = overrides.packages[key].map((entry) => ({
      name: entry.name,
      source: join(scriptDirectory, entry.local),
      url: entry.source_url,
      expectedHash: entry.sha256,
    }));
  }

  if (files.length === 0 && packageValue.source === null) {
    const upstreamLicense = join(sourceRoot, "LICENSE");
    files = [{ name: "LICENSE", source: upstreamLicense, url: null, expectedHash: null }];
  }

  if (files.length === 0) {
    throw new Error(`No license text available for ${key}`);
  }

  const copied = [];
  for (const entry of files) {
    const target = join(destination, safeName(entry.name));
    const bytes = readFileSync(entry.source);
    if (entry.expectedHash && sha256(bytes) !== entry.expectedHash) {
      throw new Error(`License checksum mismatch for ${key}`);
    }
    writeFileSync(target, bytes);
    copied.push({
      file: `licenses/${safeName(key)}/${safeName(entry.name)}`,
      sha256: sha256(bytes),
      source_url: entry.url,
    });
  }

  index.push({
    name: packageValue.name,
    version: packageValue.version,
    license_expression: packageValue.license,
    repository: packageValue.repository,
    source: packageValue.source,
    license_files: copied,
  });
}

writeFileSync(join(outputRoot, "license-index.json"), `${JSON.stringify({
  schema_version: 1,
  target: "wasm32-unknown-unknown",
  component_count: index.length,
  components: index,
}, null, 2)}\n`);

const noticeLines = [
  "# Third-party notices",
  "",
  "Generated from the target-specific locked Cargo graph. Review `license-index.json` for source URLs and checksums.",
  "",
  ...index.flatMap((entry) => [
    `## ${entry.name}@${entry.version}`,
    "",
    `Declared license: ${entry.license_expression ?? "not declared"}`,
    "",
    ...entry.license_files.map((license) => `- \`${license.file}\``),
    "",
  ]),
];
writeFileSync(join(outputRoot, "THIRD_PARTY_NOTICES.md"), `${noticeLines.join("\n")}\n`);
