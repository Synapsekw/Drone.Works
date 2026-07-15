import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { validateKeychainResponse } from "./validation.mjs";

const macosSandboxExecutable = "/usr/bin/sandbox-exec";
const macosNoNetworkProfile = "(version 1) (allow default) (deny network*)";
const CAPABILITIES = new Set([
  "altitude",
  "attitude",
  "battery",
  "gps",
  "position",
  "signal",
  "velocity",
]);

function minimalEnvironment() {
  return {
    LANG: process.env.LANG ?? "C",
    LC_ALL: process.env.LC_ALL ?? "C",
    PATH: process.env.PATH ?? "",
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  };
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function integerNonNegative(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function failure(fixtureId, failureCode, processMetrics = null) {
  return {
    schema_version: 1,
    fixture_id: fixtureId,
    status: "decode_failed",
    failure_code: failureCode,
    metrics: null,
    process: processMetrics,
  };
}

function sanitizeSummary(raw, fixtureId, processMetrics) {
  if (raw?.kind !== "decode_summary" || raw?.status !== "decoded") {
    return failure(fixtureId, raw?.failure_code ?? "invalid_worker_output", processMetrics);
  }
  const workerTotalMs = finiteNonNegative(raw?.metrics?.worker_total_ms);
  return {
    schema_version: 1,
    fixture_id: fixtureId,
    status: "decoded",
    failure_code: null,
    validation: {
      keychain_received: raw?.validation?.keychain_received === true,
      secret_in_arguments: raw?.validation?.secret_in_arguments === true,
      secret_in_environment: raw?.validation?.secret_in_environment === true,
      frame_count_positive: raw?.validation?.frame_count_positive === true,
      time_monotonic: raw?.validation?.time_monotonic === true,
      coordinates_in_bounds: raw?.validation?.coordinates_in_bounds === true,
      battery_in_bounds: raw?.validation?.battery_in_bounds === true,
    },
    capabilities: {
      location: raw?.capabilities?.location === true,
      battery: raw?.capabilities?.battery === true,
      signal: raw?.capabilities?.signal === true,
      attitude: raw?.capabilities?.attitude === true,
    },
    metrics: {
      frames_count: integerNonNegative(raw?.metrics?.frames_count),
      read_ms: finiteNonNegative(raw?.metrics?.read_ms),
      parse_ms: finiteNonNegative(raw?.metrics?.parse_ms),
      decode_ms: finiteNonNegative(raw?.metrics?.decode_ms),
      worker_total_ms: workerTotalMs,
      max_rss_bytes: integerNonNegative(raw?.metrics?.max_rss_bytes),
      supervisor_wall_ms: finiteNonNegative(processMetrics?.supervisor_wall_ms),
      supervisor_overhead_ms: workerTotalMs === null
        ? null
        : Math.max(0, processMetrics.supervisor_wall_ms - workerTotalMs),
    },
    process: processMetrics,
  };
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length < 1)) {
    throw new TypeError(`${name} must be a string array`);
  }
  const sortedUnique = [...new Set(value)].sort();
  if (JSON.stringify(value) !== JSON.stringify(sortedUnique)) {
    throw new TypeError(`${name} must be sorted and unique`);
  }
}

async function hashSource(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
    chunk.fill(0);
  }
  return { sha256: hash.digest("hex"), bytes };
}

function assertNullableFinite(value, name) {
  if (value !== null && !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite or null`);
  }
}

function assertNullableNonNegativeInteger(value, name) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`${name} must be a non-negative integer or null`);
  }
}

function assertExactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${name} has unexpected or missing fields`);
  }
}

function assertVector(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  for (const key of keys) assertNullableFinite(value[key], `${name}.${key}`);
}

