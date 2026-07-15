import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CanonicalImportLifecycle,
  EXACT_NORMALIZED_VERSION,
  RESTORATION_WINDOW_MS,
  createExactNormalizedFingerprint,
  validateCanonicalRevision,
} from "../src/normalization/canonical-model.mjs";
import { normalizeDjiIntermediate } from "../src/normalization/canonical-v1.mjs";

function sample(overrides = {}) {
  return {
    elapsed_ms: 0,
    position: null,
    altitude_msl_m: null,
    height_agl_m: 0,
    velocity: { x_mps: 0, y_mps: 0, z_mps: 0 },
    attitude: { pitch_deg: 0, roll_deg: 0, yaw_deg: 0 },
    battery: null,
    gps: { satellites: 0, signal_level: 0, position_used: false },
    signal: null,
    ...overrides,
  };
}

function flight(overrides = {}) {
  return {
    flight_index: 0,
    imported: {
      takeoff_time_utc: "2026-01-01T04:00:00+04:00",
      declared_duration_ms: 1000,
      declared_distance_m: 2,
      declared_max_height_m: null,
      declared_max_horizontal_speed_mps: 4,
      declared_max_vertical_speed_mps: 5,
      aircraft_name: null,
      aircraft_model: "Synthetic",
      application_platform: "Synthetic",
      application_version: "1.0.0",
      identifiers: {
        aircraft_serials: ["synthetic-aircraft"],
        battery_serials: [],
        camera_serials: [],
        controller_serials: [],
      },
    },
    capabilities: ["gps", "position"],
    sample_count: 1,
    samples: [sample()],
    ...overrides,
  };
}

function privateIntermediate(flights = [flight()], parserVersion = "0.5.7") {
  const value = {
    schema_version: 1,
    kind: "dji_parser_intermediate",
    parser: {
      id: "dji-log-parser",
      version: parserVersion,
      source_commit: "e2e0775670a8391b4f7ecc40fca4cb01ea4a90fa",
    },
    source: {
      sha256: "a".repeat(64),
      bytes: 100,
      format_family: "dji_txt",
      format_version: 14,
    },
    flights,
  };
  return {
    result: { status: "intermediate_ready" },
    valueForNormalizer: () => structuredClone(value),
  };
}

function context(overrides = {}) {
  return {
    organization_id: "org-synthetic",
    upload_batch_id: "batch-synthetic",
    raw_source_id: "source-synthetic",
    import_item_id: "item-synthetic",
    processing_attempt_id: "attempt-synthetic",
    processing_revision_id: "revision-1",
    canonical_flight_ids: ["flight-synthetic"],
    flight_assignments: [{
      canonical_flight_id: "flight-synthetic",
      state: "awaiting_review",
      pilot_id: null,
      aircraft_id: null,
      pilot_assignment_provenance: null,
      aircraft_assignment_provenance: null,
    }],
    display_timezone: "Asia/Dubai",
    display_timezone_source: "organization_default",
    active_overrides: [],
    ...overrides,
  };
}

function activeAssignment() {
  return [{
    canonical_flight_id: "flight-synthetic",
    state: "active",
    pilot_id: "pilot-synthetic",
    aircraft_id: "aircraft-synthetic",
    pilot_assignment_provenance: {
      origin: "user_assignment",
      audit_event_id: "pilot-assignment-audit-1",
      actor_id: "user-1",
      occurred_at: "2026-01-01T12:00:00Z",
    },
    aircraft_assignment_provenance: {
      origin: "asset_match",
      match_evidence_id: "aircraft-match-1",
      matcher_version: "exact-serial-v1",
      occurred_at: "2026-01-01T12:00:00Z",
    },
  }];
}

