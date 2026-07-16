DROP SCHEMA IF EXISTS telemetry_benchmark CASCADE;
CREATE SCHEMA telemetry_benchmark;
SET search_path = telemetry_benchmark, public;

CREATE TABLE organizations (
  id integer PRIMARY KEY
);

CREATE TABLE telemetry_templates (
  id integer PRIMARY KEY,
  codec_version smallint NOT NULL CHECK (codec_version IN (1, 2)),
  sample_count integer NOT NULL CHECK (sample_count > 0),
  object_bytes integer NOT NULL CHECK (object_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE telemetry_objects (
  organization_id integer NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flight_id bigint NOT NULL,
  template_id integer NOT NULL REFERENCES telemetry_templates (id),
  object_key text NOT NULL,
  codec_version smallint NOT NULL CHECK (codec_version IN (1, 2)),
  sample_count integer NOT NULL CHECK (sample_count > 0),
  object_bytes integer NOT NULL CHECK (object_bytes > 0),
  object_sha256 text NOT NULL CHECK (object_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (organization_id, flight_id),
  UNIQUE (object_key)
);

CREATE INDEX telemetry_objects_flight_lookup
  ON telemetry_objects (flight_id, organization_id);

CREATE TABLE row_flights (
  organization_id integer NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flight_id bigint NOT NULL,
  started_month date NOT NULL,
  PRIMARY KEY (organization_id, flight_id),
  UNIQUE (organization_id, flight_id, started_month)
);

CREATE TABLE row_samples (
  started_month date NOT NULL,
  organization_id integer NOT NULL,
  flight_id bigint NOT NULL,
  elapsed_ms integer NOT NULL CHECK (elapsed_ms >= 0),
  route_x_m real,
  route_y_m real,
  altitude_m real,
  horizontal_speed_mps real,
  vertical_speed_mps real,
  battery_percent real,
  satellite_count smallint,
  signal_percent smallint,
  flags smallint NOT NULL DEFAULT 0,
  warning_code smallint,
  PRIMARY KEY (started_month, organization_id, flight_id, elapsed_ms),
  FOREIGN KEY (organization_id, flight_id, started_month)
    REFERENCES row_flights (organization_id, flight_id, started_month)
    ON DELETE CASCADE
) PARTITION BY RANGE (started_month);

DO $partitions$
DECLARE
  partition_start date := date '2025-01-01';
  partition_end date;
  partition_index integer;
BEGIN
  FOR partition_index IN 0..23 LOOP
    partition_end := partition_start + interval '1 month';
    EXECUTE format(
      'CREATE TABLE row_samples_%s PARTITION OF row_samples FOR VALUES FROM (%L) TO (%L)',
      to_char(partition_start, 'YYYY_MM'),
      partition_start,
      partition_end
    );
    partition_start := partition_end;
  END LOOP;
END
$partitions$;

CREATE INDEX row_samples_flight_elapsed
  ON row_samples (organization_id, flight_id, elapsed_ms);
