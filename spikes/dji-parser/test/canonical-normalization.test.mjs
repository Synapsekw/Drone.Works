import assert from "node:assert/strict";
import { test } from "node:test";
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