test("maps imported facts with provenance while keeping canonical output private", () => {
  const sourceFlight = flight();
  sourceFlight.samples = [sample({ position: { latitude_deg: 25, longitude_deg: 55 } })];
  const normalized = normalizeDjiIntermediate(privateIntermediate([sourceFlight]), context());
  const value = normalized.valueForPersistence();
  const canonical = value.flights[0];

  assert.equal(normalized.result.flight_count, 1);
  assert.equal(normalized.result.exact_normalized_fingerprint_count, 1);
  assert.equal(canonical.facts.takeoff_time_utc.effective.value, "2026-01-01T00:00:00.000Z");
  assert.equal(canonical.facts.duration_ms.effective.origin, "imported");
  assert.equal(canonical.facts.max_height_m.effective.origin, "unavailable");
  assert.equal(canonical.facts.max_height_m.effective.value, null);
  assert.equal(canonical.facts.max_height_m.imported.provenance.intermediate_path,
    "flights[0].imported.declared_max_height_m");
  assert.deepEqual(canonical.capabilities.names, ["telemetry.gps", "telemetry.position"]);
  assert.equal(canonical.time_interpretation.instant_source, "source_explicit_offset");
  assert.equal(canonical.time_interpretation.review_required, false);
  assert.equal(JSON.stringify(normalized).includes("synthetic-aircraft"), false);
  assert.equal(JSON.stringify(normalized).includes("latitude_deg"), false);
  assert.equal(JSON.stringify(normalized).includes("org-synthetic"), false);
  assert.equal(JSON.stringify(normalized).includes("a".repeat(64)), false);
});

test("publishes a vendor-neutral canonical revision schema", async () => {
  const schema = JSON.parse(await readFile(new URL(
    "../src/normalization/canonical.schema.json",
    import.meta.url,
  )));

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "https://drone.works/schemas/canonical/import-revision-v1.json");
  assert.equal(schema.properties.kind.const, "canonical_import_revision");
  assert.equal(schema.$defs.flight.properties.duplicate_evidence
    .properties.exact_normalized.$ref, "#/$defs/fingerprintEvidence");
  assert.equal(JSON.stringify(schema).includes("dji_parser_intermediate"), false);

  const revision = normalizeDjiIntermediate(
    privateIntermediate(),
    context({ flight_assignments: activeAssignment() }),
  ).valueForPersistence();
  assert.equal(validateCanonicalRevision(revision), revision);

  const wrongProvenance = structuredClone(revision);
  wrongProvenance.flights[0].facts.duration_ms.imported.provenance.processing_revision_id =
    "revision-other";
  assert.throws(() => validateCanonicalRevision(wrongProvenance), /does not match/);
  const wrongFingerprint = structuredClone(revision);
  wrongFingerprint.flights[0].duplicate_evidence.exact_normalized.digest = "0".repeat(64);
  assert.throws(() => validateCanonicalRevision(wrongFingerprint), /fingerprint evidence/);
});

