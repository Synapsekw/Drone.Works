import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { DJILog } from "dji-log-parser-js";

globalThis.fetch = async () => {
  throw new Error("Network access is disabled in the parser probe");
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeEnumText(value) {
  if (typeof value !== "string") {
    return null;
  }

  return value.replaceAll(/[^a-zA-Z0-9 ._+-]/g, "").slice(0, 80) || null;
}

const fixtureId = argument("--fixture-id");
const fixturePath = argument("--file");

if (!fixtureId || !fixturePath) {
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    status: "worker_failed",
    failure_code: "parser_internal_error",
  })}\n`);
  process.exit(2);
}

const startedAt = performance.now();

try {
  const readStartedAt = performance.now();
  const bytes = await readFile(fixturePath);
  const readMs = performance.now() - readStartedAt;

  const parseStartedAt = performance.now();
  const parser = new DJILog(bytes);
  const parseMs = performance.now() - parseStartedAt;
  const details = parser.details;
  const requiresKeychain = parser.version >= 13;
  const memory = process.memoryUsage();

  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    fixture_id: fixtureId,
    status: requiresKeychain ? "encrypted_key_required" : "detected",
    failure_code: requiresKeychain ? "encrypted_key_required" : null,
    format_family: "dji_txt",
    format_version: parser.version,
    encryption: requiresKeychain ? "keychain_required" : "none",
    source: {
      platform: safeEnumText(details?.appPlatform),
      application_version: safeEnumText(details?.appVersion),
      product_type: safeEnumText(details?.productType),
    },
    metrics: {
      bytes: bytes.length,
      read_ms: readMs,
      parse_ms: parseMs,
      worker_total_ms: performance.now() - startedAt,
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
    },
  })}\n`);
} catch {
  const memory = process.memoryUsage();
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    fixture_id: fixtureId,
    status: "rejected",
    failure_code: "invalid_or_corrupt_prefix",
    format_family: null,
    format_version: null,
    encryption: "unknown",
    source: {},
    metrics: {
      worker_total_ms: performance.now() - startedAt,
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
    },
  })}\n`);
  process.exitCode = 2;
}
