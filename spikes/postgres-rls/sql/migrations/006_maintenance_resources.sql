CREATE TABLE droneworks.maintenance_schedules (
  organization_id text NOT NULL,
  id text NOT NULL,
  aircraft_id text NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  schedule_type text NOT NULL
    CHECK (schedule_type IN ('flight_hours', 'flight_count', 'one_shot_date')),
  interval_value bigint,
  due_at timestamptz,
  baseline_at timestamptz NOT NULL,
  due_soon_threshold_percent integer,
  due_soon_days integer,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, aircraft_id)
    REFERENCES droneworks.aircraft (organization_id, id),
  CHECK (
    (
      schedule_type IN ('flight_hours', 'flight_count')
      AND interval_value > 0
      AND due_at IS NULL
      AND due_soon_threshold_percent BETWEEN 1 AND 99
      AND due_soon_days IS NULL
    )
    OR
    (
      schedule_type = 'one_shot_date'
      AND interval_value IS NULL
      AND due_at IS NOT NULL
      AND due_soon_threshold_percent IS NULL
      AND due_soon_days > 0
    )
  )
);

CREATE TABLE droneworks.maintenance_completions (
  organization_id text NOT NULL,
  id text NOT NULL,
  maintenance_schedule_id text NOT NULL,
  completed_by_user_id text NOT NULL,
  completed_at timestamptz NOT NULL,
  details text NOT NULL CHECK (length(btrim(details)) > 0),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, maintenance_schedule_id)
    REFERENCES droneworks.maintenance_schedules (organization_id, id)
    ON DELETE CASCADE
);

ALTER TABLE droneworks.maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.maintenance_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.maintenance_schedules
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.maintenance_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.maintenance_completions FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.maintenance_completions
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

GRANT SELECT, INSERT
  ON droneworks.maintenance_schedules,
     droneworks.maintenance_completions
  TO droneworks_app;
