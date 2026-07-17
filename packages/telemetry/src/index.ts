import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const telemetryCodec = 'droneworks-columnar-json-gzip';
export const telemetryCodecVersion = 1;
export const telemetryMediaType = 'application/vnd.droneworks.telemetry+gzip';
export const telemetryDownsamplingVersion = 'significant-v1';

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

export interface TelemetryEnvelopeV1 {
  readonly codec: typeof telemetryCodec;
  readonly columns: Readonly<Record<TelemetryColumnName, TelemetryScalar[]>>;
  readonly sample_count: number;
  readonly version: typeof telemetryCodecVersion;
}

export interface TelemetryReplaySampleV1 extends CanonicalTelemetrySampleV1 {
  readonly sample_index: number;
}

export interface TelemetryRangeV1 {
  readonly maximum: number | null;
  readonly minimum: number | null;
}

export interface TelemetryReplayStatisticsV1 {
  readonly altitude_msl_m: TelemetryRangeV1;
  readonly battery_charge_percent: TelemetryRangeV1;
  readonly height_agl_m: TelemetryRangeV1;
  readonly horizontal_speed_mps: TelemetryRangeV1;
  readonly vertical_speed_mps: TelemetryRangeV1;
}

export interface DownsampledTelemetryV1 {
  readonly gapTransitionCount: number;
  readonly preservedGapTransitionCount: number;
  readonly samples: readonly TelemetryReplaySampleV1[];
  readonly statistics: TelemetryReplayStatisticsV1;
  readonly version: typeof telemetryDownsamplingVersion;
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
  const validated = row as TelemetryEnvelopeV1;
  let previousElapsed = -1;
  for (const [index, elapsed] of validated.columns.elapsed_ms.entries()) {
    if (
      elapsed !== null &&
      (typeof elapsed !== 'number' ||
        !Number.isSafeInteger(elapsed) ||
        elapsed < 0)
    ) {
      throw new TypeError('Telemetry elapsed time is invalid.');
    }
    if (typeof elapsed === 'number') {
      if (elapsed < previousElapsed) {
        throw new TypeError('Telemetry elapsed time is not monotonic.');
      }
      previousElapsed = elapsed;
    }
    const latitude = validated.columns.latitude_deg[index];
    const longitude = validated.columns.longitude_deg[index];
    if ((latitude === null) !== (longitude === null)) {
      throw new TypeError('Telemetry position columns are inconsistent.');
    }
    const batteryCharge =
      validated.columns.battery_charge_percent[index] ?? null;
    const batteryDetails = [
      validated.columns.battery_current_a[index] ?? null,
      validated.columns.battery_temperature_c[index] ?? null,
      validated.columns.battery_voltage_v[index] ?? null,
    ];
    if (
      batteryCharge === null &&
      batteryDetails.some((item) => item !== null)
    ) {
      throw new TypeError('Telemetry battery columns are inconsistent.');
    }
    const gpsPositionUsed = validated.columns.gps_position_used[index];
    const gpsSatellites = validated.columns.gps_satellites[index];
    const gpsSignalLevel = validated.columns.gps_signal_level[index];
    if (
      typeof gpsPositionUsed !== 'boolean' ||
      typeof gpsSatellites !== 'number' ||
      !Number.isSafeInteger(gpsSatellites) ||
      gpsSatellites < 0 ||
      typeof gpsSignalLevel !== 'number' ||
      !Number.isSafeInteger(gpsSignalLevel) ||
      gpsSignalLevel < 0
    ) {
      throw new TypeError('Telemetry GPS columns are invalid.');
    }
    for (const name of columnNames) {
      if (name === 'gps_position_used') continue;
      const item = validated.columns[name][index];
      if (item !== null && typeof item !== 'number') {
        throw new TypeError(`Telemetry column ${name} has an invalid type.`);
      }
    }
  }
  return validated;
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

function nullableNumber(value: TelemetryScalar): number | null {
  return typeof value === 'number' ? value : null;
}

export function telemetryReplaySamplesV1(
  telemetry: TelemetryEnvelopeV1,
): readonly TelemetryReplaySampleV1[] {
  return Object.freeze(
    Array.from({ length: telemetry.sample_count }, (_, sampleIndex) => {
      const columns = telemetry.columns;
      const latitude = nullableNumber(
        columns.latitude_deg[sampleIndex] ?? null,
      );
      const longitude = nullableNumber(
        columns.longitude_deg[sampleIndex] ?? null,
      );
      const batteryCharge = nullableNumber(
        columns.battery_charge_percent[sampleIndex] ?? null,
      );
      const batteryCurrent = nullableNumber(
        columns.battery_current_a[sampleIndex] ?? null,
      );
      const batteryTemperature = nullableNumber(
        columns.battery_temperature_c[sampleIndex] ?? null,
      );
      const batteryVoltage = nullableNumber(
        columns.battery_voltage_v[sampleIndex] ?? null,
      );
      return Object.freeze({
        altitude_msl_m: nullableNumber(
          columns.altitude_msl_m[sampleIndex] ?? null,
        ),
        attitude: Object.freeze({
          pitch_deg: nullableNumber(
            columns.attitude_pitch_deg[sampleIndex] ?? null,
          ),
          roll_deg: nullableNumber(
            columns.attitude_roll_deg[sampleIndex] ?? null,
          ),
          yaw_deg: nullableNumber(
            columns.attitude_yaw_deg[sampleIndex] ?? null,
          ),
        }),
        battery:
          batteryCharge === null
            ? null
            : Object.freeze({
                charge_percent: batteryCharge,
                current_a: batteryCurrent,
                temperature_c: batteryTemperature,
                voltage_v: batteryVoltage,
              }),
        elapsed_ms: nullableNumber(columns.elapsed_ms[sampleIndex] ?? null),
        gps: Object.freeze({
          position_used: columns.gps_position_used[sampleIndex] === true,
          satellites:
            nullableNumber(columns.gps_satellites[sampleIndex] ?? null) ?? 0,
          signal_level:
            nullableNumber(columns.gps_signal_level[sampleIndex] ?? null) ?? 0,
        }),
        height_agl_m: nullableNumber(columns.height_agl_m[sampleIndex] ?? null),
        position:
          latitude === null || longitude === null
            ? null
            : Object.freeze({
                latitude_deg: latitude,
                longitude_deg: longitude,
              }),
        sample_index: sampleIndex,
        signal:
          columns.signal_downlink_percent[sampleIndex] === null &&
          columns.signal_uplink_percent[sampleIndex] === null
            ? null
            : Object.freeze({
                downlink_percent: nullableNumber(
                  columns.signal_downlink_percent[sampleIndex] ?? null,
                ),
                uplink_percent: nullableNumber(
                  columns.signal_uplink_percent[sampleIndex] ?? null,
                ),
              }),
        velocity: Object.freeze({
          x_mps: nullableNumber(columns.velocity_x_mps[sampleIndex] ?? null),
          y_mps: nullableNumber(columns.velocity_y_mps[sampleIndex] ?? null),
          z_mps: nullableNumber(columns.velocity_z_mps[sampleIndex] ?? null),
        }),
      });
    }),
  );
}

type StatisticName = keyof TelemetryReplayStatisticsV1;

function statisticValue(
  sample: TelemetryReplaySampleV1,
  name: StatisticName,
): number | null {
  switch (name) {
    case 'altitude_msl_m':
      return sample.altitude_msl_m;
    case 'battery_charge_percent':
      return sample.battery?.charge_percent ?? null;
    case 'height_agl_m':
      return sample.height_agl_m;
    case 'horizontal_speed_mps':
      return sample.velocity.x_mps === null || sample.velocity.y_mps === null
        ? null
        : Math.hypot(sample.velocity.x_mps, sample.velocity.y_mps);
    case 'vertical_speed_mps':
      return sample.velocity.z_mps;
  }
}

const statisticNames = [
  'altitude_msl_m',
  'battery_charge_percent',
  'height_agl_m',
  'horizontal_speed_mps',
  'vertical_speed_mps',
] as const satisfies readonly StatisticName[];

function statistics(
  samples: readonly TelemetryReplaySampleV1[],
): TelemetryReplayStatisticsV1 {
  return Object.fromEntries(
    statisticNames.map((name) => {
      const values = samples
        .map((sample) => statisticValue(sample, name))
        .filter((value): value is number => value !== null);
      return [
        name,
        Object.freeze({
          maximum: values.length === 0 ? null : Math.max(...values),
          minimum: values.length === 0 ? null : Math.min(...values),
        }),
      ];
    }),
  ) as unknown as TelemetryReplayStatisticsV1;
}

function availabilitySignature(sample: TelemetryReplaySampleV1): string {
  return [
    sample.elapsed_ms,
    sample.position,
    sample.altitude_msl_m,
    sample.height_agl_m,
    sample.velocity.x_mps,
    sample.velocity.y_mps,
    sample.velocity.z_mps,
    sample.battery?.charge_percent ?? null,
    sample.signal?.downlink_percent ?? null,
    sample.signal?.uplink_percent ?? null,
  ]
    .map((value) => (value === null ? '0' : '1'))
    .join('');
}

export function telemetryGapTransitionIndexesV1(
  samples: readonly TelemetryReplaySampleV1[],
): readonly number[] {
  const transitions: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (
      availabilitySignature(samples[index - 1] as TelemetryReplaySampleV1) !==
      availabilitySignature(samples[index] as TelemetryReplaySampleV1)
    ) {
      transitions.push(index);
    }
  }
  return Object.freeze(transitions);
}

