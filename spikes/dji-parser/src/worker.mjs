import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { DJILog } from "dji-log-parser-js";
import { validateKeychainResponse } from "./keychain/validation.mjs";

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

async function readSensitiveInput(maxBytes = 262_144) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > maxBytes) {
      for (const stored of chunks) {
        stored.fill(0);
      }
      throw new Error("Sensitive parser input exceeds the limit");
    }
    chunks.push(Buffer.from(chunk));
  }

  const bytes = Buffer.concat(chunks);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    bytes.fill(0);
    for (const stored of chunks) {
      stored.fill(0);
    }
  }
}

function frameSummary(frames) {
  let previousTime = -Infinity;
  let timeMonotonic = true;
  let coordinatesInBounds = true;
  let batteryInBounds = true;
  let location = false;
  let battery = false;
  let signal = false;
  let attitude = false;

  for (const frame of frames) {
    const flyTime = frame?.osd?.flyTime;
    if (Number.isFinite(flyTime)) {
      if (flyTime < previousTime) {
        timeMonotonic = false;
      }
      previousTime = flyTime;
    }

    const latitude = frame?.osd?.latitude;
    const longitude = frame?.osd?.longitude;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      location = location || latitude !== 0 || longitude !== 0;
      coordinatesInBounds = coordinatesInBounds
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180;
    }

    const charge = frame?.battery?.chargeLevel;
    if (Number.isFinite(charge)) {
      battery = true;
      batteryInBounds = batteryInBounds && charge >= 0 && charge <= 100;
    }

    signal = signal
      || Number.isFinite(frame?.rc?.uplinkSignal)
      || Number.isFinite(frame?.rc?.downlinkSignal);
    attitude = attitude
      || Number.isFinite(frame?.osd?.pitch)
      || Number.isFinite(frame?.osd?.roll)
      || Number.isFinite(frame?.osd?.yaw);
  }

  return {
    validation: {
      keychain_received: true,
      secret_in_arguments: false,
      secret_in_environment: false,
      frame_count_positive: frames.length > 0,
      time_monotonic: timeMonotonic,
      coordinates_in_bounds: coordinatesInBounds,
      battery_in_bounds: batteryInBounds,
    },
    capabilities: { location, battery, signal, attitude },
  };
}

const fixtureId = argument("--fixture-id");
const fixturePath = argument("--file");
const operation = argument("--operation") ?? "probe";

if (!fixtureId || !fixturePath) {
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    status: "worker_failed",
    failure_code: "parser_internal_error",
  })}\n`);
  process.exit(2);
}

const startedAt = performance.now();
let parser;

try {
  const readStartedAt = performance.now();
  const bytes = await readFile(fixturePath);
  const readMs = performance.now() - readStartedAt;

  const parseStartedAt = performance.now();
  parser = new DJILog(bytes);
  const parseMs = performance.now() - parseStartedAt;
  const details = parser.details;
  const requiresKeychain = parser.version >= 13;

  if (operation === "build-keychain-request") {
    process.stdout.write(`${JSON.stringify({
      kind: "keychain_request",
      request: parser.keychainsRequest(),
    })}\n`);
  } else if (operation === "decode-with-keychain") {
    const sensitive = await readSensitiveInput();
    const validated = validateKeychainResponse(sensitive?.keychains);
    if (!validated.valid) {
      throw new Error("Invalid keychain input");
    }

    const decodeStartedAt = performance.now();
    const frames = parser.frames(sensitive.keychains);
    const decodeMs = performance.now() - decodeStartedAt;
    const summary = frameSummary(frames);
    const memory = process.memoryUsage();
    process.stdout.write(`${JSON.stringify({
      kind: "decode_summary",
      status: "decoded",
      failure_code: null,
      validation: summary.validation,
      capabilities: summary.capabilities,
      metrics: {
        frames_count: frames.length,
        decode_ms: decodeMs,
        worker_total_ms: performance.now() - startedAt,
        rss_bytes: memory.rss,
        heap_used_bytes: memory.heapUsed,
      },
    })}\n`);
  } else if (operation !== "probe") {
    throw new Error("Unsupported parser operation");
  } else {
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
  }
} catch {
  const memory = process.memoryUsage();
  const decodeOperation = operation === "decode-with-keychain";
  process.stdout.write(`${JSON.stringify({
    kind: decodeOperation ? "decode_summary" : "probe_result",
    schema_version: 1,
    fixture_id: fixtureId,
    status: decodeOperation ? "decode_failed" : "rejected",
    failure_code: decodeOperation ? "decode_failed" : "invalid_or_corrupt_prefix",
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
} finally {
  parser?.free();
}
