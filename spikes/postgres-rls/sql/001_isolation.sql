BEGIN;

CREATE ROLE droneworks_migrator
  NOLOGIN
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

CREATE SCHEMA droneworks AUTHORIZATION droneworks_migrator;
CREATE SCHEMA droneworks_jobs AUTHORIZATION droneworks_queue;

REVOKE ALL ON SCHEMA droneworks_jobs FROM PUBLIC;

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
  name text NOT NULL
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
  state text NOT NULL CHECK (state IN ('awaiting_review', 'active', 'deleted')),
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  notes text NOT NULL DEFAULT '',
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, pilot_profile_id)
    REFERENCES droneworks.pilot_profiles (organization_id, id),
  FOREIGN KEY (organization_id, aircraft_id)
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

REVOKE ALL ON SCHEMA droneworks FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA droneworks FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks.current_organization_id() FROM PUBLIC;

GRANT USAGE ON SCHEMA droneworks TO droneworks_app;
GRANT EXECUTE ON FUNCTION droneworks.current_organization_id() TO droneworks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA droneworks TO droneworks_app;

RESET ROLE;

COMMIT;
