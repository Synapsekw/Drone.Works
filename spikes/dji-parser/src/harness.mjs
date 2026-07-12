import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runBatch } from "./supervisor.mjs";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../..");

function values(name) {
  const found = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      found.push(process.argv[index + 1]);
    }
  }
  return found;
}

function value(name, fallback) {
  return values(name).at(-1) ?? fallback;
}

function positiveInteger(name, fallback) {
  const raw = value(name, String(fallback));
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

const manifestPath = resolve(repositoryRoot, value("--manifest", "fixtures/manifest.json"));
if (!isInside(repositoryRoot, manifestPath)) {
  throw new Error("Manifest must resolve inside the repository");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const fixturesRoot = dirname(manifestPath);
const selectedIds = new Set(values("--fixture"));
const selected = manifest.fixtures.filter((fixture) => selectedIds.size === 0 || selectedIds.has(fixture.id));

if (selectedIds.size > 0 && selected.length !== selectedIds.size) {
  const present = new Set(selected.map((fixture) => fixture.id));
  const missing = [...selectedIds].filter((id) => !present.has(id));
  throw new Error(`Unknown fixture id(s): ${missing.join(", ")}`);
}

const fixtures = selected.map((fixture) => {
  const fixturePath = resolve(fixturesRoot, fixture.path);
  if (!isInside(fixturesRoot, fixturePath)) {
    throw new Error(`Fixture ${fixture.id} resolves outside fixtures/`);
  }
  return { fixtureId: fixture.id, fixturePath };
});

const startedAt = Date.now();
const results = await runBatch(fixtures, {
  timeoutMs: positiveInteger("--timeout-ms", 5_000),
  maxOutputBytes: positiveInteger("--max-output", 65_536),
  memoryMb: positiveInteger("--memory-mb", 128),
});

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  duration_ms: Date.now() - startedAt,
  external_network_authorized: false,
  fixture_count: results.length,
  results,
}, null, 2)}\n`);
