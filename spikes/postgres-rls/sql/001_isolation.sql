BEGIN;

CREATE ROLE droneworks_migrator
  NOLOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

CREATE ROLE droneworks_migration_auditor
  NOLOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

CREATE ROLE droneworks_migration_runner
  LOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

CREATE ROLE droneworks_app
  LOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

CREATE ROLE droneworks_queue
  LOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

CREATE ROLE droneworks_deletion_worker
  LOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

GRANT droneworks_migrator TO droneworks_migration_runner;

CREATE SCHEMA droneworks AUTHORIZATION droneworks_migrator;
CREATE SCHEMA droneworks_jobs AUTHORIZATION droneworks_queue;
CREATE SCHEMA droneworks_ops AUTHORIZATION droneworks_migration_auditor;

REVOKE ALL ON SCHEMA droneworks_jobs FROM PUBLIC;
REVOKE ALL ON SCHEMA droneworks_ops FROM PUBLIC;

SET ROLE droneworks_migration_auditor;

CREATE TABLE droneworks_ops.migration_runs (
  migration_id text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL,
  applied_by name NOT NULL CHECK (applied_by = session_user),
  application_name text NOT NULL CHECK (length(btrim(application_name)) > 0)
);

CREATE TABLE droneworks_ops.organization_deletion_receipts (
  organization_id text PRIMARY KEY CHECK (length(btrim(organization_id)) > 0),
  deletion_requested_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  maximum_backup_retention_days integer NOT NULL
    CHECK (maximum_backup_retention_days BETWEEN 0 AND 3650),
  backup_retention_until timestamptz NOT NULL,
  raw_object_count integer NOT NULL CHECK (raw_object_count >= 0),
  export_object_count integer NOT NULL CHECK (export_object_count >= 0),
  completed_by name NOT NULL CHECK (completed_by = session_user),
  CHECK (completed_at >= deletion_requested_at + interval '30 days'),
  CHECK (
    backup_retention_until = completed_at
      + make_interval(days => maximum_backup_retention_days)
  )
);

