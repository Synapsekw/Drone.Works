INSERT INTO droneworks.organizations (
  id,
  name,
  pilot_raw_download_enabled,
  pilot_export_enabled
) VALUES
  ('org-alpha', 'Alpha', true, true),
  ('org-beta', 'Beta', false, false);

INSERT INTO droneworks.memberships (organization_id, user_id, role) VALUES
  ('org-alpha', 'user-alpha-owner', 'owner'),
  ('org-alpha', 'user-alpha', 'admin'),
  ('org-alpha', 'user-alpha-pilot', 'pilot'),
  ('org-alpha', 'user-alpha-other-pilot', 'pilot'),
  ('org-alpha', 'user-alpha-former', 'admin'),
  ('org-alpha', 'user-alpha-viewer', 'viewer'),
  ('org-beta', 'user-beta', 'admin'),
  ('org-beta', 'user-beta-pilot', 'pilot'),
  ('org-beta', 'user-beta-viewer', 'viewer');

INSERT INTO droneworks.pilot_profiles (
  organization_id,
  id,
  display_name,
  membership_user_id
) VALUES
  ('org-alpha', 'pilot-alpha', 'Alpha Pilot', 'user-alpha-pilot'),
  ('org-alpha', 'pilot-alpha-other', 'Other Alpha Pilot', 'user-alpha-other-pilot'),
  ('org-beta', 'pilot-beta', 'Beta Pilot', 'user-beta-pilot');

INSERT INTO droneworks.aircraft (organization_id, id, display_name) VALUES
  ('org-alpha', 'aircraft-alpha', 'Alpha Aircraft'),
  ('org-beta', 'aircraft-beta', 'Beta Aircraft');

INSERT INTO droneworks.canonical_flights (
  organization_id,
  id,
  pilot_profile_id,
  aircraft_id,
  imported_pilot_profile_id,
  imported_aircraft_id,
  source_kind,
  state,
  takeoff_at,
  takeoff_timezone,
  duration_ms,
  location_text,
  notes,
  deleted_at,
  deleted_from_state
) VALUES
  ('org-alpha', 'flight-alpha', 'pilot-alpha', 'aircraft-alpha', 'pilot-alpha', 'aircraft-alpha', 'imported', 'active', '2026-07-01T08:00:00Z', 'Asia/Dubai', 3600000, 'Alpha Site', 'alpha-only', NULL, NULL),
  ('org-alpha', 'flight-alpha-other', 'pilot-alpha-other', 'aircraft-alpha', 'pilot-alpha-other', 'aircraft-alpha', 'imported', 'active', '2026-07-02T08:00:00Z', 'Asia/Dubai', 1000, 'Other Alpha Site', 'other-alpha-only', NULL, NULL),
  ('org-alpha', 'flight-alpha-expired-delete', 'pilot-alpha-other', 'aircraft-alpha', 'pilot-alpha-other', 'aircraft-alpha', 'imported', 'deleted', '2026-05-01T08:00:00Z', 'Asia/Dubai', 1000, 'Archived Alpha Site', 'expired-delete', '2026-06-01T00:00:00Z', 'active'),
  ('org-beta', 'flight-beta', 'pilot-beta', 'aircraft-beta', 'pilot-beta', 'aircraft-beta', 'imported', 'active', '2026-07-03T08:00:00Z', 'Asia/Dubai', 7200000, 'Beta Site', 'beta-only', NULL, NULL);

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
  ('org-alpha', 'raw-alpha-other', 'raw-revision-alpha-other', 'retained'),
  ('org-alpha', 'raw-alpha-shared', 'raw-revision-alpha-shared', 'retained'),
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
  ('org-alpha', 'export-alpha-other', 'artifact-alpha-other', 'ready', '2100-01-01T00:00:00Z'),
  ('org-alpha', 'export-alpha-shared', 'artifact-alpha-shared', 'ready', '2100-01-01T00:00:00Z'),
  ('org-beta', 'export-beta', 'artifact-beta', 'ready', '2100-01-01T00:00:00Z');

INSERT INTO droneworks.raw_source_flights (
  organization_id,
  raw_source_id,
  canonical_flight_id
) VALUES
  ('org-alpha', 'raw-alpha', 'flight-alpha'),
  ('org-alpha', 'raw-alpha-deleted', 'flight-alpha'),
  ('org-alpha', 'raw-alpha-other', 'flight-alpha-other'),
  ('org-alpha', 'raw-alpha-shared', 'flight-alpha'),
  ('org-alpha', 'raw-alpha-shared', 'flight-alpha-other'),
  ('org-beta', 'raw-beta', 'flight-beta');

INSERT INTO droneworks.export_artifact_flights (
  organization_id,
  export_artifact_id,
  canonical_flight_id
) VALUES
  ('org-alpha', 'export-alpha', 'flight-alpha'),
  ('org-alpha', 'export-alpha-expired', 'flight-alpha'),
  ('org-alpha', 'export-alpha-other', 'flight-alpha-other'),
  ('org-alpha', 'export-alpha-shared', 'flight-alpha'),
  ('org-alpha', 'export-alpha-shared', 'flight-alpha-other'),
  ('org-beta', 'export-beta', 'flight-beta');
