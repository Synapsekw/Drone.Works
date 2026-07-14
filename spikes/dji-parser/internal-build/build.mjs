import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expectedReferenceArtifacts } from "./reference-artifacts.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const configuration = JSON.parse(readFileSync(join(scriptDirectory, "source.json"), "utf8"));
const workRoot = resolve(process.argv[2] ?? join(scriptDirectory, "work"));
const outputRoot = resolve(process.argv[3] ?? join(scriptDirectory, "out"));
const sourceRoot = join(workRoot, "source");

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

function replaceExact(path, before, after) {
  const value = readFileSync(path, "utf8");
  const count = value.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected one hardening match in ${path}; found ${count}`);
  writeFileSync(path, value.replace(before, after));
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

const rustVersion = output("rustc", ["--version"], scriptDirectory);
if (!rustVersion.startsWith(`rustc ${configuration.tools.rust} `)) {
  throw new Error(`Expected Rust ${configuration.tools.rust}; received ${rustVersion}`);
}

const wasmPack = process.env.WASM_PACK_BIN ?? "wasm-pack";
const cyclonedx = process.env.CARGO_CYCLONEDX_BIN ?? "cargo-cyclonedx";
if (!output(wasmPack, ["--version"], scriptDirectory).includes(configuration.tools.wasm_pack)) {
  throw new Error("Unexpected wasm-pack version");
}
if (!output(cyclonedx, ["cyclonedx", "--version"], scriptDirectory).includes(configuration.tools.cargo_cyclonedx)) {
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
  'tsify-next = "0.5.3"',
  `tsify = "=${configuration.hardening.tsify}"`,
);
replaceExact(join(sourceRoot, "Cargo.toml"), '\nwasm-bindgen-futures = "0.4.42"', "");
replaceExact(join(sourceRoot, "Cargo.toml"), '\nweb-sys = "0.3"', "");
replaceExact(
  join(sourceRoot, "dji-log-parser", "Cargo.toml"),
  `tsify-next.workspace = true\nwasm-bindgen.workspace = true\nwasm-bindgen-futures.workspace = true\nweb-sys = { workspace = true, features = [\n    "Headers",\n    "Request",\n    "RequestInit",\n    "Response",\n] }`,
  "tsify.workspace = true\nwasm-bindgen.workspace = true",
);
replaceExact(
  join(sourceRoot, "dji-log-parser-js", "Cargo.toml"),
  "\nwasm-bindgen-futures.workspace = true",
  "",
);

let importCount = 0;
for (const path of sourceFiles(join(sourceRoot, "dji-log-parser", "src")).filter((path) => path.endsWith(".rs"))) {
  const value = readFileSync(path, "utf8");
  if (value.includes("use tsify_next::Tsify;")) {
    writeFileSync(path, value.replaceAll("use tsify_next::Tsify;", "use tsify::Tsify;"));
    importCount += 1;
  }
}
if (importCount !== configuration.hardening.expected_tsify_imports) {
  throw new Error(`Expected ${configuration.hardening.expected_tsify_imports} tsify imports; found ${importCount}`);
}

const wrapperPath = join(sourceRoot, "dji-log-parser-js", "src", "lib.rs");
const wrapper = readFileSync(wrapperPath, "utf8");
const fetchStart = wrapper.indexOf("    // Fetches keychains using the provided API key.");
const fetchEnd = wrapper.indexOf("    /// Retrieves the parsed raw records", fetchStart);
if (fetchStart < 0 || fetchEnd < 0) throw new Error("Unable to locate JS fetch export");
writeFileSync(wrapperPath, `${wrapper.slice(0, fetchStart)}${wrapper.slice(fetchEnd)}`);

const apiPath = join(sourceRoot, "dji-log-parser", "src", "keychain", "api.rs");
replaceExact(apiPath, "use crate::Result;", '#[cfg(not(target_arch = "wasm32"))]\nuse crate::Result;');
replaceExact(
  apiPath,
  'const DEFAULT_ENDPOINT: &str = "https://dev.dji.com/openapi/v1/flight-records/keychains";',
  '#[cfg(not(target_arch = "wasm32"))]\nconst DEFAULT_ENDPOINT: &str = "https://dev.dji.com/openapi/v1/flight-records/keychains";',
);
replaceExact(apiPath, '#[cfg(any(target_arch = "wasm32", feature = "native-async"))]', '#[cfg(all(not(target_arch = "wasm32"), feature = "native-async"))]');
replaceExact(
  apiPath,
  '        #[cfg(not(target_arch = "wasm32"))]\n        return native::fetch_async(api_key, endpoint, self).await;\n        #[cfg(target_arch = "wasm32")]\n        return wasm::fetch_async(api_key, endpoint, self).await;',
  "        native::fetch_async(api_key, endpoint, self).await",
);
const apiValue = readFileSync(apiPath, "utf8");
const wasmModuleStart = apiValue.indexOf('#[cfg(target_arch = "wasm32")]\npub(crate) mod wasm {');
if (wasmModuleStart < 0) throw new Error("Unable to locate core WASM fetch module");
writeFileSync(apiPath, apiValue.slice(0, wasmModuleStart).trimEnd() + "\n");

const libraryPath = join(sourceRoot, "dji-log-parser", "src", "lib.rs");
replaceExact(libraryPath, "Available on wasm and native behind the `native-async` feature.", "Available on native builds behind the `native-async` feature.");
replaceExact(libraryPath, '#[cfg(any(target_arch = "wasm32", feature = "native-async"))]', '#[cfg(all(not(target_arch = "wasm32"), feature = "native-async"))]');

run("cargo", ["update", "-p", "tsify-next@0.5.3", "--precise", configuration.hardening.tsify], { cwd: sourceRoot });
const lockPath = join(sourceRoot, "Cargo.lock");
if (sha256(lockPath) !== configuration.hardening.cargo_lock_sha256) {
  throw new Error("Hardened Cargo.lock checksum mismatch");
}

const jsCrate = join(sourceRoot, "dji-log-parser-js");
run(wasmPack, ["build", "--release", "--target", "nodejs", "--out-dir", "pkg", "--", "--locked"], { cwd: jsCrate });

const packageSource = join(jsCrate, "pkg");
const referenceArtifacts = expectedReferenceArtifacts(configuration);
for (const name of Object.keys(referenceArtifacts)) {
  const path = join(packageSource, name);
  const actual = sha256(path);
  if (actual !== referenceArtifacts[name]) {
    throw new Error(`Artifact checksum mismatch for ${name}: ${actual}`);
  }
  cpSync(path, join(outputRoot, name));
}

cpSync(join(sourceRoot, "LICENSE"), join(outputRoot, "LICENSE"));
cpSync(join(scriptDirectory, "PACKAGE-README.md"), join(outputRoot, "README.md"));

const packageJson = {
  name: "@droneworks/dji-log-parser",
  version: "0.5.7-droneworks.1",
  private: true,
  main: "dji_log_parser_js.js",
  types: "dji_log_parser_js.d.ts",
  files: [
    "dji_log_parser_js.js",
    "dji_log_parser_js_bg.wasm",
    "dji_log_parser_js.d.ts",
    "LICENSE",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "license-index.json",
    "licenses",
    "sbom.cdx.json",
    "artifact-manifest.json"
  ],
  license: "MIT",
  engines: { node: ">=22.13.0" },
};
writeFileSync(join(outputRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

run("node", [join(scriptDirectory, "generate-compliance.mjs"), sourceRoot, outputRoot]);

const sbomName = "droneworks-sbom";
run(cyclonedx, [
  "cyclonedx",
  "--manifest-path",
  join(jsCrate, "Cargo.toml"),
  "--format",
  "json",
  "--target",
  "wasm32-unknown-unknown",
  "--spec-version",
  "1.5",
  "--override-filename",
  sbomName,
], {
  cwd: sourceRoot,
  env: { ...process.env, SOURCE_DATE_EPOCH: String(configuration.upstream.source_date_epoch) },
});
const generatedSbom = join(jsCrate, `${sbomName}.json`);
if (!existsSync(generatedSbom)) throw new Error("CycloneDX SBOM was not generated");
const generatedSbomValue = readFileSync(generatedSbom, "utf8");
const localBomPrefix = `path+${pathToFileURL(sourceRoot).href}`;
const stableBomPrefix = `${configuration.upstream.repository.replace(/\.git$/, "")}/tree/${configuration.upstream.commit}`;
const localBomReferenceCount = generatedSbomValue.split(localBomPrefix).length - 1;
if (localBomReferenceCount !== configuration.hardening.expected_sbom_source_refs) {
  throw new Error(`Expected ${configuration.hardening.expected_sbom_source_refs} local SBOM references; found ${localBomReferenceCount}`);
}
const normalizedSbomValue = generatedSbomValue.replaceAll(localBomPrefix, stableBomPrefix);
if (normalizedSbomValue.includes(sourceRoot)) throw new Error("Local build path remains in normalized SBOM");
writeFileSync(join(outputRoot, "sbom.cdx.json"), normalizedSbomValue);

const require = createRequire(import.meta.url);
const builtModule = require(join(outputRoot, "dji_log_parser_js.js"));
const exports = Object.keys(builtModule).sort();
if (JSON.stringify(exports) !== JSON.stringify(configuration.expected_api.exports)) {
  throw new Error(`Unexpected parser exports: ${exports.join(",")}`);
}
const methods = Object.getOwnPropertyNames(builtModule.DJILog.prototype).sort();
if (JSON.stringify(methods) !== JSON.stringify(configuration.expected_api.methods)) {
  throw new Error(`Unexpected parser API: ${methods.join(",")}`);
}
if (methods.includes("fetchKeychains")) throw new Error("Network API remains in internal artifact");

const forbidden = /dev\.dji\.com|Api-Key|fetchKeychains|__wbg_fetch/;
for (const name of ["dji_log_parser_js.js", "dji_log_parser_js.d.ts"]) {
  if (forbidden.test(readFileSync(join(outputRoot, name), "utf8"))) {
    throw new Error(`Forbidden network surface remains in ${name}`);
  }
}

const manifestFiles = readdirSync(outputRoot)
  .filter((name) => name !== "artifact-manifest.json" && statSync(join(outputRoot, name)).isFile())
  .sort()
  .map((name) => ({ name, bytes: statSync(join(outputRoot, name)).size, sha256: sha256(join(outputRoot, name)) }));
writeFileSync(join(outputRoot, "artifact-manifest.json"), `${JSON.stringify({
  schema_version: 1,
  source: configuration.upstream,
  tools: {
    rustc: rustVersion,
    wasm_pack: output(wasmPack, ["--version"], scriptDirectory),
    cargo_cyclonedx: output(cyclonedx, ["cyclonedx", "--version"], scriptDirectory),
  },
  hardening: {
    maintained_tsify: configuration.hardening.tsify,
    wasm_network_removed: true,
    fetch_keychains_export_removed: true,
    cargo_lock_sha256: sha256(lockPath),
  },
  api: { methods },
  files: manifestFiles,
}, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  status: "built",
  source_commit: configuration.upstream.commit,
  output: outputRoot,
  methods,
}, null, 2)}\n`);
