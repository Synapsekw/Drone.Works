import { createHash } from 'node:crypto';

import type {
  ParserIntermediateFlight,
  PrivateIntermediateValue,
} from '@drone-works/parser';

export const canonicalSchemaVersion = 1;
export const exactNormalizedFingerprintVersion = 'exact-normalized-v1' as const;

const capabilityNames = new Map([
  ['altitude', 'telemetry.altitude'],
  ['attitude', 'telemetry.attitude'],
  ['battery', 'telemetry.battery'],
  ['gps', 'telemetry.gps'],
  ['position', 'telemetry.position'],
  ['signal', 'telemetry.signal'],
  ['velocity', 'telemetry.velocity'],
]);

export interface ImportedProvenanceV1 {
  readonly import_item_id: string;
  readonly intermediate_path: string;
  readonly origin: 'imported';
  readonly parser: PrivateIntermediateValue['parser'];
  readonly processing_attempt_id: string;
  readonly processing_revision_id: string;
  readonly raw_source_id: string;
  readonly source_sha256: string;
  readonly source_value: unknown;
}

export interface CanonicalFactV1 {
  readonly base_preference: readonly ['imported'];
  readonly derived: null;
  readonly effective: Readonly<{
    origin: 'imported' | 'unavailable';
    value: unknown;
  }>;
  readonly imported: Readonly<{
    provenance: ImportedProvenanceV1;
    value: unknown;
  }>;
  readonly user_override: null;
}

export interface ExactNormalizedEvidenceV1 {
  readonly algorithm: 'sha256';
  readonly digest: string | null;
  readonly match_fields: readonly string[];
  readonly missing_requirements: readonly string[];
  readonly status: 'eligible' | 'insufficient_evidence';
  readonly version: typeof exactNormalizedFingerprintVersion;
}

export interface CanonicalAircraftIdentifierV1 {
  readonly identifier_type: 'manufacturer_serial';
  readonly value: string;
  readonly provenance: ImportedProvenanceV1;
}

export interface CanonicalFlightV1 {
  readonly aircraft_identifiers: readonly CanonicalAircraftIdentifierV1[];
  readonly battery_identifiers: readonly CanonicalAircraftIdentifierV1[];
  readonly canonical_flight_id: string;
  readonly capabilities: readonly string[];
  readonly facts: Readonly<Record<string, CanonicalFactV1>>;
  readonly fingerprint: ExactNormalizedEvidenceV1;
  readonly flight_index: number;
  readonly organization_id: string;
  readonly telemetry: ParserIntermediateFlight['samples'];
  readonly telemetry_provenance: Omit<
    ImportedProvenanceV1,
    'import_item_id' | 'processing_attempt_id' | 'source_value'
  >;
  readonly time_interpretation: Readonly<{
    assumed: boolean;
    display_timezone: string;
    display_timezone_source: 'organization_default';
    review_required: boolean;
    source_offset: string | null;
  }>;
}

export interface CanonicalNormalizationContextV1 {
  readonly canonicalFlightId: string;
  readonly displayTimezone: string;
  readonly importItemId: string;
  readonly organizationId: string;
  readonly processingAttemptId: string;
  readonly processingRevisionId: string;
  readonly rawSourceId: string;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(
        'Canonical material cannot contain non-finite numbers.',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    if (entries.some(([, item]) => item === undefined)) {
      throw new TypeError('Canonical material cannot contain undefined.');
    }
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical material has an unsupported value.');
}

function provenance(
  intermediate: PrivateIntermediateValue,
  context: CanonicalNormalizationContextV1,
  path: string,
  sourceValue: unknown,
): ImportedProvenanceV1 {
  return {
    import_item_id: context.importItemId,
    intermediate_path: path,
    origin: 'imported',
    parser: structuredClone(intermediate.parser),
    processing_attempt_id: context.processingAttemptId,
    processing_revision_id: context.processingRevisionId,
    raw_source_id: context.rawSourceId,
    source_sha256: intermediate.source.sha256,
    source_value: structuredClone(sourceValue),
  };
}

function fact(
  intermediate: PrivateIntermediateValue,
  context: CanonicalNormalizationContextV1,
  path: string,
  value: unknown,
  sourceValue: unknown = value,
): CanonicalFactV1 {
  return {
    base_preference: ['imported'],
    derived: null,
    effective: {
      origin: value === null ? 'unavailable' : 'imported',
      value: structuredClone(value),
    },
    imported: {
      provenance: provenance(intermediate, context, path, sourceValue),
      value: structuredClone(value),
    },
    user_override: null,
  };
}

function identifiers(
  values: readonly string[],
  intermediate: PrivateIntermediateValue,
  context: CanonicalNormalizationContextV1,
  path: string,
): readonly CanonicalAircraftIdentifierV1[] {
  return values.map((value, index) => ({
    identifier_type: 'manufacturer_serial',
    provenance: provenance(intermediate, context, `${path}[${index}]`, value),
    value,
  }));
}

function fingerprint(
  flight: ParserIntermediateFlight,
  facts: Readonly<Record<string, CanonicalFactV1>>,
  capabilities: readonly string[],
): ExactNormalizedEvidenceV1 {
  const aircraftIdentifiers = [
    ...new Set(flight.imported.identifiers.aircraft_serials),
  ].sort();
  const batteryIdentifiers = [
    ...new Set(flight.imported.identifiers.battery_serials),
  ].sort();
  const takeoff = facts.takeoff_time_utc?.imported.value;
  const duration = facts.duration_ms?.imported.value;
  const missing: string[] = [];
  if (aircraftIdentifiers.length === 0) missing.push('aircraft_identifier');
  if (typeof takeoff !== 'string' || !Number.isFinite(Date.parse(takeoff))) {
    missing.push('takeoff_time_utc');
  }
  if (!Number.isSafeInteger(duration) || Number(duration) < 0) {
    missing.push('duration_ms');
  }
  const matchFields = [
    'facts.takeoff_time_utc.imported.value',
    'facts.duration_ms.imported.value',
    'asset_evidence.aircraft.identifiers',
    'facts.distance_m.imported.value',
    'facts.max_height_m.imported.value',
    'facts.max_horizontal_speed_mps.imported.value',
    'facts.max_vertical_speed_mps.imported.value',
    'capabilities',
    'telemetry',
  ];
  if (batteryIdentifiers.length > 0) {
    matchFields.push('asset_evidence.batteries');
  }
  const base: Pick<
    ExactNormalizedEvidenceV1,
    'algorithm' | 'match_fields' | 'missing_requirements' | 'version'
  > = {
    algorithm: 'sha256' as const,
    match_fields: matchFields,
    missing_requirements: missing,
    version: exactNormalizedFingerprintVersion,
  };
  if (missing.length > 0) {
    return { ...base, digest: null, status: 'insufficient_evidence' };
  }
  const material = {
    aircraft_identifiers: aircraftIdentifiers,
    battery_identifiers: batteryIdentifiers,
    capabilities: { names: capabilities, schema_version: 1 },
    contract: exactNormalizedFingerprintVersion,
    duration_ms: duration,
    imported_facts: {
      distance_m: facts.distance_m?.imported.value ?? null,
      max_height_m: facts.max_height_m?.imported.value ?? null,
      max_horizontal_speed_mps:
        facts.max_horizontal_speed_mps?.imported.value ?? null,
      max_vertical_speed_mps:
        facts.max_vertical_speed_mps?.imported.value ?? null,
    },
    takeoff_time_utc: takeoff,
    telemetry: { samples: flight.samples, schema_version: 1 },
  };
  return {
    ...base,
    digest: createHash('sha256').update(canonicalJson(material)).digest('hex'),
    status: 'eligible',
  };
}

function requireTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new TypeError('The organization display timezone is invalid.');
  }
}

