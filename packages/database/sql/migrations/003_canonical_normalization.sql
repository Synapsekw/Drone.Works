CREATE TABLE droneworks.aircraft_identifiers (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  aircraft_id uuid NOT NULL,
  identifier_type text NOT NULL
    CHECK (identifier_type = 'manufacturer_serial'),
  identifier_value text NOT NULL
    CHECK (length(btrim(identifier_value)) BETWEEN 1 AND 256),
  reliability text NOT NULL CHECK (reliability = 'stable'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, identifier_type, identifier_value),
  FOREIGN KEY (organization_id, aircraft_id)
    REFERENCES droneworks.aircraft (organization_id, id)
    ON DELETE CASCADE
);

ALTER TABLE droneworks.canonical_flights
  ALTER COLUMN pilot_profile_id DROP NOT NULL,
  ALTER COLUMN aircraft_id DROP NOT NULL,
  ALTER COLUMN takeoff_at DROP NOT NULL,
  ALTER COLUMN duration_ms DROP NOT NULL,
  ADD COLUMN proposed_pilot_profile_id uuid,
  ADD COLUMN assignment_status text NOT NULL DEFAULT 'assigned'
    CHECK (assignment_status IN (
      'assigned',
      'awaiting_pilot',
      'awaiting_aircraft',
      'ambiguous_aircraft',
      'awaiting_time',
      'awaiting_multiple'
    )),
  ADD COLUMN pilot_assignment_provenance jsonb
    CHECK (
      pilot_assignment_provenance IS NULL
      OR jsonb_typeof(pilot_assignment_provenance) = 'object'
    ),
  ADD COLUMN aircraft_assignment_provenance jsonb
    CHECK (
      aircraft_assignment_provenance IS NULL
      OR jsonb_typeof(aircraft_assignment_provenance) = 'object'
    ),
  ADD CONSTRAINT canonical_flights_proposed_pilot_fkey
    FOREIGN KEY (organization_id, proposed_pilot_profile_id)
    REFERENCES droneworks.pilot_profiles (organization_id, id),
  ADD CONSTRAINT canonical_flights_assignment_state_check
    CHECK (
      state <> 'active'
      OR (
        assignment_status = 'assigned'
        AND pilot_profile_id IS NOT NULL
        AND aircraft_id IS NOT NULL
      )
    );

ALTER TABLE droneworks.import_items
  ADD COLUMN result_flight_id uuid,
  ADD COLUMN duplicate_of_flight_id uuid,
  ADD COLUMN outcome_reason text
    CHECK (
      outcome_reason IS NULL
      OR outcome_reason ~ '^[a-z0-9][a-z0-9._-]{0,199}$'
    ),
  ADD CONSTRAINT import_items_result_flight_fkey
    FOREIGN KEY (organization_id, result_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id),
  ADD CONSTRAINT import_items_duplicate_flight_fkey
    FOREIGN KEY (organization_id, duplicate_of_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id),
  ADD CONSTRAINT import_items_outcome_reference_check
    CHECK (result_flight_id IS NULL OR duplicate_of_flight_id IS NULL);

ALTER TABLE droneworks.flight_revisions
  ADD COLUMN exact_normalized_version text NOT NULL
    DEFAULT 'exact-normalized-v1'
    CHECK (exact_normalized_version = 'exact-normalized-v1'),
  ADD COLUMN fingerprint_status text NOT NULL DEFAULT 'eligible'
    CHECK (fingerprint_status IN ('eligible', 'insufficient_evidence')),
  ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(provenance) = 'object'),
  ADD CONSTRAINT flight_revisions_fingerprint_state_check
    CHECK (
      (fingerprint_status = 'eligible') =
      (exact_normalized_fingerprint IS NOT NULL)
    );

ALTER TABLE droneworks.telemetry_objects
  DROP CONSTRAINT telemetry_objects_check,
  ADD CONSTRAINT telemetry_objects_elapsed_bounds_check
    CHECK (
      (first_elapsed_ms IS NULL AND last_elapsed_ms IS NULL)
      OR
      (
        sample_count > 0
        AND first_elapsed_ms IS NOT NULL
        AND last_elapsed_ms IS NOT NULL
      )
    );

CREATE INDEX flight_revisions_exact_normalized
  ON droneworks.flight_revisions (
    organization_id,
    exact_normalized_version,
    exact_normalized_fingerprint
  )
  WHERE fingerprint_status = 'eligible';

ALTER TABLE droneworks.aircraft_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.aircraft_identifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.aircraft_identifiers
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

REVOKE ALL ON droneworks.aircraft_identifiers FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  droneworks.aircraft_identifiers
TO droneworks_app;
