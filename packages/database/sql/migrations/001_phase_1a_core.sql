CREATE FUNCTION droneworks.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE TABLE droneworks.organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  default_timezone text NOT NULL
    CHECK (length(btrim(default_timezone)) BETWEEN 1 AND 100),
  unit_system text NOT NULL DEFAULT 'metric'
    CHECK (unit_system IN ('metric', 'imperial')),
  created_at timestamptz NOT NULL
);

CREATE TABLE droneworks.memberships (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'pilot', 'viewer')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.pilot_profiles (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  membership_user_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, membership_user_id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, membership_user_id)
    REFERENCES droneworks.memberships (organization_id, user_id)
);

CREATE TABLE droneworks.aircraft (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  manufacturer text,
  model text,
  lifecycle text NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'retired')),
  airworthiness text NOT NULL DEFAULT 'serviceable'
    CHECK (airworthiness IN ('serviceable', 'restricted', 'grounded')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.raw_sources (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  object_revision_id uuid NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 0 AND 1073741824),
  media_type text NOT NULL CHECK (length(btrim(media_type)) BETWEEN 1 AND 200),
  state text NOT NULL DEFAULT 'retained'
    CHECK (state IN ('retained', 'pending_deletion', 'deleted')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, object_revision_id),
  UNIQUE (organization_id, content_sha256),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.import_batches (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  uploaded_by_user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'processing', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (organization_id, id),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL)),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.import_items (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  raw_source_id uuid,
  client_file_id text NOT NULL
    CHECK (length(btrim(client_file_id)) BETWEEN 1 AND 200),
  original_filename text NOT NULL
    CHECK (length(btrim(original_filename)) BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'uploaded'
    CHECK (state IN (
      'uploaded',
      'queued',
      'detecting',
      'parsing',
      'normalizing',
      'awaiting_review',
      'completed',
      'failed',
      'cancelled',
      'skipped_duplicate'
    )),
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, import_batch_id, client_file_id),
  FOREIGN KEY (organization_id, import_batch_id)
    REFERENCES droneworks.import_batches (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, raw_source_id)
    REFERENCES droneworks.raw_sources (organization_id, id)
);

CREATE TABLE droneworks.import_attempts (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  import_item_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  state text NOT NULL
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  parser_revision text NOT NULL
    CHECK (length(btrim(parser_revision)) BETWEEN 1 AND 200),
  failure_code text,
  started_at timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, import_item_id, attempt_number),
  CHECK (finished_at IS NULL OR started_at IS NOT NULL),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  FOREIGN KEY (organization_id, import_item_id)
    REFERENCES droneworks.import_items (organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.canonical_flights (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  import_item_id uuid,
  pilot_profile_id uuid NOT NULL,
  aircraft_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('imported', 'manual')),
  state text NOT NULL CHECK (state IN ('awaiting_review', 'active', 'deleted')),
  takeoff_at timestamptz NOT NULL,
  takeoff_timezone text NOT NULL
    CHECK (length(btrim(takeoff_timezone)) BETWEEN 1 AND 100),
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  location_text text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  CHECK ((source_kind = 'imported') = (import_item_id IS NOT NULL)),
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
  FOREIGN KEY (organization_id, import_item_id)
    REFERENCES droneworks.import_items (organization_id, id),
  FOREIGN KEY (organization_id, pilot_profile_id)
    REFERENCES droneworks.pilot_profiles (organization_id, id),
  FOREIGN KEY (organization_id, aircraft_id)
    REFERENCES droneworks.aircraft (organization_id, id)
);

CREATE TABLE droneworks.flight_revisions (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  canonical_flight_id uuid NOT NULL,
  import_attempt_id uuid,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  canonical_schema_version integer NOT NULL
    CHECK (canonical_schema_version = 1),
  facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'object'),
  capabilities text[] NOT NULL DEFAULT '{}',
  exact_normalized_fingerprint text
    CHECK (exact_normalized_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, canonical_flight_id, revision_number),
  FOREIGN KEY (organization_id, canonical_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, import_attempt_id)
    REFERENCES droneworks.import_attempts (organization_id, id)
);

CREATE TABLE droneworks.telemetry_objects (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  flight_revision_id uuid NOT NULL,
  object_revision_id uuid NOT NULL,
  codec text NOT NULL CHECK (length(btrim(codec)) BETWEEN 1 AND 100),
  codec_version integer NOT NULL CHECK (codec_version > 0),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  sample_count integer NOT NULL CHECK (sample_count >= 0),
  first_elapsed_ms bigint CHECK (first_elapsed_ms >= 0),
  last_elapsed_ms bigint CHECK (last_elapsed_ms >= first_elapsed_ms),
  capabilities text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, flight_revision_id),
  UNIQUE (organization_id, object_revision_id),
  CHECK (
    (sample_count = 0 AND first_elapsed_ms IS NULL AND last_elapsed_ms IS NULL)
    OR
    (sample_count > 0 AND first_elapsed_ms IS NOT NULL AND last_elapsed_ms IS NOT NULL)
  ),
  FOREIGN KEY (organization_id, flight_revision_id)
    REFERENCES droneworks.flight_revisions (organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.api_idempotency_requests (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  operation text NOT NULL CHECK (length(btrim(operation)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
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
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system')),
  actor_user_id uuid,
  action text NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 200),
  resource_type text NOT NULL
    CHECK (length(btrim(resource_type)) BETWEEN 1 AND 100),
  resource_id uuid NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  CHECK ((actor_kind = 'user') = (actor_user_id IS NOT NULL)),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.outbox_events (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z0-9][a-z0-9._-]{0,199}$'),
  payload_version integer NOT NULL CHECK (payload_version = 1),
  resource_type text NOT NULL
    CHECK (length(btrim(resource_type)) BETWEEN 1 AND 100),
  resource_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'cancelled', 'dispatched')),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  PRIMARY KEY (organization_id, id),
  CHECK ((state = 'dispatched') = (dispatched_at IS NOT NULL)),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE INDEX canonical_flights_active_takeoff
  ON droneworks.canonical_flights (organization_id, takeoff_at DESC, id)
  WHERE state <> 'deleted';

CREATE INDEX outbox_events_pending
  ON droneworks.outbox_events (available_at, created_at, organization_id, id)
  WHERE state = 'pending';

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

ALTER TABLE droneworks.raw_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.raw_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.raw_sources
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.import_batches
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.import_items FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.import_items
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.import_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.import_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.import_attempts
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

ALTER TABLE droneworks.telemetry_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.telemetry_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.telemetry_objects
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

ALTER TABLE droneworks.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.outbox_events
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

REVOKE ALL ON ALL TABLES IN SCHEMA droneworks FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks.current_organization_id() FROM PUBLIC;

GRANT USAGE ON SCHEMA droneworks TO droneworks_app;
GRANT EXECUTE ON FUNCTION droneworks.current_organization_id()
  TO droneworks_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  droneworks.organizations,
  droneworks.memberships,
  droneworks.pilot_profiles,
  droneworks.aircraft,
  droneworks.import_batches,
  droneworks.import_items,
  droneworks.canonical_flights,
  droneworks.api_idempotency_requests
TO droneworks_app;

GRANT SELECT, INSERT, UPDATE ON
  droneworks.raw_sources,
  droneworks.import_attempts,
  droneworks.outbox_events
TO droneworks_app;

GRANT SELECT, INSERT ON
  droneworks.flight_revisions,
  droneworks.telemetry_objects,
  droneworks.audit_events
TO droneworks_app;
