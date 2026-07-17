import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const telemetryCodec = 'droneworks-columnar-json-gzip';
export const telemetryCodecVersion = 1;
export const telemetryMediaType = 'application/vnd.droneworks.telemetry+gzip';

const columnNames = [
  'elapsed_ms',
  'latitude_deg',
  'longitude_deg',
  'altitude_msl_m',
  'height_agl_m',
  'velocity_x_mps',
  'velocity_y_mps',
  'velocity_z_mps',
  'attitude_pitch_deg',
  'attitude_roll_deg',
  'attitude_yaw_deg',
  'battery_charge_percent',
  'battery_current_a',
  'battery_temperature_c',
  'battery_voltage_v',
  'gps_position_used',
  'gps_satellites',
  'gps_signal_level',
  'signal_downlink_percent',
  'signal_uplink_percent',
] as const;

type TelemetryColumnName = (typeof columnNames)[number];
type TelemetryScalar = boolean | number | null;

export interface CanonicalTelemetrySampleV1 {
  readonly altitude_msl_m: number | null;
  readonly attitude: Readonly<
    Record<'pitch_deg' | 'roll_deg' | 'yaw_deg', number | null>
  >;
  readonly battery: Readonly<{
    charge_percent: number;
    current_a: number | null;
    temperature_c: number | null;
    voltage_v: number | null;
  }> | null;
  readonly elapsed_ms: number | null;
  readonly gps: Readonly<{
    position_used: boolean;
    satellites: number;
    signal_level: number;
  }>;
  readonly height_agl_m: number | null;
  readonly position: Readonly<{
    latitude_deg: number;
    longitude_deg: number;
  }> | null;
  readonly signal: Readonly<{
    downlink_percent: number | null;
    uplink_percent: number | null;
  }> | null;
  readonly velocity: Readonly<
    Record<'x_mps' | 'y_mps' | 'z_mps', number | null>
  >;
}

interface TelemetryEnvelopeV1 {
  readonly codec: typeof telemetryCodec;
  readonly columns: Readonly<Record<TelemetryColumnName, TelemetryScalar[]>>;
  readonly sample_count: number;
  readonly version: typeof telemetryCodecVersion;
}

export interface EncodedTelemetryV1 {
  readonly bytes: Buffer;
  readonly codec: typeof telemetryCodec;
  readonly codecVersion: typeof telemetryCodecVersion;
  readonly contentSha256: string;
  readonly firstElapsedMs: number | null;
  readonly lastElapsedMs: number | null;
  readonly mediaType: typeof telemetryMediaType;
  readonly sampleCount: number;
}

function emptyColumns(): Record<TelemetryColumnName, TelemetryScalar[]> {
  return Object.fromEntries(
    columnNames.map((name) => [name, []]),
  ) as unknown as Record<TelemetryColumnName, TelemetryScalar[]>;
}

function envelope(
  samples: readonly CanonicalTelemetrySampleV1[],
): TelemetryEnvelopeV1 {
  const columns = emptyColumns();
  for (const sample of samples) {
    columns.elapsed_ms.push(sample.elapsed_ms);
    columns.latitude_deg.push(sample.position?.latitude_deg ?? null);
    columns.longitude_deg.push(sample.position?.longitude_deg ?? null);
    columns.altitude_msl_m.push(sample.altitude_msl_m);
    columns.height_agl_m.push(sample.height_agl_m);
    columns.velocity_x_mps.push(sample.velocity.x_mps);
    columns.velocity_y_mps.push(sample.velocity.y_mps);
    columns.velocity_z_mps.push(sample.velocity.z_mps);
    columns.attitude_pitch_deg.push(sample.attitude.pitch_deg);
    columns.attitude_roll_deg.push(sample.attitude.roll_deg);
    columns.attitude_yaw_deg.push(sample.attitude.yaw_deg);
    columns.battery_charge_percent.push(sample.battery?.charge_percent ?? null);
    columns.battery_current_a.push(sample.battery?.current_a ?? null);
    columns.battery_temperature_c.push(sample.battery?.temperature_c ?? null);
    columns.battery_voltage_v.push(sample.battery?.voltage_v ?? null);
    columns.gps_position_used.push(sample.gps.position_used);
    columns.gps_satellites.push(sample.gps.satellites);
    columns.gps_signal_level.push(sample.gps.signal_level);
    columns.signal_downlink_percent.push(
      sample.signal?.downlink_percent ?? null,
    );
    columns.signal_uplink_percent.push(sample.signal?.uplink_percent ?? null);
  }
  return {
    codec: telemetryCodec,
    columns,
    sample_count: samples.length,
    version: telemetryCodecVersion,
  };
}

function validateEnvelope(value: unknown): TelemetryEnvelopeV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Telemetry payload must be an object.');
  }
  const row = value as Partial<TelemetryEnvelopeV1>;
  if (
    row.codec !== telemetryCodec ||
    row.version !== telemetryCodecVersion ||
    !Number.isSafeInteger(row.sample_count) ||
    Number(row.sample_count) < 0 ||
    !row.columns ||
    typeof row.columns !== 'object'
  ) {
    throw new TypeError('Telemetry payload has an unsupported contract.');
  }
  const actualNames = Object.keys(row.columns).sort();
  const expectedNames = [...columnNames].sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new TypeError('Telemetry payload columns changed unexpectedly.');
  }
  for (const name of columnNames) {
    const values = row.columns[name];
    if (!Array.isArray(values) || values.length !== row.sample_count) {
      throw new TypeError(`Telemetry column ${name} has an invalid length.`);
    }
    for (const item of values) {
      if (
        item !== null &&
        typeof item !== 'boolean' &&
        (typeof item !== 'number' || !Number.isFinite(item))
      ) {
        throw new TypeError(`Telemetry column ${name} has an invalid value.`);
      }
    }
  }
  return row as TelemetryEnvelopeV1;
}

export function encodeTelemetryV1(
  samples: readonly CanonicalTelemetrySampleV1[],
): EncodedTelemetryV1 {
  const elapsed = samples
    .map((sample) => sample.elapsed_ms)
    .filter((value): value is number => value !== null);
  const bytes = gzipSync(Buffer.from(JSON.stringify(envelope(samples))), {
    level: 6,
  });
  bytes.writeUInt32LE(0, 4);
  bytes.writeUInt8(255, 9);
  return Object.freeze({
    bytes,
    codec: telemetryCodec,
    codecVersion: telemetryCodecVersion,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    firstElapsedMs: elapsed[0] ?? null,
    lastElapsedMs: elapsed.at(-1) ?? null,
    mediaType: telemetryMediaType,
    sampleCount: samples.length,
  });
}

export function decodeTelemetryV1(bytes: Buffer): TelemetryEnvelopeV1 {
  let decoded: unknown;
  try {
    decoded = JSON.parse(gunzipSync(bytes).toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Telemetry object could not be decoded.');
  }
  return validateEnvelope(decoded);
}

export function verifyTelemetryV1(
  bytes: Buffer,
  expectedSha256: string,
): TelemetryEnvelopeV1 {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    throw new TypeError('Telemetry object checksum does not match metadata.');
  }
  return decodeTelemetryV1(bytes);
}
