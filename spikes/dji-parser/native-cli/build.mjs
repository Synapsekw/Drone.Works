import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function replaceExact(path, before, after) {
  const value = readFileSync(path, "utf8");
  const matches = value.split(before).length - 1;
  if (matches !== 1) throw new Error(`Expected one hardening match in ${path}; found ${matches}`);
  writeFileSync(path, value.replace(before, after));
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

const crateRoot = join(sourceRoot, crateName);
mkdirSync(join(crateRoot, "src"), { recursive: true });
cpSync(join(directory, "Cargo.toml"), join(crateRoot, "Cargo.toml"));
cpSync(join(directory, "src", "main.rs"), join(crateRoot, "src", "main.rs"));

run("cargo", ["build", "--release", "--package", crateName], { cwd: sourceRoot });
const executableName = process.platform === "win32" ? `${crateName}.exe` : crateName;
const built = join(sourceRoot, "target", "release", executableName);
const artifact = join(outputRoot, executableName);
cpSync(built, artifact);

const tree = output("cargo", ["tree", "--package", crateName], sourceRoot);
if (/\b(ureq|async-channel)\b/.test(tree)) {
  throw new Error("Provider networking remains in the native dependency graph");
}
const bytes = readFileSync(artifact);
const text = bytes.toString("latin1");
if (/dev\.dji\.com|Api-Key|fetch_keychains|ureq/.test(text)) {
  throw new Error("Forbidden provider networking marker remains in native artifact");
}

const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema_version: 1,
  source: configuration.upstream,
  tools: {
    rustc: output("rustc", ["--version"], sourceRoot),
    cargo: output("cargo", ["--version"], sourceRoot),
  },
  hardening: {
    provider_network_source_removed: true,
    provider_network_dependencies_removed: true,
    panic_to_structured_failure: true,
    keychain_transport: "bounded_stdin",
  },
  artifact: {
    name: basename(artifact),
    bytes: bytes.length,
    sha256,
  },
};
writeFileSync(join(outputRoot, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: "built", ...manifest.artifact }, null, 2)}\n`);
