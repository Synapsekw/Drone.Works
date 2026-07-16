import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = "DWTC";
const HEADER_BYTES = 32;
const VERSION_1 = 1;
const VERSION_2 = 2;
const FLOAT_COLUMNS_V1 = Object.freeze([
  "route_x_m",
  "route_y_m",
  "altitude_m",
  "horizontal_speed_mps",
  "vertical_speed_mps",
  "battery_percent",
]);
const FLOAT_COLUMNS_V2 = Object.freeze([...FLOAT_COLUMNS_V1, "motor_temperature_c"]);
const COLUMN_SCALES = Object.freeze({
  route_x_m: 100,
  route_y_m: 100,
  altitude_m: 100,
  horizontal_speed_mps: 1_000,
  vertical_speed_mps: 1_000,
  battery_percent: 100,
  motor_temperature_c: 100,
});
const MISSING_INT32 = -2147483648;

export const FLAG_GAP = 1;
export const FLAG_WARNING = 2;
export const MISSING_SIGNAL = -32768;

function assertInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be an integer >= ${minimum}`);
  }
}

function floatColumns(version) {
  if (version === VERSION_1) return FLOAT_COLUMNS_V1;
  if (version === VERSION_2) return FLOAT_COLUMNS_V2;
  throw new TypeError(`unsupported telemetry codec version ${version}`);
}

export function generateSyntheticTelemetry({
  sampleCount = 6_000,
  cadenceMs = 200,
  variant = 0,
  version = VERSION_1,
} = {}) {
  assertInteger(sampleCount, "sampleCount", 8);
  assertInteger(cadenceMs, "cadenceMs", 1);
  assertInteger(variant, "variant");
  const columns = floatColumns(version);
  const telemetry = {
    version,
    sampleCount,
    cadenceMs,
    elapsed_ms: new Uint32Array(sampleCount),
    satellite_count: new Uint8Array(sampleCount),
    signal_percent: new Int16Array(sampleCount),
    flags: new Uint8Array(sampleCount),
    warning_code: new Uint8Array(sampleCount),
  };
  for (const column of columns) telemetry[column] = new Float32Array(sampleCount);

  const gapStart = Math.floor(sampleCount * 0.43);
  const gapEnd = Math.min(sampleCount - 2, gapStart + Math.max(2, Math.floor(sampleCount * 0.004)));
  const warningIndex = Math.floor(sampleCount * 0.555);
  const altitudeMaximumIndex = Math.floor(sampleCount * 0.684);
  const batteryMinimumIndex = Math.floor(sampleCount * 0.801);
  const phase = (variant % 31) / 31;

  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / (sampleCount - 1);
    const turn = progress * Math.PI * 6 + phase;
    const gap = index >= gapStart && index <= gapEnd;
    telemetry.elapsed_ms[index] = index * cadenceMs;
    telemetry.route_x_m[index] = gap ? Number.NaN : Math.cos(turn) * (100 + progress * 400);
    telemetry.route_y_m[index] = gap ? Number.NaN : Math.sin(turn) * (100 + progress * 400);
    telemetry.altitude_m[index] = gap ? Number.NaN : 20 + Math.sin(progress * Math.PI) * 80;
    telemetry.horizontal_speed_mps[index] = gap ? Number.NaN : 8 + Math.sin(turn * 0.7) * 4;
    telemetry.vertical_speed_mps[index] = gap ? Number.NaN : Math.cos(turn * 0.5) * 2.5;
    telemetry.battery_percent[index] = gap ? Number.NaN : 100 - progress * 76;
    telemetry.satellite_count[index] = gap ? 0 : 13 + (index % 8);
    telemetry.signal_percent[index] = gap || index % 997 === 0
      ? MISSING_SIGNAL
      : 92 - (index % 23);
    telemetry.flags[index] = gap ? FLAG_GAP : 0;
    telemetry.warning_code[index] = 0;
    if (version === VERSION_2) {
      telemetry.motor_temperature_c[index] = gap
        ? Number.NaN
        : 34 + progress * 18 + Math.sin(turn) * 2;
    }
  }

  telemetry.altitude_m[altitudeMaximumIndex] = 137.5 + phase;
  telemetry.battery_percent[batteryMinimumIndex] = 11.25;
  telemetry.flags[warningIndex] |= FLAG_WARNING;
  telemetry.warning_code[warningIndex] = 7;
  return telemetry;
}

export function encodeTelemetry(telemetry) {
  const columns = floatColumns(telemetry.version);
  assertInteger(telemetry.sampleCount, "sampleCount", 1);
  assertInteger(telemetry.cadenceMs, "cadenceMs", 1);
  const sampleCount = telemetry.sampleCount;
  const payloadBytes = sampleCount * (4 + columns.length * 4 + 1 + 2 + 1 + 1);
  const buffer = Buffer.allocUnsafe(HEADER_BYTES + payloadBytes);
  buffer.write(MAGIC, 0, 4, "ascii");
  buffer.writeUInt16LE(telemetry.version, 4);
  buffer.writeUInt16LE(columns.length, 6);
  buffer.writeUInt32LE(sampleCount, 8);
  buffer.writeUInt32LE(telemetry.cadenceMs, 12);
  buffer.fill(0, 16, HEADER_BYTES);
  let offset = HEADER_BYTES;

  for (const value of telemetry.elapsed_ms) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const column of columns) {
    const values = telemetry[column];
    if (!(values instanceof Float32Array) || values.length !== sampleCount) {
      throw new TypeError(`${column} must be a matching Float32Array`);
    }
    let previous = 0;
    for (const value of values) {
      if (Number.isNaN(value)) {
        buffer.writeInt32LE(MISSING_INT32, offset);
      } else {
        const scaled = Math.round(value * COLUMN_SCALES[column]);
        buffer.writeInt32LE(scaled - previous, offset);
        previous = scaled;
      }
      offset += 4;
    }
  }
  for (const value of telemetry.satellite_count) buffer.writeUInt8(value, offset++);
  for (const value of telemetry.signal_percent) {
    buffer.writeInt16LE(value, offset);
    offset += 2;
  }
  for (const value of telemetry.flags) buffer.writeUInt8(value, offset++);
  for (const value of telemetry.warning_code) buffer.writeUInt8(value, offset++);
  return buffer;
}

export function decodeTelemetry(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES || buffer.toString("ascii", 0, 4) !== MAGIC) {
    throw new TypeError("invalid telemetry object header");
  }
  const version = buffer.readUInt16LE(4);
  const columns = floatColumns(version);
  const encodedColumnCount = buffer.readUInt16LE(6);
  const sampleCount = buffer.readUInt32LE(8);
  const cadenceMs = buffer.readUInt32LE(12);
  if (encodedColumnCount !== columns.length || sampleCount < 1 || cadenceMs < 1) {
    throw new TypeError("invalid telemetry object dimensions");
  }
  const expectedBytes = HEADER_BYTES + sampleCount * (4 + columns.length * 4 + 1 + 2 + 1 + 1);
  if (buffer.length !== expectedBytes) throw new TypeError("telemetry object length mismatch");

  const telemetry = {
    version,
    sampleCount,
    cadenceMs,
    elapsed_ms: new Uint32Array(sampleCount),
    satellite_count: new Uint8Array(sampleCount),
    signal_percent: new Int16Array(sampleCount),
    flags: new Uint8Array(sampleCount),
    warning_code: new Uint8Array(sampleCount),
  };
  for (const column of columns) telemetry[column] = new Float32Array(sampleCount);
  let offset = HEADER_BYTES;
  for (let index = 0; index < sampleCount; index += 1) {
    telemetry.elapsed_ms[index] = buffer.readUInt32LE(offset);
    offset += 4;
  }
  for (const column of columns) {
    let previous = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const delta = buffer.readInt32LE(offset);
      if (delta === MISSING_INT32) {
        telemetry[column][index] = Number.NaN;
      } else {
        previous += delta;
        telemetry[column][index] = previous / COLUMN_SCALES[column];
      }
      offset += 4;
    }
  }
  for (let index = 0; index < sampleCount; index += 1) telemetry.satellite_count[index] = buffer.readUInt8(offset++);
  for (let index = 0; index < sampleCount; index += 1) {
    telemetry.signal_percent[index] = buffer.readInt16LE(offset);
    offset += 2;
  }
  for (let index = 0; index < sampleCount; index += 1) telemetry.flags[index] = buffer.readUInt8(offset++);
  for (let index = 0; index < sampleCount; index += 1) telemetry.warning_code[index] = buffer.readUInt8(offset++);
  return telemetry;
}

export function compressTelemetry(telemetry) {
  return gzipSync(encodeTelemetry(telemetry), { level: 6, mtime: 0 });
}

export function decompressTelemetry(buffer) {
  return decodeTelemetry(gunzipSync(buffer));
}

export function telemetryPoints(telemetry, { startMs = 0, endMs = Number.MAX_SAFE_INTEGER } = {}) {
  const columns = floatColumns(telemetry.version);
  const points = [];
  for (let index = 0; index < telemetry.sampleCount; index += 1) {
    const elapsedMs = telemetry.elapsed_ms[index];
    if (elapsedMs < startMs || elapsedMs > endMs) continue;
    const point = {
      index,
      elapsed_ms: elapsedMs,
      satellite_count: telemetry.satellite_count[index],
      signal_percent: telemetry.signal_percent[index] === MISSING_SIGNAL
        ? null
        : telemetry.signal_percent[index],
      flags: telemetry.flags[index],
      warning_code: telemetry.warning_code[index] || null,
    };
    for (const column of columns) {
      const value = telemetry[column][index];
      point[column] = Number.isNaN(value) ? null : value;
    }
    points.push(point);
  }
  return points;
}

export function codecCapabilities(version) {
  return Object.freeze({
    version,
    columns: [...floatColumns(version), "satellite_count", "signal_percent", "flags", "warning_code"],
  });
}
