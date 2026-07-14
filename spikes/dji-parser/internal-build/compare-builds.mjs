import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const leftRoot = resolve(process.argv[2] ?? "");
const rightRoot = resolve(process.argv[3] ?? "");

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node compare-builds.mjs <left-output> <right-output>");
}
for (const root of [leftRoot, rightRoot]) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Build output is not a directory: ${root}`);
  }
}

function files(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(root, path) : [relative(root, path)];
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const paths = [...new Set([...files(leftRoot), ...files(rightRoot)])].sort();
const differences = paths.flatMap((path) => {
  const left = join(leftRoot, path);
  const right = join(rightRoot, path);
  if (!existsSync(left)) return [{ path, reason: "missing_left" }];
  if (!existsSync(right)) return [{ path, reason: "missing_right" }];
  const leftHash = sha256(left);
  const rightHash = sha256(right);
  return leftHash === rightHash ? [] : [{ path, reason: "checksum_mismatch", left_sha256: leftHash, right_sha256: rightHash }];
});

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  file_count: paths.length,
  identical: differences.length === 0,
  differences,
}, null, 2)}\n`);

if (differences.length > 0) process.exitCode = 1;