export function validateNativeIntermediate(raw, expectedSourceSha256, expectedSourceBytes) {
  assertExactKeys(raw, ["schema_version", "kind", "parser", "source", "flights"], "intermediate");
  if (raw?.schema_version !== 1 || raw?.kind !== "dji_parser_intermediate") {
    throw new TypeError("Unexpected intermediate contract");
  }
  assertExactKeys(raw.parser, ["id", "version", "source_commit"], "parser");
  if (raw?.parser?.id !== "dji-log-parser"
    || typeof raw?.parser?.version !== "string"
    || !/^[0-9a-f]{40}$/.test(raw?.parser?.source_commit ?? "")) {
    throw new TypeError("Invalid intermediate parser identity");
  }
  assertExactKeys(raw.source, ["sha256", "bytes", "format_family", "format_version"], "source");
  if (!/^[0-9a-f]{64}$/.test(raw?.source?.sha256 ?? "")
    || raw?.source?.format_family !== "dji_txt"
    || !Number.isSafeInteger(raw?.source?.bytes)
    || raw.source.bytes < 1
    || !Number.isSafeInteger(raw?.source?.format_version)) {
    throw new TypeError("Invalid intermediate source identity");
  }
  if (expectedSourceSha256 && raw.source.sha256 !== expectedSourceSha256) {
    throw new TypeError("Intermediate source hash does not match the authorized manifest");
  }
  if (expectedSourceBytes !== undefined && raw.source.bytes !== expectedSourceBytes) {
    throw new TypeError("Intermediate source byte count does not match the authorized source");
  }
  if (!Array.isArray(raw?.flights) || raw.flights.length < 1) {
    throw new TypeError("Intermediate result must contain a flight");
  }

  let sampleCount = 0;
  let positionSampleCount = 0;
  let batterySampleCount = 0;
  let signalSampleCount = 0;
  let elapsedMinimum = null;
  let elapsedMaximum = null;
  const capabilities = new Set();
  for (const [flightIndex, flight] of raw.flights.entries()) {
    assertExactKeys(
      flight,
      ["flight_index", "imported", "capabilities", "sample_count", "samples"],
      "flight",
    );
    if (!Number.isSafeInteger(flight?.flight_index)
      || flight.flight_index !== flightIndex
      || !Array.isArray(flight?.samples)
      || flight.sample_count !== flight.samples.length
      || !Array.isArray(flight?.capabilities)
      || flight.capabilities.some((value) => !CAPABILITIES.has(value))) {
      throw new TypeError("Invalid intermediate flight shape");
    }
    const sortedCapabilities = [...new Set(flight.capabilities)].sort();
    if (JSON.stringify(flight.capabilities) !== JSON.stringify(sortedCapabilities)) {
      throw new TypeError("Intermediate capabilities must be sorted and unique");
    }
    const imported = flight?.imported;
    assertExactKeys(imported, [
      "takeoff_time_utc",
      "declared_duration_ms",
      "declared_distance_m",
      "declared_max_height_m",
      "declared_max_horizontal_speed_mps",
      "declared_max_vertical_speed_mps",
      "aircraft_name",
      "aircraft_model",
      "application_platform",
      "application_version",
      "identifiers",
    ], "imported");
    if (typeof imported?.takeoff_time_utc !== "string"
      || !Number.isFinite(Date.parse(imported.takeoff_time_utc))) {
      throw new TypeError("Invalid intermediate takeoff time");
    }
    assertNullableNonNegativeInteger(imported.declared_duration_ms, "imported.declared_duration_ms");
    for (const key of [
      "declared_distance_m",
      "declared_max_height_m",
      "declared_max_horizontal_speed_mps",
      "declared_max_vertical_speed_mps",
    ]) assertNullableFinite(imported[key], `imported.${key}`);
    for (const key of ["aircraft_name", "application_version"]) {
      if (imported[key] !== null && typeof imported[key] !== "string") {
        throw new TypeError(`imported.${key} must be a string or null`);
      }
    }
    const identifiers = flight?.imported?.identifiers;
    assertExactKeys(identifiers, [
      "aircraft_serials",
      "battery_serials",
      "camera_serials",
      "controller_serials",
    ], "identifiers");
    assertStringArray(identifiers?.aircraft_serials, "aircraft_serials");
    assertStringArray(identifiers?.battery_serials, "battery_serials");
    assertStringArray(identifiers?.camera_serials, "camera_serials");
    assertStringArray(identifiers?.controller_serials, "controller_serials");
    for (const capability of flight.capabilities) capabilities.add(capability);
    let previousElapsed = -Infinity;
    for (const sample of flight.samples) {
      assertExactKeys(sample, [
        "elapsed_ms",
        "position",
        "altitude_msl_m",
        "height_agl_m",
        "velocity",
        "attitude",
        "battery",
        "gps",
        "signal",
      ], "sample");
      if (sample?.elapsed_ms !== null) {
        if (!Number.isSafeInteger(sample?.elapsed_ms)
          || sample.elapsed_ms < 0
          || sample.elapsed_ms < previousElapsed) {
          throw new TypeError("Intermediate elapsed time is invalid or non-monotonic");
        }
        previousElapsed = sample.elapsed_ms;
        elapsedMinimum = elapsedMinimum === null
          ? sample.elapsed_ms
          : Math.min(elapsedMinimum, sample.elapsed_ms);
        elapsedMaximum = elapsedMaximum === null
          ? sample.elapsed_ms
          : Math.max(elapsedMaximum, sample.elapsed_ms);
      }
      if (sample?.position !== null) {
        assertExactKeys(sample.position, ["latitude_deg", "longitude_deg"], "sample.position");
        const latitude = sample?.position?.latitude_deg;
        const longitude = sample?.position?.longitude_deg;
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
          || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          throw new TypeError("Intermediate position is out of bounds");
        }
        positionSampleCount += 1;
      }
      assertNullableFinite(sample?.altitude_msl_m, "sample.altitude_msl_m");
      assertNullableFinite(sample?.height_agl_m, "sample.height_agl_m");
      assertExactKeys(sample?.velocity, ["x_mps", "y_mps", "z_mps"], "sample.velocity");
      assertVector(sample?.velocity, ["x_mps", "y_mps", "z_mps"], "sample.velocity");
      assertExactKeys(sample?.attitude, ["pitch_deg", "roll_deg", "yaw_deg"], "sample.attitude");
      assertVector(sample?.attitude, ["pitch_deg", "roll_deg", "yaw_deg"], "sample.attitude");
      if (sample?.battery !== null) {
        assertExactKeys(
          sample.battery,
          ["charge_percent", "voltage_v", "current_a", "temperature_c"],
          "sample.battery",
        );
        if (!Number.isSafeInteger(sample?.battery?.charge_percent)
          || sample.battery.charge_percent < 0
          || sample.battery.charge_percent > 100) {
          throw new TypeError("Intermediate battery charge is out of bounds");
        }
        for (const key of ["voltage_v", "current_a", "temperature_c"]) {
          assertNullableFinite(sample.battery[key], `sample.battery.${key}`);
        }
        batterySampleCount += 1;
      }
      assertExactKeys(sample?.gps, ["satellites", "signal_level", "position_used"], "sample.gps");
      if (!Number.isSafeInteger(sample?.gps?.satellites)
        || sample.gps.satellites < 0
        || !Number.isSafeInteger(sample?.gps?.signal_level)
        || sample.gps.signal_level < 0
        || typeof sample?.gps?.position_used !== "boolean") {
        throw new TypeError("Intermediate GPS sample is invalid");
      }
      if (sample?.signal !== null) {
        assertExactKeys(sample.signal, ["uplink_percent", "downlink_percent"], "sample.signal");
        for (const key of ["uplink_percent", "downlink_percent"]) {
          const value = sample.signal[key];
          if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 100)) {
            throw new TypeError(`Intermediate signal ${key} is out of bounds`);
          }
        }
        signalSampleCount += 1;
      }
    }
    sampleCount += flight.samples.length;
  }

  return {
    flight_count: raw.flights.length,
    sample_count: sampleCount,
    position_sample_count: positionSampleCount,
    battery_sample_count: batterySampleCount,
    signal_sample_count: signalSampleCount,
    elapsed_span_ms: elapsedMinimum === null || elapsedMaximum === null
      ? null
      : elapsedMaximum - elapsedMinimum,
    capabilities: [...capabilities].sort(),
    source_hash_verified: Boolean(expectedSourceSha256),
  };
}

