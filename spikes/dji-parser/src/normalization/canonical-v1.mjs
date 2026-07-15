const CANONICAL_CAPABILITIES = new Map([
  ["altitude", "telemetry.altitude"],
  ["attitude", "telemetry.attitude"],
  ["battery", "telemetry.battery"],
  ["gps", "telemetry.gps"],
  ["position", "telemetry.position"],
  ["signal", "telemetry.signal"],
  ["velocity", "telemetry.velocity"],
]);

const IMPORTANT_FIELDS = new Set([
  "takeoff_time_utc",
  "duration_ms",
  "distance_m",
  "max_height_m",
  "max_horizontal_speed_mps",
  "max_vertical_speed_mps",
  "aircraft_name",
  "aircraft_model",
  "application_platform",
  "application_version",
]);

const NON_NEGATIVE_NUMBER_FIELDS = new Set([
  "duration_ms",
  "distance_m",
  "max_height_m",
  "max_horizontal_speed_mps",
  "max_vertical_speed_mps",
]);

function validateOverrideValue(field, value) {
  if (value === null) return;
  if (NON_NEGATIVE_NUMBER_FIELDS.has(field)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`Override ${field} must be a non-negative finite number or null`);
    }
    if (field === "duration_ms" && !Number.isSafeInteger(value)) {
      throw new TypeError("Override duration_ms must be a safe integer or null");
    }
    return;
  }
  if (field === "takeoff_time_utc") {
    if (typeof value !== "string"
      || !/(Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
      throw new TypeError("Override takeoff_time_utc must include an explicit offset");
    }
    return;
  }
  if (typeof value !== "string" || value.length > 4_096) {
    throw new TypeError(`Override ${field} must be a bounded string or null`);
  }
}

function assertId(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new TypeError(`${name} must be a non-empty bounded string`);
  }
}

function assertDisplayTimezone(value) {
  assertId(value, "display_timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new TypeError("display_timezone must be an IANA timezone");
  }
}

