import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const fixturesRoot = resolve(repositoryRoot, "fixtures");
const manifestPath = resolve(fixturesRoot, "manifest.json");
const requireLocal = process.argv.includes("--require-local");

const errors = [];
const warnings = [];

function addError(fixtureId, message) {
  errors.push(`${fixtureId}: ${message}`);
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
    return false;
  }

  const normalized = value.split(/[\\/]+/);
  return !normalized.includes("..") && !normalized.includes("") && !value.includes("\0");
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyFile(fixture) {
  const path = resolve(fixturesRoot, fixture.path);

  if (!isInside(fixturesRoot, path)) {
    addError(fixture.id, "path resolves outside fixtures/");
    return;
  }

  const expectedPrefix = fixture.storage === "repository" ? "repository/" : "local/";
  const normalizedPath = fixture.path.replaceAll("\\", "/");
  if (!normalizedPath.startsWith(expectedPrefix)) {
    addError(fixture.id, `storage ${fixture.storage} requires a path under ${expectedPrefix}`);
  }

  let fileStats;
  try {
    fileStats = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT" && fixture.storage === "local_only" && !requireLocal) {
      warnings.push(`${fixture.id}: local-only file is not present in this checkout`);
      return;
    }

    addError(fixture.id, `file cannot be read: ${error.message}`);
    return;
  }

  if (!fileStats.isFile()) {
    addError(fixture.id, "path is not a regular file");
    return;
  }

  if (fileStats.size !== fixture.bytes) {
    addError(fixture.id, `byte length ${fileStats.size} does not match manifest value ${fixture.bytes}`);
  }

  const digest = await sha256(path);
  if (digest !== fixture.sha256) {
    addError(fixture.id, `SHA-256 ${digest} does not match manifest value ${fixture.sha256}`);
  }
}

function verifyFixtureShape(fixture, index, ids, hashes) {
  const id = typeof fixture?.id === "string" ? fixture.id : `fixtures[${index}]`;

  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(fixture?.id ?? "")) {
    addError(id, "id must match ^[a-z0-9][a-z0-9-]{2,63}$");
  } else if (ids.has(fixture.id)) {
    addError(id, "id is duplicated");
  } else {
    ids.add(fixture.id);
  }

  if (!isSafeRelativePath(fixture?.path)) {
    addError(id, "path must be a safe relative path without empty or parent segments");
  }

  if (!["local_only", "repository"].includes(fixture?.storage)) {
    addError(id, "storage must be local_only or repository");
  }

  if (!/^[a-f0-9]{64}$/.test(fixture?.sha256 ?? "")) {
    addError(id, "sha256 must be 64 lowercase hexadecimal characters");
  } else if (hashes.has(fixture.sha256)) {
    addError(id, "sha256 is already used by another fixture; model duplicates explicitly instead");
  } else {
    hashes.add(fixture.sha256);
  }

  if (!Number.isSafeInteger(fixture?.bytes) || fixture.bytes < 1) {
    addError(id, "bytes must be a positive safe integer");
  }

  if (!fixture?.provenance || fixture.provenance.commercial_evaluation !== true) {
    addError(id, "commercial_evaluation must be explicitly true before use");
  }

  if (fixture?.storage === "repository") {
    if (fixture.provenance?.repository_redistribution !== true) {
      addError(id, "repository fixtures require explicit repository_redistribution permission");
    }
    if (fixture.provenance?.revocable !== false) {
      addError(id, "repository fixtures cannot rely on revocable permission because Git history persists");
    }
    if (fixture.review?.status !== "approved_repository") {
      addError(id, "repository fixtures require approved_repository review status");
    }
  }

  if (fixture?.storage === "local_only" && fixture?.provenance?.repository_redistribution === true) {
    warnings.push(`${id}: redistribution is permitted but storage remains local_only`);
  }

  if (fixture?.content_kind === "derivative") {
    if (!/^[a-f0-9]{64}$/.test(fixture.derivative?.parent_sha256 ?? "")) {
      addError(id, "derivative requires a valid parent_sha256");
    }
    if (typeof fixture.derivative?.transformation !== "string" || fixture.derivative.transformation.length === 0) {
      addError(id, "derivative requires a reproducible transformation description");
    }
  }

  if (!fixture?.content_detection || fixture.content_detection.method === "extension") {
    addError(id, "content detection must be recorded and cannot rely on the filename extension");
  }

  if (!Array.isArray(fixture?.sensitive_data)) {
    addError(id, "sensitive_data must be an array of categories");
  }

  return id;
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  console.error(`Fixture manifest cannot be parsed: ${error.message}`);
  process.exit(1);
}

if (manifest.schema_version !== 1) {
  errors.push("manifest: schema_version must equal 1");
}

if (!Array.isArray(manifest.fixtures)) {
  errors.push("manifest: fixtures must be an array");
} else {
  const ids = new Set();
  const hashes = new Set();

  for (const [index, fixture] of manifest.fixtures.entries()) {
    verifyFixtureShape(fixture, index, ids, hashes);
  }

  for (const fixture of manifest.fixtures) {
    if (fixture && isSafeRelativePath(fixture.path) && ["local_only", "repository"].includes(fixture.storage)) {
      await verifyFile(fixture);
    }
  }
}

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  console.error(`Fixture verification failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Fixture verification passed for ${manifest.fixtures.length} fixture(s).`);
