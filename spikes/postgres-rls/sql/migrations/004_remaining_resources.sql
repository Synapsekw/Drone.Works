CREATE TABLE droneworks.tags (
  organization_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, name),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.batteries (
  organization_id text NOT NULL,
  id text NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  serial_number text,
  lifecycle text NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'retired')),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, serial_number),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.flight_tags (
  organization_id text NOT NULL,
  canonical_flight_id text NOT NULL,
  tag_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('imported', 'user_override')),
  PRIMARY KEY (organization_id, canonical_flight_id, tag_id),
  FOREIGN KEY (organization_id, canonical_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, tag_id)
    REFERENCES droneworks.tags (organization_id, id)
);

CREATE TABLE droneworks.flight_batteries (
  organization_id text NOT NULL,
  canonical_flight_id text NOT NULL,
  battery_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('imported', 'user_override')),
  PRIMARY KEY (organization_id, canonical_flight_id, battery_id),
  FOREIGN KEY (organization_id, canonical_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, battery_id)
    REFERENCES droneworks.batteries (organization_id, id)
);

CREATE TABLE droneworks.import_batches (
  organization_id text NOT NULL,
  id text NOT NULL,
  uploaded_by_user_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('uploaded', 'processing', 'completed')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.import_items (
  organization_id text NOT NULL,
  id text NOT NULL,
  import_batch_id text NOT NULL,
  client_file_id text NOT NULL,
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) > 0),
  raw_source_id text,
  state text NOT NULL CHECK (
    state IN (
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
    )
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, import_batch_id, client_file_id),
  FOREIGN KEY (organization_id, import_batch_id)
    REFERENCES droneworks.import_batches (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, raw_source_id)
    REFERENCES droneworks.raw_sources (organization_id, id)
);

ALTER TABLE droneworks.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.tags FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.tags
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.batteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.batteries FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.batteries
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.flight_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.flight_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.flight_tags
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.flight_batteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.flight_batteries FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.flight_batteries
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

GRANT SELECT, INSERT, UPDATE, DELETE
  ON droneworks.tags,
     droneworks.batteries,
     droneworks.flight_tags,
     droneworks.flight_batteries,
     droneworks.import_batches,
     droneworks.import_items
  TO droneworks_app;