CREATE FUNCTION droneworks_ops.find_migration(requested_id text)
RETURNS TABLE (
  migration_id text,
  sha256 text,
  applied_at timestamptz,
  applied_by name,
  application_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_ops
AS $$
  SELECT run.migration_id,
         run.sha256,
         run.applied_at,
         run.applied_by,
         run.application_name
    FROM droneworks_ops.migration_runs AS run
   WHERE run.migration_id = requested_id
$$;

CREATE FUNCTION droneworks_ops.record_migration(
  requested_id text,
  requested_sha256 text,
  requested_applied_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_ops
AS $$
BEGIN
  IF session_user <> 'droneworks_migration_runner' THEN
    RAISE EXCEPTION 'migration ledger writes require the migration runner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO droneworks_ops.migration_runs (
    migration_id,
    sha256,
    applied_at,
    applied_by,
    application_name
  ) VALUES (
    requested_id,
    requested_sha256,
    requested_applied_at,
    session_user,
    current_setting('application_name')
  );
END
$$;

CREATE FUNCTION droneworks_ops.find_organization_deletion_receipt(
  requested_organization_id text
)
RETURNS TABLE (
  organization_id text,
  deletion_requested_at timestamptz,
  completed_at timestamptz,
  maximum_backup_retention_days integer,
  backup_retention_until timestamptz,
  raw_object_count integer,
  export_object_count integer,
  completed_by name
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_ops
AS $$
BEGIN
  IF session_user <> 'droneworks_deletion_worker' THEN
    RAISE EXCEPTION 'deletion receipts require the deletion worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT receipt.organization_id,
         receipt.deletion_requested_at,
         receipt.completed_at,
         receipt.maximum_backup_retention_days,
         receipt.backup_retention_until,
         receipt.raw_object_count,
         receipt.export_object_count,
         receipt.completed_by
    FROM droneworks_ops.organization_deletion_receipts AS receipt
   WHERE receipt.organization_id = requested_organization_id;
END
$$;

CREATE FUNCTION droneworks_ops.record_organization_deletion(
  requested_organization_id text,
  requested_deletion_at timestamptz,
  requested_completed_at timestamptz,
  requested_backup_retention_days integer,
  requested_raw_object_count integer,
  requested_export_object_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_ops
AS $$
BEGIN
  IF session_user <> 'droneworks_deletion_worker' THEN
    RAISE EXCEPTION 'deletion receipt writes require the deletion worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO droneworks_ops.organization_deletion_receipts (
    organization_id,
    deletion_requested_at,
    completed_at,
    maximum_backup_retention_days,
    backup_retention_until,
    raw_object_count,
    export_object_count,
    completed_by
  ) VALUES (
    requested_organization_id,
    requested_deletion_at,
    requested_completed_at,
    requested_backup_retention_days,
    requested_completed_at + make_interval(days => requested_backup_retention_days),
    requested_raw_object_count,
    requested_export_object_count,
    session_user
  );
END
$$;

RESET ROLE;

REVOKE ALL ON ALL TABLES IN SCHEMA droneworks_ops FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA droneworks_ops FROM PUBLIC;
GRANT USAGE ON SCHEMA droneworks_ops TO droneworks_migration_runner;
GRANT USAGE ON SCHEMA droneworks_ops
  TO droneworks_migrator, droneworks_deletion_worker;
GRANT EXECUTE ON FUNCTION droneworks_ops.find_migration(text)
  TO droneworks_migration_runner;
GRANT EXECUTE ON FUNCTION droneworks_ops.record_migration(text, text, timestamptz)
  TO droneworks_migration_runner;
GRANT EXECUTE ON FUNCTION droneworks_ops.find_organization_deletion_receipt(text)
  TO droneworks_migrator, droneworks_deletion_worker;
GRANT EXECUTE ON FUNCTION droneworks_ops.record_organization_deletion(
  text,
  timestamptz,
  timestamptz,
  integer,
  integer,
  integer
) TO droneworks_migrator;

SET ROLE droneworks_migrator;

CREATE FUNCTION droneworks.current_organization_id()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')
$$;

CREATE TABLE droneworks.organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  pilot_raw_download_enabled boolean NOT NULL DEFAULT true,
  pilot_export_enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE droneworks.memberships (
  organization_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'pilot', 'viewer')),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.pilot_profiles (
  organization_id text NOT NULL,
  id text NOT NULL,
  display_name text NOT NULL,
  membership_user_id text,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE,
  CONSTRAINT pilot_profiles_membership_fkey
    FOREIGN KEY (organization_id, membership_user_id)
    REFERENCES droneworks.memberships (organization_id, user_id)
);

CREATE TABLE droneworks.aircraft (
  organization_id text NOT NULL,
  id text NOT NULL,
  display_name text NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.canonical_flights (
  organization_id text NOT NULL,
  id text NOT NULL,
  pilot_profile_id text NOT NULL,
  aircraft_id text NOT NULL,
  imported_pilot_profile_id text,
  imported_aircraft_id text,
  source_kind text NOT NULL DEFAULT 'imported'
    CHECK (source_kind IN ('imported', 'manual')),
  state text NOT NULL CHECK (state IN ('awaiting_review', 'active', 'deleted')),
  takeoff_at timestamptz NOT NULL,
  takeoff_timezone text NOT NULL CHECK (length(btrim(takeoff_timezone)) > 0),
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  location_text text,
  notes text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  deleted_from_state text CHECK (deleted_from_state IN ('awaiting_review', 'active')),
  CHECK (source_kind <> 'manual' OR NULLIF(btrim(location_text), '') IS NOT NULL),
  CHECK (
    (source_kind = 'imported') = (
      imported_pilot_profile_id IS NOT NULL
      AND imported_aircraft_id IS NOT NULL
    )
  ),
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK ((state = 'deleted') = (deleted_from_state IS NOT NULL)),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, pilot_profile_id)
    REFERENCES droneworks.pilot_profiles (organization_id, id),
  FOREIGN KEY (organization_id, aircraft_id)
    REFERENCES droneworks.aircraft (organization_id, id),
  FOREIGN KEY (organization_id, imported_pilot_profile_id)
    REFERENCES droneworks.pilot_profiles (organization_id, id),
  FOREIGN KEY (organization_id, imported_aircraft_id)
    REFERENCES droneworks.aircraft (organization_id, id)
);

CREATE TABLE droneworks.flight_revisions (
  organization_id text NOT NULL,
  id text NOT NULL,
  canonical_flight_id text NOT NULL,
  processing_revision_id text NOT NULL,
  facts jsonb NOT NULL,
  capabilities text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, canonical_flight_id, processing_revision_id),
  FOREIGN KEY (organization_id, canonical_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.telemetry_samples (
  organization_id text NOT NULL,
  flight_revision_id text NOT NULL,
  elapsed_ms bigint NOT NULL CHECK (elapsed_ms >= 0),
  height_agl_m double precision,
  PRIMARY KEY (organization_id, flight_revision_id, elapsed_ms),
  FOREIGN KEY (organization_id, flight_revision_id)
    REFERENCES droneworks.flight_revisions (organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.raw_sources (
  organization_id text NOT NULL,
  id text NOT NULL,
  object_revision_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('retained', 'deleted')),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, object_revision_id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.export_artifacts (
  organization_id text NOT NULL,
  id text NOT NULL,
  object_artifact_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('ready', 'expired', 'deleted')),
  available_until timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, object_artifact_id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.raw_source_flights (
  organization_id text NOT NULL,
  raw_source_id text NOT NULL,
  canonical_flight_id text NOT NULL,
  PRIMARY KEY (organization_id, raw_source_id, canonical_flight_id),
  FOREIGN KEY (organization_id, raw_source_id)
    REFERENCES droneworks.raw_sources (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, canonical_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.export_artifact_flights (
  organization_id text NOT NULL,
  export_artifact_id text NOT NULL,
  canonical_flight_id text NOT NULL,
  PRIMARY KEY (organization_id, export_artifact_id, canonical_flight_id),
  FOREIGN KEY (organization_id, export_artifact_id)
    REFERENCES droneworks.export_artifacts (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, canonical_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.api_idempotency_requests (
  organization_id text NOT NULL,
  user_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (organization_id, user_id, operation, idempotency_key),
  CHECK ((response_status IS NULL) = (response_body IS NULL)),
  CHECK ((response_status IS NULL) = (completed_at IS NULL)),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.audit_events (
  organization_id text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.flight_assignment_overrides (
  organization_id text NOT NULL,
  canonical_flight_id text NOT NULL,
  pilot_profile_id text NOT NULL,
  aircraft_id text NOT NULL,
  actor_user_id text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, canonical_flight_id),
  FOREIGN KEY (organization_id, canonical_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, pilot_profile_id)
    REFERENCES droneworks.pilot_profiles (organization_id, id),
  FOREIGN KEY (organization_id, aircraft_id)
    REFERENCES droneworks.aircraft (organization_id, id)
);

ALTER TABLE droneworks.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.organizations
  USING (id = droneworks.current_organization_id())
  WITH CHECK (id = droneworks.current_organization_id());

ALTER TABLE droneworks.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.memberships
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.pilot_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.pilot_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.pilot_profiles
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.aircraft ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.aircraft FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.aircraft
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.canonical_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.canonical_flights FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.canonical_flights
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.flight_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.flight_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.flight_revisions
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.telemetry_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.telemetry_samples FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.telemetry_samples
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.raw_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.raw_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.raw_sources
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.export_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.export_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.export_artifacts
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.raw_source_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.raw_source_flights FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.raw_source_flights
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.export_artifact_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.export_artifact_flights FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.export_artifact_flights
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.api_idempotency_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.api_idempotency_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.api_idempotency_requests
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.audit_events
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.flight_assignment_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.flight_assignment_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.flight_assignment_overrides
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

REVOKE ALL ON SCHEMA droneworks FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA droneworks FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks.current_organization_id() FROM PUBLIC;

GRANT USAGE ON SCHEMA droneworks TO droneworks_app;
GRANT EXECUTE ON FUNCTION droneworks.current_organization_id() TO droneworks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA droneworks TO droneworks_app;

RESET ROLE;

COMMIT;