test("exact-normalized fingerprints are deterministic, source-independent, and explainable", () => {
  const override = {
    field: "duration_ms",
    value: 900,
    organization_id: "org-synthetic",
    canonical_flight_id: "flight-synthetic",
    audit_event_id: "audit-1",
    actor_id: "user-1",
    occurred_at: "2026-01-02T00:00:00Z",
  };
  const first = normalizeDjiIntermediate(
    privateIntermediate(),
    context({ flight_assignments: activeAssignment() }),
  ).valueForPersistence().flights[0];
  const laterParserWithOverride = normalizeDjiIntermediate(
    privateIntermediate([flight()], "0.6.0"),
    context({
      processing_attempt_id: "attempt-2",
      processing_revision_id: "revision-2",
      active_overrides: [override],
      flight_assignments: activeAssignment(),
    }),
  ).valueForPersistence().flights[0];

  const evidence = first.duplicate_evidence.exact_normalized;
  assert.equal(evidence.version, EXACT_NORMALIZED_VERSION);
  assert.equal(evidence.status, "eligible");
  assert.match(evidence.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(evidence.missing_requirements, []);
  assert.ok(evidence.match_fields.includes("facts.takeoff_time_utc.imported.value"));
  assert.ok(evidence.match_fields.includes("telemetry"));
  assert.equal(evidence.match_fields.includes("asset_evidence.batteries"), false);
  assert.equal(laterParserWithOverride.duplicate_evidence.exact_normalized.digest, evidence.digest);

  const changedTelemetry = structuredClone(first);
  changedTelemetry.telemetry.samples[0].height_agl_m = 1;
  assert.notEqual(createExactNormalizedFingerprint(changedTelemetry).digest, evidence.digest);
});

test("exact-normalized fingerprints require stable aircraft and timing but not battery identity", () => {
  const noAircraft = flight();
  noAircraft.imported.identifiers.aircraft_serials = [];
  const normalized = normalizeDjiIntermediate(privateIntermediate([noAircraft]), context())
    .valueForPersistence().flights[0];

  assert.equal(normalized.duplicate_evidence.exact_normalized.status, "insufficient_evidence");
  assert.equal(normalized.duplicate_evidence.exact_normalized.digest, null);
  assert.deepEqual(
    normalized.duplicate_evidence.exact_normalized.missing_requirements,
    ["aircraft_identifier"],
  );
});

test("leaves a takeoff time without an explicit offset unresolved for review", () => {
  const ambiguous = flight();
  ambiguous.imported.takeoff_time_utc = "2026-01-01T04:00:00";
  const canonical = normalizeDjiIntermediate(privateIntermediate([ambiguous]), context())
    .valueForPersistence().flights[0];

  assert.equal(canonical.facts.takeoff_time_utc.imported.value, null);
  assert.equal(canonical.facts.takeoff_time_utc.effective.origin, "unavailable");
  assert.equal(canonical.facts.takeoff_time_utc.imported.provenance.source_value,
    "2026-01-01T04:00:00");
  assert.equal(canonical.time_interpretation.assumed, true);
  assert.equal(canonical.time_interpretation.review_required, true);
});

test("preserves multiple battery identifiers and never creates a fictional battery", () => {
  const multi = flight();
  multi.imported.identifiers.battery_serials = ["battery-a", "battery-b"];
  const normalized = normalizeDjiIntermediate(privateIntermediate([multi]), context())
    .valueForPersistence();

  assert.equal(normalized.flights[0].asset_evidence.batteries.length, 2);
  assert.ok(normalized.flights[0].asset_evidence.batteries.every((item) => item.asset_id === null));

  const missing = normalizeDjiIntermediate(privateIntermediate(), context()).valueForPersistence();
  assert.deepEqual(missing.flights[0].asset_evidence.batteries, []);
});

test("maps multiple operational flights from one import item without sharing canonical identity", () => {
  const second = flight({ flight_index: 1 });
  const normalized = normalizeDjiIntermediate(
    privateIntermediate([flight(), second]),
    context({
      canonical_flight_ids: ["flight-one", "flight-two"],
      flight_assignments: [
        {
          canonical_flight_id: "flight-one",
          state: "awaiting_review",
          pilot_id: null,
          aircraft_id: null,
          pilot_assignment_provenance: null,
          aircraft_assignment_provenance: null,
        },
        {
          canonical_flight_id: "flight-two",
          state: "awaiting_review",
          pilot_id: null,
          aircraft_id: null,
          pilot_assignment_provenance: null,
          aircraft_assignment_provenance: null,
        },
      ],
    }),
  ).valueForPersistence();

  assert.equal(normalized.flights.length, 2);
  assert.deepEqual(normalized.flights.map((item) => item.canonical_flight_id),
    ["flight-one", "flight-two"]);
  assert.ok(normalized.flights.every((item) => item.import_item_id === "item-synthetic"));
});

test("an active user override survives a later parser revision", () => {
  const override = {
    field: "duration_ms",
    value: 900,
    organization_id: "org-synthetic",
    canonical_flight_id: "flight-synthetic",
    audit_event_id: "audit-1",
    actor_id: "user-1",
    occurred_at: "2026-01-02T00:00:00Z",
  };
  const first = normalizeDjiIntermediate(
    privateIntermediate(),
    context({ active_overrides: [override], flight_assignments: activeAssignment() }),
  ).valueForPersistence();
  const revisedFlight = flight();
  revisedFlight.imported.declared_duration_ms = 1200;
  const second = normalizeDjiIntermediate(
    privateIntermediate([revisedFlight], "0.5.8"),
    context({
      processing_revision_id: "revision-2",
      active_overrides: [override],
      flight_assignments: activeAssignment(),
    }),
  ).valueForPersistence();

  assert.equal(first.flights[0].facts.duration_ms.effective.value, 900);
  assert.equal(second.flights[0].canonical_flight_id, first.flights[0].canonical_flight_id);
  assert.equal(second.flights[0].facts.duration_ms.imported.value, 1200);
  assert.equal(second.flights[0].facts.duration_ms.effective.value, 900);
  assert.equal(second.flights[0].facts.duration_ms.effective.origin, "user_override");
  assert.equal(second.flights[0].facts.duration_ms.user_override.provenance.audit_event_id, "audit-1");
});

test("lifecycle transitions preserve identity and update active totals across reprocessing", () => {
  const lifecycle = new CanonicalImportLifecycle({
    organization_id: "org-synthetic",
    raw_source_id: "source-synthetic",
    import_item_id: "item-synthetic",
  });
  const initial = normalizeDjiIntermediate(
    privateIntermediate(),
    context({ flight_assignments: activeAssignment() }),
  ).valueForPersistence();
  lifecycle.completeInitialProcessing(initial, "2026-01-01T00:00:00Z");
  assert.deepEqual(lifecycle.valueForPersistence().totals, { flight_count: 1, duration_ms: 1000 });

  const changed = flight();
  changed.imported.declared_duration_ms = 1200;
  const reprocessed = normalizeDjiIntermediate(
    privateIntermediate([changed], "0.6.0"),
    context({
      processing_attempt_id: "attempt-2",
      processing_revision_id: "revision-2",
      flight_assignments: activeAssignment(),
    }),
  ).valueForPersistence();
  lifecycle.completeReprocessing(reprocessed, "2026-01-02T00:00:00Z");

  const state = lifecycle.valueForPersistence();
  assert.deepEqual(state.processing_revision_ids, ["revision-1", "revision-2"]);
  assert.equal(state.flights.length, 1);
  assert.equal(state.flights[0].canonical_flight_id, "flight-synthetic");
  assert.equal(state.flights[0].revisions.length, 2);
  assert.deepEqual(state.totals, { flight_count: 1, duration_ms: 1200 });

  const secondIdAssignment = activeAssignment();
  secondIdAssignment[0].canonical_flight_id = "flight-second";
  const secondId = normalizeDjiIntermediate(
    privateIntermediate([changed], "0.6.1"),
    context({
      processing_attempt_id: "attempt-3",
      processing_revision_id: "revision-3",
      canonical_flight_ids: ["flight-second"],
      flight_assignments: secondIdAssignment,
    }),
  ).valueForPersistence();
  assert.throws(
    () => lifecycle.completeReprocessing(secondId, "2026-01-03T00:00:00Z"),
    /reuse every retained canonical flight identity/,
  );
});

test("soft deletion, restoration, and permanent deletion enforce the grace window", () => {
  const lifecycle = new CanonicalImportLifecycle({
    organization_id: "org-synthetic",
    raw_source_id: "source-synthetic",
    import_item_id: "item-synthetic",
  });
  const revision = normalizeDjiIntermediate(
    privateIntermediate(),
    context({ flight_assignments: activeAssignment() }),
  ).valueForPersistence();
  lifecycle.completeInitialProcessing(revision, "2026-01-01T00:00:00Z");

  lifecycle.deleteFlight("flight-synthetic", "2026-01-02T00:00:00Z");
  let state = lifecycle.valueForPersistence();
  assert.deepEqual(state.totals, { flight_count: 0, duration_ms: 0 });
  assert.equal(state.flights[0].revisions.length, 1);
  assert.throws(
    () => lifecycle.permanentlyDeleteFlight("flight-synthetic", "2026-01-31T23:59:59Z"),
    /has not ended/,
  );

  lifecycle.restoreFlight("flight-synthetic", "2026-01-15T00:00:00Z");
  assert.deepEqual(lifecycle.valueForPersistence().totals,
    { flight_count: 1, duration_ms: 1000 });

  const finalDelete = "2026-02-01T00:00:00Z";
  lifecycle.deleteFlight("flight-synthetic", finalDelete);
  const deadline = new Date(Date.parse(finalDelete) + RESTORATION_WINDOW_MS).toISOString();
  assert.throws(
    () => lifecycle.restoreFlight("flight-synthetic", deadline),
    /window has ended/,
  );
  lifecycle.permanentlyDeleteFlight("flight-synthetic", deadline);
  state = lifecycle.valueForPersistence();
  assert.equal(state.flights[0].lifecycle_state, "permanently_deleted");
  assert.deepEqual(state.flights[0].revisions, []);
  assert.equal(state.flights[0].current_processing_revision_id, null);
  assert.equal(state.raw_source_state, "eligible_for_deletion");
  assert.deepEqual(state.totals, { flight_count: 0, duration_ms: 0 });
  assert.deepEqual(state.audit_events.at(-1).changed_fields,
    ["deletion_state", "customer_payload"]);
});

test("permanent deletion retains a raw source while another canonical flight references it", () => {
  const assignments = [activeAssignment()[0], structuredClone(activeAssignment()[0])];
  assignments[0].canonical_flight_id = "flight-one";
  assignments[1].canonical_flight_id = "flight-two";
  const lifecycle = new CanonicalImportLifecycle({
    organization_id: "org-synthetic",
    raw_source_id: "source-synthetic",
    import_item_id: "item-synthetic",
  });
  const revision = normalizeDjiIntermediate(
    privateIntermediate([flight(), flight({ flight_index: 1 })]),
    context({
      canonical_flight_ids: ["flight-one", "flight-two"],
      flight_assignments: assignments,
    }),
  ).valueForPersistence();
  lifecycle.completeInitialProcessing(revision, "2026-01-01T00:00:00Z");
  lifecycle.deleteFlight("flight-one", "2026-01-02T00:00:00Z");
  lifecycle.permanentlyDeleteFlight("flight-one", "2026-02-01T00:00:00Z");

  const state = lifecycle.valueForPersistence();
  assert.equal(state.raw_source_state, "retained");
  assert.equal(state.raw_source_retention_reason, "canonical_flight_reference");
  assert.deepEqual(state.totals, { flight_count: 1, duration_ms: 1000 });
});

test("zero-flight processing completes without inventing a canonical flight", () => {
  const lifecycle = new CanonicalImportLifecycle({
    organization_id: "org-synthetic",
    raw_source_id: "source-synthetic",
    import_item_id: "item-synthetic",
  });
  const revision = normalizeDjiIntermediate(
    privateIntermediate([]),
    context({ canonical_flight_ids: [], flight_assignments: [] }),
  ).valueForPersistence();
  lifecycle.completeInitialProcessing(revision, "2026-01-01T00:00:00Z");

  const state = lifecycle.valueForPersistence();
  assert.equal(state.import_state, "completed");
  assert.equal(state.import_outcome, "zero_flights");
  assert.deepEqual(state.flights, []);
  assert.deepEqual(state.totals, { flight_count: 0, duration_ms: 0 });
  assert.equal(state.raw_source_state, "retained");
  assert.equal(state.raw_source_retention_reason, "zero_flight_import_evidence");

  const laterParserFindsAFlight = normalizeDjiIntermediate(
    privateIntermediate(),
    context({
      processing_attempt_id: "attempt-2",
      processing_revision_id: "revision-2",
      flight_assignments: activeAssignment(),
    }),
  ).valueForPersistence();
  lifecycle.completeReprocessing(laterParserFindsAFlight, "2026-01-02T00:00:00Z");
  const reprocessed = lifecycle.valueForPersistence();
  assert.equal(reprocessed.import_outcome, "flights_ready");
  assert.equal(reprocessed.flights.length, 1);
  assert.deepEqual(reprocessed.totals, { flight_count: 1, duration_ms: 1000 });
});

test("fails closed for raw intermediates, cross-organization overrides, and identity mismatch", () => {
  assert.throws(() => normalizeDjiIntermediate(
    privateIntermediate().valueForNormalizer(),
    context(),
  ), /validated private intermediate/);
  assert.throws(() => normalizeDjiIntermediate(
    privateIntermediate(),
    context({ canonical_flight_ids: [] }),
  ), /must match/);
  assert.throws(() => normalizeDjiIntermediate(
    privateIntermediate(),
    context({ active_overrides: [{
      field: "duration_ms",
      value: 900,
      organization_id: "org-other",
      canonical_flight_id: "flight-synthetic",
      audit_event_id: "audit-1",
      actor_id: "user-1",
      occurred_at: "2026-01-02T00:00:00Z",
    }] }),
  ), /organization/);
  assert.throws(() => normalizeDjiIntermediate(
    privateIntermediate(),
    context({
      flight_assignments: [{
        canonical_flight_id: "flight-synthetic",
        state: "active",
        pilot_id: null,
        aircraft_id: null,
        pilot_assignment_provenance: null,
        aircraft_assignment_provenance: null,
      }],
    }),
  ), /requires pilot and aircraft/);
  assert.throws(() => normalizeDjiIntermediate(
    privateIntermediate(),
    context({ active_overrides: [{
      field: "duration_ms",
      value: "nine hundred",
      organization_id: "org-synthetic",
      canonical_flight_id: "flight-synthetic",
      audit_event_id: "audit-invalid",
      actor_id: "user-1",
      occurred_at: "2026-01-02T00:00:00Z",
    }] }),
  ), /non-negative finite number/);
});
