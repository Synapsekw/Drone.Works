import { createHash } from "node:crypto";

const EXACT_NORMALIZED_VERSION = "exact-normalized-v1";
const RESTORATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const FINGERPRINT_FACTS = [
  "distance_m",
  "max_height_m",
  "max_horizontal_speed_mps",
  "max_vertical_speed_mps",
];

function assertId(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new TypeError(`${name} must be a non-empty bounded string`);
  }
}

function instant(value, name) {
  if (typeof value !== "string"
    || !/(Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO timestamp with an explicit offset`);
  }
  return new Date(value);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical material cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => (
      left < right ? -1 : (left > right ? 1 : 0)
    ));
    if (entries.some(([, item]) => item === undefined)) {
      throw new TypeError("Canonical material cannot contain undefined values");
    }
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new TypeError("Canonical material contains an unsupported value");
}

function importedValue(flight, field) {
  return flight?.facts?.[field]?.imported?.value ?? null;
}

function identifierValues(evidence) {
  return [...new Set((evidence ?? [])
    .filter((item) => item?.identifier_type === "manufacturer_serial")
    .map((item) => item.value))].sort();
}

export function createExactNormalizedFingerprint(flight) {
  const aircraftIdentifiers = identifierValues(flight?.asset_evidence?.aircraft?.identifiers);
  const batteryIdentifiers = identifierValues(flight?.asset_evidence?.batteries);
  const takeoffTime = importedValue(flight, "takeoff_time_utc");
  const durationMs = importedValue(flight, "duration_ms");
  const missingRequirements = [];
  if (aircraftIdentifiers.length === 0) missingRequirements.push("aircraft_identifier");
  if (typeof takeoffTime !== "string" || !Number.isFinite(Date.parse(takeoffTime))) {
    missingRequirements.push("takeoff_time_utc");
  }
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) missingRequirements.push("duration_ms");

  const matchFields = [
    "facts.takeoff_time_utc.imported.value",
    "facts.duration_ms.imported.value",
    "asset_evidence.aircraft.identifiers",
    ...FINGERPRINT_FACTS.map((field) => `facts.${field}.imported.value`),
    "capabilities",
    "telemetry",
  ];
  if (batteryIdentifiers.length > 0) matchFields.push("asset_evidence.batteries");

  if (missingRequirements.length > 0) {
    return {
      classification: "exact_normalized",
      version: EXACT_NORMALIZED_VERSION,
      algorithm: "sha256",
      status: "insufficient_evidence",
      digest: null,
      match_fields: matchFields,
      missing_requirements: missingRequirements,
    };
  }

  const material = {
    contract: EXACT_NORMALIZED_VERSION,
    takeoff_time_utc: takeoffTime,
    duration_ms: durationMs,
    aircraft_identifiers: aircraftIdentifiers,
    battery_identifiers: batteryIdentifiers,
    imported_facts: Object.fromEntries(FINGERPRINT_FACTS.map((field) => [
      field,
      importedValue(flight, field),
    ])),
    capabilities: {
      schema_version: flight.capabilities.schema_version,
      names: [...flight.capabilities.names].sort(),
    },
    telemetry: {
      schema_version: flight.telemetry.schema_version,
      samples: flight.telemetry.samples,
    },
  };
  return {
    classification: "exact_normalized",
    version: EXACT_NORMALIZED_VERSION,
    algorithm: "sha256",
    status: "eligible",
    digest: createHash("sha256").update(canonicalJson(material)).digest("hex"),
    match_fields: matchFields,
    missing_requirements: [],
  };
}

function assertImportedProvenance(provenance, revision, name) {
  if (provenance?.origin !== "imported"
    || provenance.raw_source_id !== revision.raw_source.raw_source_id
    || provenance.import_item_id !== revision.import_item_id
    || provenance.processing_attempt_id !== revision.processing_attempt_id
    || provenance.processing_revision_id !== revision.processing_revision_id
    || provenance.source_sha256 !== revision.raw_source.sha256
    || !sameEvidence(provenance.parser, revision.parser_revision)) {
    throw new TypeError(`${name} does not match its canonical revision`);
  }
}

function assertFact(fact, name, revision, flight) {
  if (!fact || typeof fact !== "object" || !fact.imported || !fact.imported.provenance) {
    throw new TypeError(`${name} must preserve imported evidence`);
  }
  assertImportedProvenance(fact.imported.provenance, revision, `${name}.imported.provenance`);
  if (!Array.isArray(fact.base_preference) || fact.base_preference.length === 0) {
    throw new TypeError(`${name} must declare base preference`);
  }
  if (!fact.effective || !["imported", "derived", "user_override", "unavailable"]
    .includes(fact.effective.origin)) {
    throw new TypeError(`${name} must declare an effective origin`);
  }
  if (fact.user_override && (fact.user_override.canonical_flight_id !== flight.canonical_flight_id
    || fact.user_override.provenance?.organization_id !== revision.organization_id)) {
    throw new TypeError(`${name} override ownership does not match its canonical flight`);
  }
  const effectiveSource = fact.effective.origin === "user_override"
    ? fact.user_override
    : fact[fact.effective.origin];
  if (fact.effective.origin === "unavailable") {
    if (fact.effective.value !== null) throw new TypeError(`${name} unavailable value must be null`);
  } else if (!effectiveSource || !sameEvidence(fact.effective.value, effectiveSource.value)) {
    throw new TypeError(`${name} effective value does not match its selected evidence`);
  }
}

function sameEvidence(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateCanonicalRevision(value) {
  if (value?.schema_version !== 1 || value?.kind !== "canonical_import_revision") {
    throw new TypeError("Unsupported canonical revision contract");
  }
  for (const name of [
    "organization_id",
    "upload_batch_id",
    "import_item_id",
    "processing_attempt_id",
    "processing_revision_id",
  ]) assertId(value[name], name);
  assertId(value.raw_source?.raw_source_id, "raw_source.raw_source_id");
  if (value.raw_source.immutable !== true
    || !/^[0-9a-f]{64}$/.test(value.raw_source.sha256)
    || !Number.isSafeInteger(value.raw_source.bytes)
    || value.raw_source.bytes < 1) {
    throw new TypeError("Canonical raw source must be immutable and content-bound");
  }
  for (const name of ["id", "version", "source_commit"]) {
    assertId(value.parser_revision?.[name], `parser_revision.${name}`);
  }
  if (!Array.isArray(value.flights)) throw new TypeError("Canonical flights must be an array");
  const flightIds = new Set();
  for (const [index, flight] of value.flights.entries()) {
    assertId(flight?.canonical_flight_id, `flights[${index}].canonical_flight_id`);
    if (flightIds.has(flight.canonical_flight_id)) {
      throw new TypeError("Canonical flight IDs must be unique within a revision");
    }
    flightIds.add(flight.canonical_flight_id);
    if (flight.organization_id !== value.organization_id
      || flight.import_item_id !== value.import_item_id
      || flight.processing_revision_id !== value.processing_revision_id) {
      throw new TypeError("Canonical flight ownership or revision identity does not match its parent");
    }
    if (!["awaiting_review", "active"].includes(flight.state)) {
      throw new TypeError("Canonical flight state is invalid");
    }
    for (const field of [
      "takeoff_time_utc",
      "duration_ms",
      ...FINGERPRINT_FACTS,
      "aircraft_name",
      "aircraft_model",
      "application_platform",
      "application_version",
    ]) assertFact(
      flight.facts?.[field],
      `flights[${index}].facts.${field}`,
      value,
      flight,
    );
    if (flight.telemetry?.schema_version !== 1
      || !Array.isArray(flight.telemetry.samples)
      || flight.telemetry.sample_count !== flight.telemetry.samples.length) {
      throw new TypeError("Canonical telemetry count or schema is invalid");
    }
    if (flight.telemetry.provenance?.origin !== "imported"
      || flight.telemetry.provenance.raw_source_id !== value.raw_source.raw_source_id
      || flight.telemetry.provenance.processing_revision_id !== value.processing_revision_id
      || flight.telemetry.provenance.source_sha256 !== value.raw_source.sha256
      || !sameEvidence(flight.telemetry.provenance.parser, value.parser_revision)) {
      throw new TypeError("Canonical telemetry provenance does not match its revision");
    }
    for (const evidence of [
      ...(flight.asset_evidence?.aircraft?.identifiers ?? []),
      ...(flight.asset_evidence?.batteries ?? []),
      ...(flight.asset_evidence?.cameras ?? []),
      ...(flight.asset_evidence?.controllers ?? []),
    ]) assertImportedProvenance(evidence.provenance, value, "Asset identifier provenance");
    const fingerprint = createExactNormalizedFingerprint(flight);
    if (!sameEvidence(flight.duplicate_evidence?.exact_normalized, fingerprint)) {
      throw new TypeError("Exact-normalized fingerprint evidence does not match canonical material");
    }
  }
  return value;
}

function assertRevisionContext(revision, state) {
  validateCanonicalRevision(revision);
  if (revision.organization_id !== state.organization_id
    || revision.import_item_id !== state.import_item_id
    || revision.raw_source.raw_source_id !== state.raw_source_id) {
    throw new TypeError("Canonical revision does not belong to this lifecycle");
  }
}

function totalsForFlights(flights) {
  let flightCount = 0;
  let durationMs = 0;
  for (const flight of flights.values()) {
    if (flight.lifecycle_state !== "active") continue;
    flightCount += 1;
    const revision = flight.revisions.at(-1);
    const duration = revision.facts.duration_ms.effective.value;
    if (typeof duration === "number") durationMs += duration;
  }
  return { flight_count: flightCount, duration_ms: durationMs };
}

export class CanonicalImportLifecycle {
  #state;
  #flights = new Map();

  constructor({ organization_id, raw_source_id, import_item_id }) {
    for (const [name, value] of Object.entries({ organization_id, raw_source_id, import_item_id })) {
      assertId(value, name);
    }
    this.#state = {
      schema_version: 1,
      kind: "canonical_import_lifecycle",
      organization_id,
      raw_source_id,
      import_item_id,
      import_state: "normalizing",
      import_outcome: null,
      processing_revision_ids: [],
      raw_source_state: "retained",
      raw_source_retention_reason: "processing_evidence",
      audit_events: [],
    };
  }

  #recordRevision(revision, mode, occurredAt) {
    assertRevisionContext(revision, this.#state);
    const occurred = instant(occurredAt, "occurred_at").toISOString();
    if (this.#state.processing_revision_ids.includes(revision.processing_revision_id)) {
      throw new TypeError("Processing revision has already been applied");
    }
    if (mode === "initial" && this.#state.processing_revision_ids.length !== 0) {
      throw new TypeError("Initial processing may only be recorded once");
    }
    if (mode === "reprocess" && this.#state.processing_revision_ids.length === 0) {
      throw new TypeError("Reprocessing requires an initial processing revision");
    }

    const incomingIds = new Set(revision.flights.map((flight) => flight.canonical_flight_id));
    if (mode === "reprocess") {
      if ([...this.#flights.values()]
        .some((flight) => flight.lifecycle_state === "permanently_deleted")) {
        throw new TypeError("A permanently deleted flight cannot be reprocessed");
      }
      const retainedIds = [...this.#flights.values()]
        .filter((flight) => flight.lifecycle_state !== "permanently_deleted")
        .map((flight) => flight.canonical_flight_id);
      const firstFlightsAfterZeroOutcome = this.#flights.size === 0;
      if (!firstFlightsAfterZeroOutcome && (incomingIds.size !== retainedIds.length
        || retainedIds.some((id) => !incomingIds.has(id)))) {
        throw new TypeError("Reprocessing must reuse every retained canonical flight identity");
      }
      if ([...this.#flights.values()].some((flight) => flight.lifecycle_state === "deleted")) {
        throw new TypeError("A soft-deleted flight cannot be reprocessed");
      }
    }

    for (const candidate of revision.flights) {
      const existing = this.#flights.get(candidate.canonical_flight_id);
      if (mode === "initial" || !existing) {
        this.#flights.set(candidate.canonical_flight_id, {
          canonical_flight_id: candidate.canonical_flight_id,
          lifecycle_state: candidate.state,
          state_before_deletion: null,
          deleted_at: null,
          restoration_deadline: null,
          permanently_deleted_at: null,
          current_processing_revision_id: revision.processing_revision_id,
          revisions: [structuredClone(candidate)],
        });
      } else {
        existing.lifecycle_state = candidate.state;
        existing.current_processing_revision_id = revision.processing_revision_id;
        existing.revisions.push(structuredClone(candidate));
      }
    }

    this.#state.processing_revision_ids.push(revision.processing_revision_id);
    this.#state.import_state = "completed";
    this.#state.import_outcome = revision.flights.length === 0 ? "zero_flights" : "flights_ready";
    this.#state.raw_source_state = "retained";
    this.#state.raw_source_retention_reason = revision.flights.length === 0
      ? "zero_flight_import_evidence"
      : "canonical_flight_reference";
    this.#state.audit_events.push({
      action: mode === "initial" ? "processing_completed" : "reprocessing_completed",
      occurred_at: occurred,
      processing_revision_id: revision.processing_revision_id,
      canonical_flight_ids: [...incomingIds].sort(),
      changed_fields: mode === "initial" ? ["import_state"] : ["current_processing_revision_id"],
    });
  }

  completeInitialProcessing(revision, occurredAt) {
    this.#recordRevision(revision, "initial", occurredAt);
  }

  completeReprocessing(revision, occurredAt) {
    this.#recordRevision(revision, "reprocess", occurredAt);
  }

  deleteFlight(canonicalFlightId, occurredAt) {
    const flight = this.#flight(canonicalFlightId);
    if (!["active", "awaiting_review"].includes(flight.lifecycle_state)) {
      throw new TypeError("Only a retained canonical flight can be soft-deleted");
    }
    const deletedAt = instant(occurredAt, "occurred_at");
    flight.state_before_deletion = flight.lifecycle_state;
    flight.lifecycle_state = "deleted";
    flight.deleted_at = deletedAt.toISOString();
    flight.restoration_deadline = new Date(deletedAt.valueOf() + RESTORATION_WINDOW_MS).toISOString();
    this.#state.audit_events.push({
      action: "flight_deleted",
      occurred_at: flight.deleted_at,
      canonical_flight_id: canonicalFlightId,
      changed_fields: ["deletion_state"],
    });
  }

  restoreFlight(canonicalFlightId, occurredAt) {
    const flight = this.#flight(canonicalFlightId);
    const restoredAt = instant(occurredAt, "occurred_at");
    if (flight.lifecycle_state !== "deleted") throw new TypeError("Flight is not restorable");
    if (restoredAt.valueOf() >= Date.parse(flight.restoration_deadline)) {
      throw new TypeError("Flight restoration window has ended");
    }
    flight.lifecycle_state = flight.state_before_deletion;
    flight.state_before_deletion = null;
    flight.deleted_at = null;
    flight.restoration_deadline = null;
    this.#state.audit_events.push({
      action: "flight_restored",
      occurred_at: restoredAt.toISOString(),
      canonical_flight_id: canonicalFlightId,
      changed_fields: ["deletion_state"],
    });
  }

  permanentlyDeleteFlight(canonicalFlightId, occurredAt) {
    const flight = this.#flight(canonicalFlightId);
    const deletedAt = instant(occurredAt, "occurred_at");
    if (flight.lifecycle_state !== "deleted") throw new TypeError("Flight must be soft-deleted first");
    if (deletedAt.valueOf() < Date.parse(flight.restoration_deadline)) {
      throw new TypeError("Flight restoration window has not ended");
    }
    flight.lifecycle_state = "permanently_deleted";
    flight.state_before_deletion = null;
    flight.deleted_at = null;
    flight.restoration_deadline = null;
    flight.permanently_deleted_at = deletedAt.toISOString();
    flight.current_processing_revision_id = null;
    flight.revisions = [];
    this.#state.audit_events.push({
      action: "flight_permanently_deleted",
      occurred_at: deletedAt.toISOString(),
      canonical_flight_id: canonicalFlightId,
      changed_fields: ["deletion_state", "customer_payload"],
    });
    const retainedFlight = [...this.#flights.values()]
      .some((candidate) => candidate.lifecycle_state !== "permanently_deleted");
    if (!retainedFlight) {
      this.#state.raw_source_state = "eligible_for_deletion";
      this.#state.raw_source_retention_reason = null;
    }
  }

  #flight(canonicalFlightId) {
    assertId(canonicalFlightId, "canonical_flight_id");
    const flight = this.#flights.get(canonicalFlightId);
    if (!flight) throw new TypeError("Canonical flight does not belong to this lifecycle");
    return flight;
  }

  valueForPersistence() {
    return structuredClone({
      ...this.#state,
      totals: totalsForFlights(this.#flights),
      flights: [...this.#flights.values()],
    });
  }
}

export { EXACT_NORMALIZED_VERSION, RESTORATION_WINDOW_MS };
