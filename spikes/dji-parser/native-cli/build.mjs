import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const configuration = JSON.parse(
  readFileSync(join(directory, "..", "internal-build", "source.json"), "utf8"),
);
const workRoot = resolve(process.argv[2] ?? join(directory, "work"));
const outputRoot = resolve(process.argv[3] ?? join(directory, "out"));
const sourceRoot = join(workRoot, "source");
const crateName = "droneworks-dji-parser-cli";

for (const path of [workRoot, outputRoot]) {
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing path: ${path}`);
}
mkdirSync(workRoot, { recursive: true });
mkdirSync(outputRoot, { recursive: true });

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });
}

function output(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function deterministicUuid(value) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function files(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    return entry.isDirectory() ? files(root, path) : [relative(root, path)];
  });
}

function replaceExact(path, before, after) {
  const value = readFileSync(path, "utf8");
  const matches = value.split(before).length - 1;
  if (matches !== 1) throw new Error(`Expected one hardening match in ${path}; found ${matches}`);
  writeFileSync(path, value.replace(before, after));
}

const rustVersion = output("rustc", ["--version"], directory);
if (!rustVersion.startsWith(`rustc ${configuration.tools.rust} `)) {
  throw new Error(`Expected Rust ${configuration.tools.rust}; received ${rustVersion}`);
}
const rustVerbose = output("rustc", ["-vV"], directory);
const host = rustVerbose.match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("Unable to determine the Rust host target");
const target = process.env.DRONEWORKS_NATIVE_TARGET ?? host;

const cyclonedx = process.env.CARGO_CYCLONEDX_BIN ?? "cargo-cyclonedx";
if (!output(cyclonedx, ["cyclonedx", "--version"], directory).includes(configuration.tools.cargo_cyclonedx)) {
  throw new Error("Unexpected cargo-cyclonedx version");
}

run("git", ["init", sourceRoot]);
run("git", ["-C", sourceRoot, "remote", "add", "upstream", configuration.upstream.repository]);
run("git", ["-C", sourceRoot, "fetch", "--depth", "1", "upstream", configuration.upstream.commit]);
run("git", ["-C", sourceRoot, "checkout", "--detach", configuration.upstream.commit]);
if (output("git", ["-C", sourceRoot, "rev-parse", "HEAD"]) !== configuration.upstream.commit) {
  throw new Error("Upstream source commit verification failed");
}

replaceExact(
  join(sourceRoot, "Cargo.toml"),
  'members = ["dji-log-parser", "dji-log-cli", "dji-log-parser-js"]',
  `members = ["dji-log-parser", "dji-log-cli", "dji-log-parser-js", "${crateName}"]`,
);
replaceExact(join(sourceRoot, "Cargo.toml"), 'async-channel = "2.0"\n', "");
replaceExact(join(sourceRoot, "Cargo.toml"), 'ureq = { version = "2.0", features = ["json"] }\n', "");

const coreManifest = join(sourceRoot, "dji-log-parser", "Cargo.toml");
replaceExact(coreManifest, '[features]\nnative-async = ["async-channel"]\n\n', "");
replaceExact(
  coreManifest,
  '[target.\'cfg(not(target_arch = "wasm32"))\'.dependencies]\nasync-channel = { workspace = true, optional = true }\nureq = { workspace = true, features = ["json"] }\n\n',
  "",
);

const libraryPath = join(sourceRoot, "dji-log-parser", "src", "lib.rs");
const library = readFileSync(libraryPath, "utf8");
const fetchStart = library.indexOf("    /// Fetches keychains using the provided API key.");
const fetchEnd = library.indexOf("    /// Retrieves the parsed raw records", fetchStart);
if (fetchStart < 0 || fetchEnd < 0) throw new Error("Unable to remove provider methods");
writeFileSync(libraryPath, `${library.slice(0, fetchStart)}${library.slice(fetchEnd)}`);
cpSync(join(directory, "keychain-api.rs"), join(sourceRoot, "dji-log-parser", "src", "keychain", "api.rs"));
run("git", ["apply", "--unidiff-zero", "--check", join(directory, "decoder-hardening.patch")], { cwd: sourceRoot });
run("git", ["apply", "--unidiff-zero", join(directory, "decoder-hardening.patch")], { cwd: sourceRoot });

const crateRoot = join(sourceRoot, crateName);
mkdirSync(join(crateRoot, "src"), { recursive: true });
cpSync(join(directory, "Cargo.toml"), join(crateRoot, "Cargo.toml"));
cpSync(join(directory, "src", "main.rs"), join(crateRoot, "src", "main.rs"));

run("cargo", ["test", "--release", "--target", target, "--package", crateName], { cwd: sourceRoot });
run("cargo", ["build", "--release", "--target", target, "--package", crateName, "--locked"], { cwd: sourceRoot });
const executableName = process.platform === "win32" ? `${crateName}.exe` : crateName;
const built = join(sourceRoot, "target", target, "release", executableName);
const artifact = join(outputRoot, executableName);
cpSync(built, artifact);

const tree = output("cargo", ["tree", "--locked", "--target", target, "--package", crateName], sourceRoot);
if (/\b(ureq|async-channel)\b/.test(tree)) {
  throw new Error("Provider networking remains in the native dependency graph");
}
const bytes = readFileSync(artifact);
const text = bytes.toString("latin1");
if (/dev\.dji\.com|Api-Key|fetch_keychains|ureq/.test(text)) {
  throw new Error("Forbidden provider networking marker remains in native artifact");
}

const sbomName = "droneworks-native-sbom";
run(cyclonedx, [
  "cyclonedx",
  "--manifest-path",
  join(crateRoot, "Cargo.toml"),
  "--format",
  "json",
  "--target",
  target,
  "--spec-version",
  "1.5",
  "--override-filename",
  sbomName,
], {
  cwd: sourceRoot,
  env: { ...process.env, SOURCE_DATE_EPOCH: String(configuration.upstream.source_date_epoch) },
});
const generatedSbom = join(crateRoot, `${sbomName}.json`);
if (!existsSync(generatedSbom)) throw new Error("CycloneDX SBOM was not generated");
const generatedSbomValue = readFileSync(generatedSbom, "utf8");
const localBomPrefix = `path+${pathToFileURL(sourceRoot).href}`;
const localBomReferenceCount = generatedSbomValue.split(localBomPrefix).length - 1;
if (localBomReferenceCount < 1) {
  throw new Error("Expected local source references in the generated native SBOM");
}
const stableBomPrefix = `${configuration.upstream.repository.replace(/\.git$/, "")}/tree/${configuration.upstream.commit}`;
const normalizedSbomValue = generatedSbomValue.replaceAll(localBomPrefix, stableBomPrefix);
if (normalizedSbomValue.includes(sourceRoot)) throw new Error("Local build path remains in normalized native SBOM");
const normalizedSbom = JSON.parse(normalizedSbomValue);
normalizedSbom.serialNumber ??= `urn:uuid:${deterministicUuid([
  configuration.upstream.commit,
  target,
  normalizedSbomValue,
].join("\0"))}`;
if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedSbom.serialNumber)) {
  throw new Error("Native SBOM serial number is not a deterministic UUID URN");
}
writeFileSync(join(outputRoot, "sbom.cdx.json"), `${JSON.stringify(normalizedSbom, null, 2)}\n`);

run("node", [
  join(directory, "..", "internal-build", "generate-compliance.mjs"),
  sourceRoot,
  outputRoot,
  crateName,
  target,
  "exclude-root",
]);

const artifactSha256 = sha256(artifact);
const internalDirectory = join(directory, "..", "internal-build");
const inputFiles = [
  ["native-cli/Cargo.toml", join(directory, "Cargo.toml")],
  ["native-cli/build.mjs", join(directory, "build.mjs")],
  ["native-cli/keychain-api.rs", join(directory, "keychain-api.rs")],
  ["native-cli/intermediate.schema.json", join(directory, "intermediate.schema.json")],
  ["native-cli/decoder-hardening.patch", join(directory, "decoder-hardening.patch")],
  ["native-cli/src/main.rs", join(directory, "src", "main.rs")],
  ["internal-build/source.json", join(internalDirectory, "source.json")],
  ["internal-build/generate-compliance.mjs", join(internalDirectory, "generate-compliance.mjs")],
  ["internal-build/license-overrides.json", join(internalDirectory, "license-overrides.json")],
  ["internal-build/license-overrides/binrw-LICENSE", join(internalDirectory, "license-overrides", "binrw-LICENSE")],
  ["internal-build/license-overrides/gloo-LICENSE-APACHE", join(internalDirectory, "license-overrides", "gloo-LICENSE-APACHE")],
  ["internal-build/license-overrides/gloo-LICENSE-MIT", join(internalDirectory, "license-overrides", "gloo-LICENSE-MIT")],
].map(([name, path]) => ({ name, sha256: sha256(path) }));
const manifest = {
  schema_version: 1,
  source: configuration.upstream,
  target,
  tools: {
    rustc: rustVersion,
    cargo: output("cargo", ["--version"], sourceRoot),
    cargo_cyclonedx: output(cyclonedx, ["cyclonedx", "--version"], sourceRoot),
  },
  hardening: {
    provider_network_source_removed: true,
    provider_network_dependencies_removed: true,
    panic_to_structured_failure: true,
    short_record_reads_return_io_errors: true,
    truncation_basis: "incomplete_v13_envelope_valid_prefix_and_declared_duration_gap",
    keychain_transport: "bounded_stdin",
  },
  artifact: {
    name: basename(artifact),
    bytes: bytes.length,
    sha256: artifactSha256,
  },
  inputs: {
    cargo_lock_sha256: sha256(join(sourceRoot, "Cargo.lock")),
    files: inputFiles,
  },
};
writeFileSync(join(outputRoot, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const evidenceFiles = files(outputRoot).sort().map((name) => ({
  name,
  bytes: statSync(join(outputRoot, name)).size,
  sha256: sha256(join(outputRoot, name)),
}));
writeFileSync(join(outputRoot, "build-evidence.json"), `${JSON.stringify({
  schema_version: 1,
  source: configuration.upstream,
  target,
  files: evidenceFiles,
}, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({ status: "built", target, ...manifest.artifact }, null, 2)}\n`);
