import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const referenceModule = resolve(process.argv[2] ?? "");
const internalModule = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node compare-artifacts.mjs <reference-module> <internal-module>");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function inspect(path) {
  const module = await import(pathToFileURL(path));
  const parser = module.DJILog;
  if (typeof parser !== "function") throw new Error(`DJILog is not exported by ${path}`);
  return {
    bytes: statSync(path).size,
    sha256: sha256(path),
    exports: Object.keys(module).sort(),
    methods: Object.getOwnPropertyNames(parser.prototype).sort(),
  };
}

const reference = await inspect(referenceModule);
const internal = await inspect(internalModule);
const addedMethods = internal.methods.filter((name) => !reference.methods.includes(name));
const removedMethods = reference.methods.filter((name) => !internal.methods.includes(name));

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  reference,
  internal,
  api_difference: { added_methods: addedMethods, removed_methods: removedMethods },
  expected_hardening: removedMethods.length === 1 && removedMethods[0] === "fetchKeychains",
}, null, 2)}\n`);
