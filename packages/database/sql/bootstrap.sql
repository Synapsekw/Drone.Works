BEGIN;

CREATE ROLE droneworks_migrator
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE droneworks_migration_auditor
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE droneworks_migration_runner
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE droneworks_app
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE droneworks_queue
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE droneworks_dispatcher
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

GRANT droneworks_migrator TO droneworks_migration_runner;

CREATE SCHEMA droneworks AUTHORIZATION droneworks_migrator;
CREATE SCHEMA droneworks_jobs AUTHORIZATION droneworks_queue;
CREATE SCHEMA droneworks_ops AUTHORIZATION droneworks_migration_auditor;

REVOKE ALL ON SCHEMA droneworks FROM PUBLIC;
REVOKE ALL ON SCHEMA droneworks_jobs FROM PUBLIC;
REVOKE ALL ON SCHEMA droneworks_ops FROM PUBLIC;

SET ROLE droneworks_migration_auditor;

CREATE TABLE droneworks_ops.migration_runs (
  migration_id text PRIMARY KEY
    CHECK (migration_id ~ '^[a-z0-9][a-z0-9_]{0,127}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  isolation_sha256 text NOT NULL
    CHECK (isolation_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL,
  applied_by name NOT NULL CHECK (applied_by = session_user),
  application_name text NOT NULL CHECK (length(btrim(application_name)) > 0)
);

CREATE FUNCTION droneworks_ops.find_migration(requested_id text)
RETURNS TABLE (
  migration_id text,
  sha256 text,
  isolation_sha256 text,
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
         run.isolation_sha256,
         run.applied_at,
         run.applied_by,
         run.application_name
    FROM droneworks_ops.migration_runs AS run
   WHERE run.migration_id = requested_id
$$;

CREATE FUNCTION droneworks_ops.record_migration(
  requested_id text,
  requested_sha256 text,
  requested_isolation_sha256 text,
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
    isolation_sha256,
    applied_at,
    applied_by,
    application_name
  ) VALUES (
    requested_id,
    requested_sha256,
    requested_isolation_sha256,
    requested_applied_at,
    session_user,
    current_setting('application_name')
  );
END
$$;

RESET ROLE;

REVOKE ALL ON ALL TABLES IN SCHEMA droneworks_ops FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA droneworks_ops FROM PUBLIC;
GRANT USAGE ON SCHEMA droneworks_ops TO droneworks_migration_runner;
GRANT EXECUTE ON FUNCTION droneworks_ops.find_migration(text)
  TO droneworks_migration_runner;
GRANT EXECUTE ON FUNCTION droneworks_ops.record_migration(
  text,
  text,
  text,
  timestamptz
) TO droneworks_migration_runner;

COMMIT;
