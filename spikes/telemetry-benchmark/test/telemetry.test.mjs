import assert from "node:assert/strict";
import test from "node:test";
import {
  FLAG_GAP,
  FLAG_WARNING,
  codecCapabilities,
  compressTelemetry,
  decompressTelemetry,
  generateSyntheticTelemetry,
  telemetryPoints,
} from "../src/codec.mjs";
import { downsampleTelemetry, pageTelemetry, telemetrySummary } from "../src/downsample.mjs";

test("versioned columnar objects round-trip deterministically", () => {
  for (const version of [1, 2]) {
    const source = generateSyntheticTelemetry({ sampleCount: 6_000, variant: 9, version });
    const first = compressTelemetry(source);
    const second = compressTelemetry(source);
    assert.deepEqual(first, second);
    const decoded = decompressTelemetry(first);
    assert.equal(decoded.version, version);
    assert.equal(decoded.sampleCount, 6_000);
    assert.deepEqual(compressTelemetry(decoded), first);
  }
});

test("default replay preserves endpoints, extrema, warnings, and explicit gaps", () => {
  const full = telemetryPoints(generateSyntheticTelemetry({ sampleCount: 6_000, variant: 4 }));
  const replay = downsampleTelemetry(full, 1_000);
  assert.equal(replay.length, 1_000);
  assert.equal(replay[0].elapsed_ms, full[0].elapsed_ms);
  assert.equal(replay.at(-1).elapsed_ms, full.at(-1).elapsed_ms);
  assert.deepEqual(telemetrySummary(replay), telemetrySummary(full));
  assert.ok(replay.some((point) => (point.flags & FLAG_WARNING) !== 0));
  assert.ok(replay.some((point) => (point.flags & FLAG_GAP) !== 0));
  const firstGap = full.findIndex((point) => (point.flags & FLAG_GAP) !== 0);
  const lastGap = full.findLastIndex((point) => (point.flags & FLAG_GAP) !== 0);
  const replayIndexes = new Set(replay.map((point) => point.index));
  assert.ok(replayIndexes.has(firstGap - 1));
  assert.ok(replayIndexes.has(firstGap));
  assert.ok(replayIndexes.has(lastGap));
  assert.ok(replayIndexes.has(lastGap + 1));
});

test("full access is cursor-bounded and rejects oversized pages", () => {
  const points = telemetryPoints(generateSyntheticTelemetry({ sampleCount: 6_000 }));
  let cursor = 0;
  let delivered = 0;
  while (cursor !== null) {
    const page = pageTelemetry(points, { cursor, limit: 1_000 });
    assert.ok(page.items.length <= 1_000);
    delivered += page.items.length;
    cursor = page.nextCursor;
  }
  assert.equal(delivered, 6_000);
  assert.throws(() => pageTelemetry(points, { limit: 2_001 }), /between 1 and 2000/);
});

test("old version remains readable after additive capability evolution", () => {
  const oldObject = decompressTelemetry(compressTelemetry(generateSyntheticTelemetry({ version: 1 })));
  const newObject = decompressTelemetry(compressTelemetry(generateSyntheticTelemetry({ version: 2 })));
  assert.equal(codecCapabilities(oldObject.version).columns.includes("motor_temperature_c"), false);
  assert.equal(codecCapabilities(newObject.version).columns.includes("motor_temperature_c"), true);
  assert.equal(telemetryPoints(oldObject)[0].motor_temperature_c, undefined);
  assert.equal(typeof telemetryPoints(newObject)[0].motor_temperature_c, "number");
});
