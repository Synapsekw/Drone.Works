CREATE TABLE droneworks.organization_export_requests (
  organization_id text NOT NULL,
  id text NOT NULL,
  requested_by_user_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'processing', 'ready', 'failed')),
  manifest_version integer NOT NULL CHECK (manifest_version = 1),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  requested_at timestamptz NOT NULL,
  export_artifact_id text,
  completed_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, export_artifact_id)
    REFERENCES droneworks.export_artifacts (organization_id, id),
  CHECK ((state = 'ready') = (export_artifact_id IS NOT NULL)),
  CHECK ((state = 'ready') = (completed_at IS NOT NULL))
);

ALTER TABLE droneworks.organization_export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.organization_export_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.organization_export_requests
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

CREATE FUNCTION droneworks.preserve_organization_export_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.manifest_version IS DISTINCT FROM OLD.manifest_version
     OR NEW.manifest IS DISTINCT FROM OLD.manifest
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'organization export snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER preserve_organization_export_snapshot
BEFORE UPDATE ON droneworks.organization_export_requests
FOR EACH ROW
EXECUTE FUNCTION droneworks.preserve_organization_export_snapshot();

REVOKE ALL ON FUNCTION droneworks.preserve_organization_export_snapshot()
  FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON droneworks.organization_export_requests
  TO droneworks_app;