export function normalizeCanonicalFlightV1(
  intermediate: PrivateIntermediateValue,
  flightIndex: number,
  context: CanonicalNormalizationContextV1,
): CanonicalFlightV1 {
  requireTimezone(context.displayTimezone);
  const flight = intermediate.flights[flightIndex];
  if (!flight || flight.flight_index !== flightIndex) {
    throw new TypeError('The requested intermediate flight does not exist.');
  }
  const imported = flight.imported;
  const offset = imported.takeoff_time_utc.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
  const takeoff = offset
    ? new Date(imported.takeoff_time_utc).toISOString()
    : null;
  const path = (name: string) => `flights[${flightIndex}].imported.${name}`;
  const facts = {
    aircraft_model: fact(
      intermediate,
      context,
      path('aircraft_model'),
      imported.aircraft_model,
    ),
    aircraft_name: fact(
      intermediate,
      context,
      path('aircraft_name'),
      imported.aircraft_name,
    ),
    application_platform: fact(
      intermediate,
      context,
      path('application_platform'),
      imported.application_platform,
    ),
    application_version: fact(
      intermediate,
      context,
      path('application_version'),
      imported.application_version,
    ),
    distance_m: fact(
      intermediate,
      context,
      path('declared_distance_m'),
      imported.declared_distance_m,
    ),
    duration_ms: fact(
      intermediate,
      context,
      path('declared_duration_ms'),
      imported.declared_duration_ms,
    ),
    max_height_m: fact(
      intermediate,
      context,
      path('declared_max_height_m'),
      imported.declared_max_height_m,
    ),
    max_horizontal_speed_mps: fact(
      intermediate,
      context,
      path('declared_max_horizontal_speed_mps'),
      imported.declared_max_horizontal_speed_mps,
    ),
    max_vertical_speed_mps: fact(
      intermediate,
      context,
      path('declared_max_vertical_speed_mps'),
      imported.declared_max_vertical_speed_mps,
    ),
    takeoff_time_utc: fact(
      intermediate,
      context,
      path('takeoff_time_utc'),
      takeoff,
      imported.takeoff_time_utc,
    ),
  } satisfies Record<string, CanonicalFactV1>;
  const capabilities = flight.capabilities
    .map((name) => {
      const canonical = capabilityNames.get(name);
      if (!canonical) throw new TypeError('Unsupported telemetry capability.');
      return canonical;
    })
    .sort();
  return Object.freeze({
    aircraft_identifiers: identifiers(
      imported.identifiers.aircraft_serials,
      intermediate,
      context,
      path('identifiers.aircraft_serials'),
    ),
    battery_identifiers: identifiers(
      imported.identifiers.battery_serials,
      intermediate,
      context,
      path('identifiers.battery_serials'),
    ),
    canonical_flight_id: context.canonicalFlightId,
    capabilities,
    facts,
    fingerprint: fingerprint(flight, facts, capabilities),
    flight_index: flightIndex,
    organization_id: context.organizationId,
    telemetry: structuredClone(flight.samples),
    telemetry_provenance: {
      intermediate_path: `flights[${flightIndex}].samples`,
      origin: 'imported' as const,
      parser: structuredClone(intermediate.parser),
      processing_revision_id: context.processingRevisionId,
      raw_source_id: context.rawSourceId,
      source_sha256: intermediate.source.sha256,
    },
    time_interpretation: {
      assumed: !offset,
      display_timezone: context.displayTimezone,
      display_timezone_source: 'organization_default' as const,
      review_required: !offset,
      source_offset: offset ?? null,
    },
  });
}
