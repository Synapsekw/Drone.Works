INSERT INTO droneworks.organizations (id, name) VALUES
  ('org-alpha', 'Alpha'),
  ('org-beta', 'Beta');

INSERT INTO droneworks.memberships (organization_id, user_id, role) VALUES
  ('org-alpha', 'user-alpha', 'admin'),
  ('org-alpha', 'user-alpha-former', 'admin'),
  ('org-alpha', 'user-alpha-viewer', 'viewer'),
  ('org-beta', 'user-beta', 'admin');

INSERT INTO droneworks.pilot_profiles (
  organization_id,
  id,
  display_name,
  membership_user_id
) VALUES
  ('org-alpha', 'pilot-alpha', 'Alpha Pilot', 'user-alpha'),
  ('org-beta', 'pilot-beta', 'Beta Pilot', 'user-beta');

INSERT INTO droneworks.aircraft (organization_id, id, display_name) VALUES
  ('org-alpha', 'aircraft-alpha', 'Alpha Aircraft'),
  ('org-beta', 'aircraft-beta', 'Beta Aircraft');

INSERT INTO droneworks.canonical_flights (
  organization_id,
  id,
  pilot_profile_id,
  aircraft_id,
  state,
  duration_ms,
  notes
) VALUES
  ('org-alpha', 'flight-alpha', 'pilot-alpha', 'aircraft-alpha', 'active', 3600000, 'alpha-only'),
  ('org-beta', 'flight-beta', 'pilot-beta', 'aircraft-beta', 'active', 7200000, 'beta-only');

INSERT INTO droneworks.flight_revisions (
  organization_id,
  id,
  canonical_flight_id,
  processing_revision_id,
  facts,
  capabilities
) VALUES
  (
    'org-alpha',
    'revision-alpha',
    'flight-alpha',
    'processing-alpha',
    '{"duration_ms":{"effective":{"origin":"imported","value":3600000}}}',
    ARRAY['telemetry.altitude']
  ),
  (
    'org-beta',
    'revision-beta',
    'flight-beta',
    'processing-beta',
    '{"duration_ms":{"effective":{"origin":"imported","value":7200000}}}',
    ARRAY['telemetry.altitude']
  );

INSERT INTO droneworks.telemetry_samples (
  organization_id,
  flight_revision_id,
  elapsed_ms,
  height_agl_m
) VALUES
  ('org-alpha', 'revision-alpha', 0, 10),
  ('org-alpha', 'revision-alpha', 1000, 12),
  ('org-beta', 'revision-beta', 0, 20),
  ('org-beta', 'revision-beta', 1000, 24);

INSERT INTO droneworks.raw_sources (
  organization_id,
  id,
  object_revision_id,
  state
) VALUES
  ('org-alpha', 'raw-alpha', 'raw-revision-alpha', 'retained'),
  ('org-alpha', 'raw-alpha-deleted', 'raw-revision-alpha-deleted', 'deleted'),
  ('org-beta', 'raw-beta', 'raw-revision-beta', 'retained');

INSERT INTO droneworks.export_artifacts (
  organization_id,
  id,
  object_artifact_id,
  state,
  available_until
) VALUES
  ('org-alpha', 'export-alpha', 'artifact-alpha', 'ready', '2100-01-01T00:00:00Z'),
  ('org-alpha', 'export-alpha-expired', 'artifact-alpha-expired', 'ready', '2000-01-01T00:00:00Z'),
  ('org-beta', 'export-beta', 'artifact-beta', 'ready', '2100-01-01T00:00:00Z');