function evenlySelected<T>(values: readonly T[], count: number): readonly T[] {
  if (count <= 0 || values.length === 0) return [];
  if (count >= values.length) return [...values];
  if (count === 1) return [values[0] as T];
  return Array.from({ length: count }, (_, index) => {
    const selected = Math.round((index * (values.length - 1)) / (count - 1));
    return values[selected] as T;
  });
}

export function downsampleTelemetryV1(
  telemetry: TelemetryEnvelopeV1,
  limit = 1_000,
): DownsampledTelemetryV1 {
  if (!Number.isSafeInteger(limit) || limit < 2 || limit > 2_000) {
    throw new RangeError('Telemetry selection limit must be from 2 to 2000.');
  }
  const samples = telemetryReplaySamplesV1(telemetry);
  const allStatistics = statistics(samples);
  if (samples.length <= limit) {
    const gapTransitionCount = telemetryGapTransitionIndexesV1(samples).length;
    return Object.freeze({
      gapTransitionCount,
      preservedGapTransitionCount: gapTransitionCount,
      samples,
      statistics: allStatistics,
      version: telemetryDownsamplingVersion,
    });
  }

  const selected = new Set<number>([0, samples.length - 1]);
  for (const name of statisticNames) {
    let minimum: { index: number; value: number } | null = null;
    let maximum: { index: number; value: number } | null = null;
    for (const [index, sample] of samples.entries()) {
      const value = statisticValue(sample, name);
      if (value === null) continue;
      if (!minimum || value < minimum.value) minimum = { index, value };
      if (!maximum || value > maximum.value) maximum = { index, value };
    }
    if (minimum) selected.add(minimum.index);
    if (maximum) selected.add(maximum.index);
  }

  const transitions = telemetryGapTransitionIndexesV1(samples);
  const unpreservedTransitions = transitions.filter(
    (index) => !selected.has(index - 1) || !selected.has(index),
  );
  const transitionBudget = Math.floor((limit - selected.size) / 2);
  for (const index of evenlySelected(
    unpreservedTransitions,
    transitionBudget,
  )) {
    selected.add(index - 1);
    selected.add(index);
  }

  const remaining = limit - selected.size;
  if (remaining > 0) {
    const candidates = samples
      .map((_sample, index) => index)
      .filter((index) => !selected.has(index));
    for (const index of evenlySelected(candidates, remaining)) {
      selected.add(index);
    }
  }
  const selectedSamples = [...selected]
    .sort((left, right) => left - right)
    .map((index) => samples[index] as TelemetryReplaySampleV1);
  const preservedGapTransitionCount = transitions.filter(
    (index) => selected.has(index - 1) && selected.has(index),
  ).length;
  return Object.freeze({
    gapTransitionCount: transitions.length,
    preservedGapTransitionCount,
    samples: Object.freeze(selectedSamples),
    statistics: allStatistics,
    version: telemetryDownsamplingVersion,
  });
}