class PrivateIntermediate {
  #value;

  constructor(result, value) {
    this.result = Object.freeze(structuredClone(result));
    this.#value = structuredClone(value);
  }

  valueForNormalizer() {
    return structuredClone(this.#value);
  }

  toJSON() {
    return this.result;
  }
}

async function executeNative({
  fixturePath,
  nativeExecutable,
  nativeArgs = [],
  keychains,
  outputMode,
  networkIsolation,
  timeoutMs,
  maxInputBytes,
  maxOutputBytes,
}) {
  await access(fixturePath);
  await access(nativeExecutable);
  const input = Buffer.from(JSON.stringify({ keychains }));
  if (input.length > maxInputBytes) {
    input.fill(0);
    return { ok: false, failure_code: "parser_input_limit", process: null };
  }

  const output = [];
  const errors = [];
  let totalOutputBytes = 0;
  let outputLimited = false;
  let timedOut = false;
  let executable = nativeExecutable;
  let args = [...nativeArgs, fixturePath];
  if (outputMode === "intermediate") args.push("--output", "intermediate");
  let networkIsolationMethod = "none";
  if (networkIsolation === "require") {
    if (process.platform !== "darwin") {
      input.fill(0);
      return { ok: false, failure_code: "network_isolation_unavailable", process: null };
    }
    await access(macosSandboxExecutable);
    args = ["-p", macosNoNetworkProfile, nativeExecutable, ...args];
    executable = macosSandboxExecutable;
    networkIsolationMethod = "macos_sandbox_exec";
  } else if (networkIsolation !== "test_only_none") {
    input.fill(0);
    throw new TypeError("networkIsolation must be require or test_only_none");
  }

  const started = performance.now();
  const child = spawn(executable, args, {
    env: minimalEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();

  for (const [stream, chunks] of [[child.stdout, output], [child.stderr, errors]]) {
    stream.on("data", (chunk) => {
      totalOutputBytes += chunk.length;
      if (totalOutputBytes <= maxOutputBytes) chunks.push(Buffer.from(chunk));
      if (totalOutputBytes > maxOutputBytes && !outputLimited) {
        outputLimited = true;
        child.kill("SIGKILL");
      }
    });
  }
  const outcome = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  input.fill(0);
  const stdout = Buffer.concat(output);
  const stderr = Buffer.concat(errors);
  const processMetrics = {
    supervisor_wall_ms: performance.now() - started,
    child_exit_code: outcome.code ?? null,
    child_signal: outcome.signal ?? null,
    input_bytes: input.length,
    stdout_bytes: stdout.length,
    stderr_bytes: stderr.length,
    total_output_bytes: totalOutputBytes,
    max_output_bytes: maxOutputBytes,
    network_isolation: networkIsolationMethod,
  };
  if (timedOut) return { ok: false, failure_code: "parser_wall_time_limit", process: processMetrics };
  if (outputLimited) return { ok: false, failure_code: "parser_output_limit", process: processMetrics };
  if (outcome.error) return { ok: false, failure_code: "parser_internal_error", process: processMetrics };
  try {
    const raw = JSON.parse(stdout.toString("utf8").trim());
    if (outcome.code !== 0) {
      stdout.fill(0);
      return { ok: false, raw, process: processMetrics };
    }
    return { ok: true, raw, bytes: stdout, process: processMetrics };
  } catch {
    return { ok: false, failure_code: "invalid_worker_output", process: processMetrics };
  } finally {
    stderr.fill(0);
  }
}

function validatedKeychains(keychains, fixtureId) {
  const validated = validateKeychainResponse(keychains);
  return validated.valid ? null : failure(fixtureId, validated.code);
}

export async function runNativeSummary(options) {
  const invalid = validatedKeychains(options.keychains, options.fixtureId);
  if (invalid) return invalid;
  const execution = await executeNative({
    ...options,
    outputMode: "summary",
    networkIsolation: options.networkIsolation ?? "require",
    timeoutMs: options.timeoutMs ?? 10_000,
    maxInputBytes: options.maxInputBytes ?? 262_144,
    maxOutputBytes: options.maxOutputBytes ?? 65_536,
  });
  if (!execution.ok) {
    return failure(options.fixtureId, execution.raw?.failure_code ?? execution.failure_code, execution.process);
  }
  return sanitizeSummary(execution.raw, options.fixtureId, execution.process);
}

export async function runNativeIntermediate(options) {
  const invalid = validatedKeychains(options.keychains, options.fixtureId);
  if (invalid) return new PrivateIntermediate(invalid, null);
  let trustedSource;
  try {
    trustedSource = await hashSource(options.fixturePath);
  } catch {
    return new PrivateIntermediate(failure(options.fixtureId, "source_unavailable"), null);
  }
  if (options.expectedSourceSha256
    && trustedSource.sha256 !== options.expectedSourceSha256) {
    return new PrivateIntermediate(failure(options.fixtureId, "source_hash_mismatch"), null);
  }
  const execution = await executeNative({
    ...options,
    outputMode: "intermediate",
    networkIsolation: options.networkIsolation ?? "require",
    timeoutMs: options.timeoutMs ?? 15_000,
    maxInputBytes: options.maxInputBytes ?? 262_144,
    maxOutputBytes: options.maxOutputBytes ?? 32 * 1024 * 1024,
  });
  if (!execution.ok) {
    return new PrivateIntermediate(
      failure(options.fixtureId, execution.raw?.failure_code ?? execution.failure_code, execution.process),
      null,
    );
  }
  try {
    const shape = validateNativeIntermediate(
      execution.raw,
      trustedSource.sha256,
      trustedSource.bytes,
    );
    const digest = createHash("sha256").update(execution.bytes).digest("hex");
    const result = new PrivateIntermediate({
      schema_version: 1,
      fixture_id: options.fixtureId,
      status: "intermediate_ready",
      failure_code: null,
      contract: { kind: "dji_parser_intermediate", schema_version: 1 },
      material: {
        sha256: digest,
        bytes: execution.bytes.length,
        bytes_per_sample: shape.sample_count > 0
          ? execution.bytes.length / shape.sample_count
          : null,
        ...shape,
      },
      process: execution.process,
    }, execution.raw);
    execution.bytes.fill(0);
    return result;
  } catch {
    execution.bytes?.fill(0);
    return new PrivateIntermediate(
      failure(options.fixtureId, "invalid_worker_output", execution.process),
      null,
    );
  }
}
