const capabilities = new Set([
  'altitude',
  'attitude',
  'battery',
  'gps',
  'position',
  'signal',
  'velocity',
]);

export interface ParserIntermediateSource {
  readonly bytes: number;
  readonly format_family: 'dji_txt';
  readonly format_version: number;
  readonly sha256: string;
}

export interface ParserIntermediateSample {
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

export interface ParserIntermediateFlight {
  readonly capabilities: readonly string[];
  readonly flight_index: number;
  readonly imported: Readonly<Record<string, unknown>>;
  readonly sample_count: number;
  readonly samples: readonly ParserIntermediateSample[];
}

export interface PrivateIntermediateValue {
  readonly flights: readonly ParserIntermediateFlight[];
  readonly kind: 'dji_parser_intermediate';
  readonly parser: Readonly<{
    id: 'dji-log-parser';
    source_commit: string;
    version: string;
  }>;
  readonly schema_version: 1;
  readonly source: ParserIntermediateSource;
}

export interface ParserIntermediateShape {
  readonly batterySampleCount: number;
  readonly capabilities: readonly string[];
  readonly elapsedSpanMs: number | null;
  readonly flightCount: number;
  readonly positionSampleCount: number;
  readonly sampleCount: number;
  readonly signalSampleCount: number;
}

export interface PrivateIntermediateSummary {
  readonly boundary: Readonly<{
    cpus: number;
    memoryMb: number;
    network: 'none';
    pidsLimit: number;
    rootFilesystem: 'read_only';
    tmpfsMb: number;
    user: string;
    validated: true;
  }>;
  readonly contract: Readonly<{
    kind: 'dji_parser_intermediate';
    schemaVersion: 1;
  }>;
  readonly material: Readonly<
    ParserIntermediateShape & {
      bytes: number;
      sha256: string;
      sourceHashVerified: true;
    }
  >;
  readonly schemaVersion: 1;
  readonly status: 'intermediate_ready';
  readonly process: Readonly<{
    exitCode: number | null;
    oomKilled: boolean;
    stderrBytes: number;
    stdoutBytes: number;
    totalOutputBytes: number;
    wallMs: number;
  }>;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${name} has unexpected or missing fields.`);
  }
}

function finiteOrNull(value: unknown, name: string): void {
  if (
    value !== null &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(`${name} must be finite or null.`);
  }
}

function nonNegativeIntegerOrNull(value: unknown, name: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || Number(value) < 0)) {
    throw new TypeError(`${name} must be a non-negative integer or null.`);
  }
}

function sortedUniqueStrings(value: unknown, name: string): void {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length < 1)
  ) {
    throw new TypeError(`${name} must be a string array.`);
  }
  const expected = [...new Set(value)].sort();
  if (value.some((item, index) => item !== expected[index])) {
    throw new TypeError(`${name} must be sorted and unique.`);
  }
}

function vector(value: unknown, keys: readonly string[], name: string): void {
  const row = object(value, name);
  exactKeys(row, keys, name);
  for (const key of keys) finiteOrNull(row[key], `${name}.${key}`);
}

function imported(value: unknown): void {
  const row = object(value, 'imported');
  exactKeys(
    row,
    [
      'takeoff_time_utc',
      'declared_duration_ms',
      'declared_distance_m',
      'declared_max_height_m',
      'declared_max_horizontal_speed_mps',
      'declared_max_vertical_speed_mps',
      'aircraft_name',
      'aircraft_model',
      'application_platform',
      'application_version',
      'identifiers',
    ],
    'imported',
  );
  if (
    typeof row.takeoff_time_utc !== 'string' ||
    !Number.isFinite(Date.parse(row.takeoff_time_utc))
  ) {
    throw new TypeError('The imported takeoff time is invalid.');
  }
  nonNegativeIntegerOrNull(
    row.declared_duration_ms,
    'imported.declared_duration_ms',
  );
  for (const key of [
    'declared_distance_m',
    'declared_max_height_m',
    'declared_max_horizontal_speed_mps',
    'declared_max_vertical_speed_mps',
  ]) {
    finiteOrNull(row[key], `imported.${key}`);
  }
  for (const key of ['aircraft_name', 'application_version'] as const) {
    if (row[key] !== null && typeof row[key] !== 'string') {
      throw new TypeError(`imported.${key} must be a string or null.`);
    }
  }
  const identifiers = object(row.identifiers, 'identifiers');
  exactKeys(
    identifiers,
    [
      'aircraft_serials',
      'battery_serials',
      'camera_serials',
      'controller_serials',
    ],
    'identifiers',
  );
  for (const key of Object.keys(identifiers)) {
    sortedUniqueStrings(identifiers[key], `identifiers.${key}`);
  }
}

function sample(value: unknown, previousElapsed: number): number {
  const row = object(value, 'sample');
  exactKeys(
    row,
    [
      'elapsed_ms',
      'position',
      'altitude_msl_m',
      'height_agl_m',
      'velocity',
      'attitude',
      'battery',
      'gps',
      'signal',
    ],
    'sample',
  );
  nonNegativeIntegerOrNull(row.elapsed_ms, 'sample.elapsed_ms');
  const elapsed =
    row.elapsed_ms === null ? previousElapsed : Number(row.elapsed_ms);
  if (elapsed < previousElapsed) {
    throw new TypeError('Intermediate elapsed time is non-monotonic.');
  }
  if (row.position !== null) {
    const position = object(row.position, 'sample.position');
    exactKeys(position, ['latitude_deg', 'longitude_deg'], 'sample.position');
    if (
      typeof position.latitude_deg !== 'number' ||
      !Number.isFinite(position.latitude_deg) ||
      position.latitude_deg < -90 ||
      position.latitude_deg > 90 ||
      typeof position.longitude_deg !== 'number' ||
      !Number.isFinite(position.longitude_deg) ||
      position.longitude_deg < -180 ||
      position.longitude_deg > 180
    ) {
      throw new TypeError('Intermediate position is out of bounds.');
    }
  }
  finiteOrNull(row.altitude_msl_m, 'sample.altitude_msl_m');
  finiteOrNull(row.height_agl_m, 'sample.height_agl_m');
  vector(row.velocity, ['x_mps', 'y_mps', 'z_mps'], 'sample.velocity');
  vector(row.attitude, ['pitch_deg', 'roll_deg', 'yaw_deg'], 'sample.attitude');
  if (row.battery !== null) {
    const battery = object(row.battery, 'sample.battery');
    exactKeys(
      battery,
      ['charge_percent', 'voltage_v', 'current_a', 'temperature_c'],
      'sample.battery',
    );
    if (
      !Number.isSafeInteger(battery.charge_percent) ||
      Number(battery.charge_percent) < 0 ||
      Number(battery.charge_percent) > 100
    ) {
      throw new TypeError('Intermediate battery charge is out of bounds.');
    }
    for (const key of ['voltage_v', 'current_a', 'temperature_c']) {
      finiteOrNull(battery[key], `sample.battery.${key}`);
    }
  }
  const gps = object(row.gps, 'sample.gps');
  exactKeys(gps, ['satellites', 'signal_level', 'position_used'], 'sample.gps');
  if (
    !Number.isSafeInteger(gps.satellites) ||
    Number(gps.satellites) < 0 ||
    !Number.isSafeInteger(gps.signal_level) ||
    Number(gps.signal_level) < 0 ||
    typeof gps.position_used !== 'boolean'
  ) {
    throw new TypeError('Intermediate GPS sample is invalid.');
  }
  if (row.signal !== null) {
    const signal = object(row.signal, 'sample.signal');
    exactKeys(signal, ['uplink_percent', 'downlink_percent'], 'sample.signal');
    for (const key of ['uplink_percent', 'downlink_percent']) {
      const reading = signal[key];
      if (
        reading !== null &&
        (!Number.isSafeInteger(reading) ||
          Number(reading) < 0 ||
          Number(reading) > 100)
      ) {
        throw new TypeError(`Intermediate signal ${key} is out of bounds.`);
      }
    }
  }
  return elapsed;
}

export function validatePrivateIntermediate(
  value: unknown,
  expectedSource: Readonly<{ bytes: number; sha256: string }>,
): Readonly<{
  shape: ParserIntermediateShape;
  value: PrivateIntermediateValue;
}> {
  const root = object(value, 'intermediate');
  exactKeys(
    root,
    ['schema_version', 'kind', 'parser', 'source', 'flights'],
    'intermediate',
  );
  if (root.schema_version !== 1 || root.kind !== 'dji_parser_intermediate') {
    throw new TypeError('The intermediate contract is unsupported.');
  }
  const parser = object(root.parser, 'parser');
  exactKeys(parser, ['id', 'version', 'source_commit'], 'parser');
  if (
    parser.id !== 'dji-log-parser' ||
    typeof parser.version !== 'string' ||
    parser.version.length < 1 ||
    typeof parser.source_commit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(parser.source_commit)
  ) {
    throw new TypeError('The intermediate parser identity is invalid.');
  }
  const source = object(root.source, 'source');
  exactKeys(
    source,
    ['sha256', 'bytes', 'format_family', 'format_version'],
    'source',
  );
  if (
    source.sha256 !== expectedSource.sha256 ||
    source.bytes !== expectedSource.bytes ||
    source.format_family !== 'dji_txt' ||
    !Number.isSafeInteger(source.format_version) ||
    Number(source.format_version) < 0 ||
    Number(source.format_version) > 255
  ) {
    throw new TypeError('The intermediate source identity is invalid.');
  }
  if (!Array.isArray(root.flights) || root.flights.length < 1) {
    throw new TypeError('The intermediate must contain a flight.');
  }

  let sampleCount = 0;
  let positionSampleCount = 0;
  let batterySampleCount = 0;
  let signalSampleCount = 0;
  let elapsedMinimum: number | null = null;
  let elapsedMaximum: number | null = null;
  const allCapabilities = new Set<string>();
  for (const [flightIndex, flightValue] of root.flights.entries()) {
    const flight = object(flightValue, 'flight');
    exactKeys(
      flight,
      ['flight_index', 'imported', 'capabilities', 'sample_count', 'samples'],
      'flight',
    );
    if (
      flight.flight_index !== flightIndex ||
      !Array.isArray(flight.capabilities) ||
      flight.capabilities.some(
        (item) => typeof item !== 'string' || !capabilities.has(item),
      ) ||
      !Array.isArray(flight.samples) ||
      flight.sample_count !== flight.samples.length
    ) {
      throw new TypeError('The intermediate flight shape is invalid.');
    }
    const sortedCapabilities = [...new Set(flight.capabilities)].sort();
    if (
      flight.capabilities.some(
        (item, index) => item !== sortedCapabilities[index],
      )
    ) {
      throw new TypeError(
        'Intermediate capabilities must be sorted and unique.',
      );
    }
    for (const item of sortedCapabilities) allCapabilities.add(String(item));
    imported(flight.imported);
    let previousElapsed = -1;
    for (const sampleValue of flight.samples) {
      previousElapsed = sample(sampleValue, previousElapsed);
      const row = sampleValue as ParserIntermediateSample;
      if (row.elapsed_ms !== null) {
        elapsedMinimum =
          elapsedMinimum === null
            ? row.elapsed_ms
            : Math.min(elapsedMinimum, row.elapsed_ms);
        elapsedMaximum =
          elapsedMaximum === null
            ? row.elapsed_ms
            : Math.max(elapsedMaximum, row.elapsed_ms);
      }
      if (row.position !== null) positionSampleCount += 1;
      if (row.battery !== null) batterySampleCount += 1;
      if (row.signal !== null) signalSampleCount += 1;
    }
    sampleCount += flight.samples.length;
  }

  return Object.freeze({
    shape: Object.freeze({
      batterySampleCount,
      capabilities: Object.freeze([...allCapabilities].sort()),
      elapsedSpanMs:
        elapsedMinimum === null || elapsedMaximum === null
          ? null
          : elapsedMaximum - elapsedMinimum,
      flightCount: root.flights.length,
      positionSampleCount,
      sampleCount,
      signalSampleCount,
    }),
    value: root as unknown as PrivateIntermediateValue,
  });
}

function scrub(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) scrub(item);
    value.fill(null);
    value.length = 0;
    return;
  }
  if (!value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  for (const item of Object.values(row)) scrub(item);
  for (const key of Object.keys(row)) delete row[key];
}

export class PrivateParserIntermediate {
  #value: PrivateIntermediateValue | null;
  readonly schemaVersion = 1;
  readonly status = 'intermediate_ready' as const;
  readonly summary: PrivateIntermediateSummary;

  constructor(
    summary: PrivateIntermediateSummary,
    value: PrivateIntermediateValue,
  ) {
    this.summary = Object.freeze(structuredClone(summary));
    this.#value = value;
  }

  get destroyed(): boolean {
    return this.#value === null;
  }

  async withValue<T>(
    consumer: (value: PrivateIntermediateValue) => T | Promise<T>,
  ): Promise<T> {
    const value = this.#value;
    if (!value)
      throw new Error('The private parser intermediate is unavailable.');
    this.#value = null;
    try {
      return await consumer(value);
    } finally {
      scrub(value);
    }
  }

  destroy(): void {
    if (this.#value) scrub(this.#value);
    this.#value = null;
  }

  toJSON(): PrivateIntermediateSummary {
    return this.summary;
  }
}