function assertInstant(value, name) {
  assertId(value, name);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO timestamp with an explicit offset`);
  }
}

function validateAssignmentProvenance(provenance, name) {
  if (!["user_assignment", "asset_match"].includes(provenance?.origin)) {
    throw new TypeError(`${name} has an unsupported origin`);
  }
  assertInstant(provenance.occurred_at, `${name}.occurred_at`);
  if (provenance.origin === "user_assignment") {
    assertId(provenance.audit_event_id, `${name}.audit_event_id`);
    assertId(provenance.actor_id, `${name}.actor_id`);
  } else {
    assertId(provenance.match_evidence_id, `${name}.match_evidence_id`);
    assertId(provenance.matcher_version, `${name}.matcher_version`);
  }
}

function sourceProvenance({ intermediate, context, path, sourceValue }) {
  return {
    origin: "imported",
    raw_source_id: context.raw_source_id,
    import_item_id: context.import_item_id,
    processing_attempt_id: context.processing_attempt_id,
    processing_revision_id: context.processing_revision_id,
    parser: structuredClone(intermediate.parser),
    source_sha256: intermediate.source.sha256,
    intermediate_path: path,
    source_value: structuredClone(sourceValue),
  };
}

function normalizeOverride(override, context) {
  if (!override || typeof override !== "object" || !IMPORTANT_FIELDS.has(override.field)) {
    throw new TypeError("Active override targets an unsupported canonical field");
  }
  for (const name of ["canonical_flight_id", "audit_event_id", "actor_id"]) {
    assertId(override[name], `active_overrides.${name}`);
  }
  assertInstant(override.occurred_at, "active_overrides.occurred_at");
  if (override.organization_id !== context.organization_id) {
    throw new TypeError("Override organization does not match normalization context");
  }
  if (!context.canonical_flight_ids.includes(override.canonical_flight_id)) {
    throw new TypeError("Override canonical flight does not match normalization context");
  }
  validateOverrideValue(override.field, override.value);
  return {
    canonical_flight_id: override.canonical_flight_id,
    field: override.field,
    value: structuredClone(override.value),
    provenance: {
      origin: "user_override",
      organization_id: override.organization_id,
      audit_event_id: override.audit_event_id,
      actor_id: override.actor_id,
      occurred_at: new Date(override.occurred_at).toISOString(),
    },
  };
}

function activeOverrides(context) {
  const result = new Map();
  for (const raw of context.active_overrides ?? []) {
    const override = normalizeOverride(raw, context);
    const flightOverrides = result.get(override.canonical_flight_id) ?? new Map();
    if (flightOverrides.has(override.field)) {
      throw new TypeError("Only one active override may exist per flight field");
    }
    flightOverrides.set(override.field, override);
    result.set(override.canonical_flight_id, flightOverrides);
  }
  return result;
}

function effectiveFact({ imported, derived = null, userOverride = null, basePreference }) {
  let effective;
  if (userOverride) {
    effective = { origin: "user_override", value: structuredClone(userOverride.value) };
  } else {
    const sources = { imported, derived };
    const selected = basePreference.find((origin) => sources[origin]?.value !== null);
    effective = selected
      ? { origin: selected, value: structuredClone(sources[selected].value) }
      : { origin: "unavailable", value: null };
  }
  return {
    imported,
    derived,
    user_override: userOverride,
    base_preference: [...basePreference],
    effective,
  };
}

function importedFact({ intermediate, context, overrides, field, path, value, sourceValue = value }) {
  return effectiveFact({
    imported: {
      value: structuredClone(value),
      provenance: sourceProvenance({ intermediate, context, path, sourceValue }),
    },
    userOverride: overrides.get(field) ?? null,
    basePreference: ["imported"],
  });
}

function takeoffFact(intermediate, context, overrides, flightIndex, sourceValue) {
  const offset = sourceValue.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? null;
  const instant = offset ? new Date(sourceValue) : null;
  if (offset && !Number.isFinite(instant.valueOf())) {
    throw new TypeError("Imported takeoff time is invalid");
  }
  return {
    fact: importedFact({
      intermediate,
      context,
      overrides,
      field: "takeoff_time_utc",
      path: `flights[${flightIndex}].imported.takeoff_time_utc`,
      value: instant?.toISOString() ?? null,
      sourceValue,
    }),
    interpretation: {
      instant_source: offset ? "source_explicit_offset" : "source_timezone_unavailable",
      source_offset: offset,
      assumed: offset === null,
      review_required: offset === null,
      display_timezone: context.display_timezone,
      display_timezone_source: context.display_timezone_source,
    },
  };
}

function identifierEvidence(values, intermediate, context, path) {
  return values.map((value, index) => ({
    identifier_type: "manufacturer_serial",
    value,
    asset_id: null,
    match_status: "unresolved",
    provenance: sourceProvenance({
      intermediate,
      context,
      path: `${path}[${index}]`,
      sourceValue: value,
    }),
  }));
}

function telemetryProvenance(intermediate, context, flightIndex) {
  return {
    origin: "imported",
    raw_source_id: context.raw_source_id,
    processing_revision_id: context.processing_revision_id,
    parser: structuredClone(intermediate.parser),
    source_sha256: intermediate.source.sha256,
    intermediate_path: `flights[${flightIndex}].samples`,
    fields: {
      elapsed_ms: "elapsed_ms",
      position: "position",
      altitude_msl_m: "altitude_msl_m",
      height_agl_m: "height_agl_m",
      velocity: "velocity",
      attitude: "attitude",
      battery: "battery",
      gps: "gps",
      signal: "signal",
    },
  };
}

function normalizeFlight(intermediate, flight, flightIndex, context, overrides) {
  const imported = flight.imported;
  const takeoff = takeoffFact(
    intermediate,
    context,
    overrides,
    flightIndex,
    imported.takeoff_time_utc,
  );
  const fact = (field, sourceName, value = imported[sourceName]) => importedFact({
    intermediate,
    context,
    overrides,
    field,
    path: `flights[${flightIndex}].imported.${sourceName}`,
    value,
  });
  const identifiers = imported.identifiers;
  const assignment = context.flight_assignments[flightIndex];
  const capabilities = flight.capabilities.map((name) => {
    const mapped = CANONICAL_CAPABILITIES.get(name);
    if (!mapped) throw new TypeError("Intermediate contains an unsupported capability");
    return mapped;
  }).sort();

  return {
    canonical_flight_id: context.canonical_flight_ids[flightIndex],
    organization_id: context.organization_id,
    import_item_id: context.import_item_id,
    processing_revision_id: context.processing_revision_id,
    source_flight_index: flight.flight_index,
    state: assignment.state,
    facts: {
      takeoff_time_utc: takeoff.fact,
      duration_ms: fact("duration_ms", "declared_duration_ms"),
      distance_m: fact("distance_m", "declared_distance_m"),
      max_height_m: fact("max_height_m", "declared_max_height_m"),
      max_horizontal_speed_mps: fact(
        "max_horizontal_speed_mps",
        "declared_max_horizontal_speed_mps",
      ),
      max_vertical_speed_mps: fact(
        "max_vertical_speed_mps",
        "declared_max_vertical_speed_mps",
      ),
      aircraft_name: fact("aircraft_name", "aircraft_name"),
      aircraft_model: fact("aircraft_model", "aircraft_model"),
      application_platform: fact("application_platform", "application_platform"),
      application_version: fact("application_version", "application_version"),
    },
    time_interpretation: takeoff.interpretation,
    capabilities: { schema_version: 1, names: capabilities },
    asset_evidence: {
      pilot: {
        asset_id: assignment.pilot_id,
        match_status: assignment.pilot_id ? "assigned" : "unavailable",
        assignment_provenance: assignment.pilot_assignment_provenance,
        identifiers: [],
      },
      aircraft: {
        asset_id: assignment.aircraft_id,
        match_status: assignment.aircraft_id
          ? "assigned"
          : (identifiers.aircraft_serials.length ? "unresolved" : "unavailable"),
        assignment_provenance: assignment.aircraft_assignment_provenance,
        identifiers: identifierEvidence(
          identifiers.aircraft_serials,
          intermediate,
          context,
          `flights[${flightIndex}].imported.identifiers.aircraft_serials`,
        ),
      },
      batteries: identifierEvidence(
        identifiers.battery_serials,
        intermediate,
        context,
        `flights[${flightIndex}].imported.identifiers.battery_serials`,
      ),
      cameras: identifierEvidence(
        identifiers.camera_serials,
        intermediate,
        context,
        `flights[${flightIndex}].imported.identifiers.camera_serials`,
      ),
      controllers: identifierEvidence(
        identifiers.controller_serials,
        intermediate,
        context,
        `flights[${flightIndex}].imported.identifiers.controller_serials`,
      ),
    },
    telemetry: {
      schema_version: 1,
      sample_count: flight.samples.length,
      samples: structuredClone(flight.samples),
      provenance: telemetryProvenance(intermediate, context, flightIndex),
    },
  };
}

function validateContext(context, flightCount) {
  for (const name of [
    "organization_id",
    "upload_batch_id",
    "raw_source_id",
    "import_item_id",
    "processing_attempt_id",
    "processing_revision_id",
    "display_timezone",
    "display_timezone_source",
  ]) assertId(context?.[name], name);
  assertDisplayTimezone(context.display_timezone);
  if (!Array.isArray(context.canonical_flight_ids)
    || context.canonical_flight_ids.length !== flightCount) {
    throw new TypeError("canonical_flight_ids must match the intermediate flight count");
  }
  for (const id of context.canonical_flight_ids) assertId(id, "canonical_flight_ids item");
  if (new Set(context.canonical_flight_ids).size !== context.canonical_flight_ids.length) {
    throw new TypeError("canonical_flight_ids must be unique");
  }
  if (!Array.isArray(context.flight_assignments)
    || context.flight_assignments.length !== flightCount) {
    throw new TypeError("flight_assignments must match the intermediate flight count");
  }
  for (const [index, assignment] of context.flight_assignments.entries()) {
    if (assignment?.canonical_flight_id !== context.canonical_flight_ids[index]
      || !["awaiting_review", "active"].includes(assignment?.state)) {
      throw new TypeError("Flight assignment identity or state is invalid");
    }
    for (const name of ["pilot_id", "aircraft_id"]) {
      if (assignment[name] !== null) assertId(assignment[name], `flight_assignments.${name}`);
    }
    if (assignment.state === "active" && (!assignment.pilot_id || !assignment.aircraft_id)) {
      throw new TypeError("An active canonical flight requires pilot and aircraft assignments");
    }
    for (const [asset, id] of [["pilot", assignment.pilot_id], ["aircraft", assignment.aircraft_id]]) {
      const provenance = assignment[`${asset}_assignment_provenance`];
      if (id && !provenance) {
        throw new TypeError(`Assigned ${asset} requires assignment provenance`);
      }
      if (!id && provenance) {
        throw new TypeError(`${asset} assignment provenance requires an assigned asset`);
      }
      if (provenance) {
        validateAssignmentProvenance(
          provenance,
          `flight_assignments.${asset}_assignment_provenance`,
        );
      }
    }
  }
}

class PrivateCanonicalRevision {
  #value;

  constructor(value) {
    this.#value = structuredClone(value);
    const capabilities = new Set();
    let telemetrySamples = 0;
    for (const flight of value.flights) {
      telemetrySamples += flight.telemetry.sample_count;
      for (const name of flight.capabilities.names) capabilities.add(name);
    }
    this.result = Object.freeze({
      schema_version: 1,
      status: "canonical_revision_ready",
      failure_code: null,
      flight_count: value.flights.length,
      telemetry_sample_count: telemetrySamples,
      capability_names: [...capabilities].sort(),
    });
  }

  valueForPersistence() {
    return structuredClone(this.#value);
  }

  toJSON() {
    return this.result;
  }
}

export function normalizeDjiIntermediate(privateIntermediate, context) {
  if (typeof privateIntermediate?.valueForNormalizer !== "function"
    || privateIntermediate?.result?.status !== "intermediate_ready") {
    throw new TypeError("A validated private intermediate is required");
  }
  const intermediate = privateIntermediate.valueForNormalizer();
  if (intermediate?.schema_version !== 1 || intermediate?.kind !== "dji_parser_intermediate") {
    throw new TypeError("Unsupported private intermediate contract");
  }
  validateContext(context, intermediate.flights.length);
  const overrides = activeOverrides(context);
  const value = {
    schema_version: 1,
    kind: "canonical_import_revision",
    organization_id: context.organization_id,
    upload_batch_id: context.upload_batch_id,
    raw_source: {
      raw_source_id: context.raw_source_id,
      sha256: intermediate.source.sha256,
      bytes: intermediate.source.bytes,
      format_family: intermediate.source.format_family,
      format_version: intermediate.source.format_version,
      immutable: true,
    },
    import_item_id: context.import_item_id,
    processing_attempt_id: context.processing_attempt_id,
    processing_revision_id: context.processing_revision_id,
    parser_revision: structuredClone(intermediate.parser),
    flights: intermediate.flights.map((flight, index) => normalizeFlight(
      intermediate,
      flight,
      index,
      context,
      overrides.get(context.canonical_flight_ids[index]) ?? new Map(),
    )),
  };
  return new PrivateCanonicalRevision(value);
}

export { IMPORTANT_FIELDS };
