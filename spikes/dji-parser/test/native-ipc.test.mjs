import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  runNativeIntermediate,
  runNativeSummary,
  validateNativeIntermediate,
} from "../src/keychain/native-ipc.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeNativeWorker = resolve(testDirectory, "../test-support/fake-native-worker.mjs");
const temporaryDirectories = [];
const keychains = [[{
  featurePoint: "BaseFeature",
  aesKey: randomBytes(32).toString("base64"),
  aesIv: randomBytes(16).toString("base64"),
}]];

async function fixture(contents = "synthetic") {
  const directory = await mkdtemp(resolve(tmpdir(), "droneworks-native-ipc-"));
  temporaryDirectories.push(directory);
  const path = resolve(directory, "fixture.bin");
  await writeFile(path, contents);
  return {
    path,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function options(source) {
  return {
    fixtureId: "native-fixture",
    fixturePath: source.path,
    nativeExecutable: process.execPath,
    nativeArgs: [fakeNativeWorker],
    expectedSourceSha256: source.sha256,
    keychains,
    networkIsolation: "test_only_none",
  };
}

test("returns native summary timing without keychain leakage", async () => {
  const source = await fixture();
  const result = await runNativeSummary(options(source));

  assert.equal(result.status, "decoded");
  assert.equal(result.metrics.frames_count, 1);
  assert.ok(result.metrics.supervisor_wall_ms >= result.metrics.worker_total_ms);
  assert.equal(result.validation.secret_in_arguments, false);
  assert.equal(result.validation.secret_in_environment, false);
  assert.equal(JSON.stringify(result).includes(keychains[0][0].aesKey), false);
});

test("keeps private intermediate values behind a sanitized summary", async () => {
  const source = await fixture();
  const first = await runNativeIntermediate(options(source));
  const second = await runNativeIntermediate(options(source));
  const serialized = JSON.stringify(first);

  assert.equal(first.result.status, "intermediate_ready");
  assert.equal(first.result.material.sample_count, 1);
  assert.equal(first.result.material.source_hash_verified, true);
  assert.equal(first.result.material.sha256, second.result.material.sha256);
  assert.equal(serialized.includes("private-aircraft-serial"), false);
  assert.equal(serialized.includes("latitude_deg"), false);
  assert.equal(first.valueForNormalizer().flights[0].samples[0].position.latitude_deg, 25);
});

test("fails closed when private output exceeds the configured bound", async () => {
  const source = await fixture("flood");
  const result = await runNativeIntermediate({ ...options(source), maxOutputBytes: 1024 });

  assert.equal(result.result.status, "decode_failed");
  assert.equal(result.result.failure_code, "parser_output_limit");
});

test("rejects a manifest source mismatch before accepting private output", async () => {
  const source = await fixture("source-mismatch");
  const result = await runNativeIntermediate({
    ...options(source),
    expectedSourceSha256: "0".repeat(64),
  });

  assert.equal(result.result.status, "decode_failed");
  assert.equal(result.result.failure_code, "source_hash_mismatch");
});

test("rejects out-of-bounds intermediate positions", () => {
  assert.throws(() => validateNativeIntermediate({
    schema_version: 1,
    kind: "dji_parser_intermediate",
    parser: {
      id: "dji-log-parser",
      version: "0.5.7",
      source_commit: "e2e0775670a8391b4f7ecc40fca4cb01ea4a90fa",
    },
    source: {
      sha256: "a".repeat(64),
      bytes: 1,
      format_family: "dji_txt",
      format_version: 14,
    },
    flights: [{
      flight_index: 0,
      imported: {
        takeoff_time_utc: "2026-01-01T00:00:00Z",
        declared_duration_ms: 0,
        declared_distance_m: 0,
        declared_max_height_m: 0,
        declared_max_horizontal_speed_mps: 0,
        declared_max_vertical_speed_mps: 0,
        aircraft_name: null,
        aircraft_model: "Synthetic",
        application_platform: "Synthetic",
        application_version: null,
        identifiers: {
          aircraft_serials: [], battery_serials: [], camera_serials: [], controller_serials: [],
        },
      },
      capabilities: ["position"],
      sample_count: 1,
      samples: [{
        elapsed_ms: 0,
        position: { latitude_deg: 100, longitude_deg: 0 },
        altitude_msl_m: null,
        height_agl_m: null,
        velocity: { x_mps: null, y_mps: null, z_mps: null },
        attitude: { pitch_deg: null, roll_deg: null, yaw_deg: null },
        battery: null,
        gps: { satellites: 0, signal_level: 0, position_used: false },
        signal: null,
      }],
    }],
  }), /out of bounds/);
});
