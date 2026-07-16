REVOKE DELETE ON droneworks.organizations FROM droneworks_app;

CREATE FUNCTION droneworks.permanently_delete_organization(
  requested_organization_id text,
  expected_deletion_requested_at timestamptz,
  requested_completed_at timestamptz,
  maximum_backup_retention_days integer
)
RETURNS TABLE (
  outcome text,
  organization_id text,
  deletion_requested_at timestamptz,
  completed_at timestamptz,
  backup_retention_until timestamptz,
  raw_object_count integer,
  export_object_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks
AS $$
DECLARE
  existing_receipt record;
  locked_deletion_requested_at timestamptz;
  counted_raw_objects integer;
  counted_export_objects integer;
BEGIN
  IF session_user <> 'droneworks_deletion_worker' THEN
    RAISE EXCEPTION 'permanent deletion requires the deletion worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF maximum_backup_retention_days NOT BETWEEN 0 AND 3650 THEN
    RAISE EXCEPTION 'maximum backup retention days are invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT receipt.*
    INTO existing_receipt
    FROM droneworks_ops.find_organization_deletion_receipt(
      requested_organization_id
    ) AS receipt;
  IF FOUND THEN
    RETURN QUERY SELECT
      'already_deleted'::text,
      existing_receipt.organization_id,
      existing_receipt.deletion_requested_at,
      existing_receipt.completed_at,
      existing_receipt.backup_retention_until,
      existing_receipt.raw_object_count,
      existing_receipt.export_object_count;
    RETURN;
  END IF;

  PERFORM set_config('app.organization_id', requested_organization_id, true);
  SELECT organization.deletion_requested_at
    INTO locked_deletion_requested_at
    FROM droneworks.organizations AS organization
   WHERE organization.id = requested_organization_id
     AND organization.state = 'pending_deletion'
     AND organization.deletion_requested_at = expected_deletion_requested_at
     AND organization.deletion_requested_at
           <= requested_completed_at - interval '30 days'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'not_eligible'::text,
      requested_organization_id,
      NULL::timestamptz,
      NULL::timestamptz,
      NULL::timestamptz,
      0::integer,
      0::integer;
    RETURN;
  END IF;

  SELECT count(*)::integer
    INTO counted_raw_objects
    FROM droneworks.raw_sources;
  SELECT count(*)::integer
    INTO counted_export_objects
    FROM droneworks.export_artifacts;

  DELETE FROM droneworks.maintenance_completions;
  DELETE FROM droneworks.organization_export_requests;
  DELETE FROM droneworks.import_items;
  DELETE FROM droneworks.flight_assignment_overrides;
  DELETE FROM droneworks.flight_tags;
  DELETE FROM droneworks.flight_batteries;
  DELETE FROM droneworks.telemetry_samples;
  DELETE FROM droneworks.raw_source_flights;
  DELETE FROM droneworks.export_artifact_flights;
  DELETE FROM droneworks.maintenance_schedules;
  DELETE FROM droneworks.flight_revisions;
  DELETE FROM droneworks.canonical_flights;
  DELETE FROM droneworks.import_batches;
  DELETE FROM droneworks.raw_sources;
  DELETE FROM droneworks.export_artifacts;
  DELETE FROM droneworks.tags;
  DELETE FROM droneworks.batteries;
  DELETE FROM droneworks.pilot_profiles;
  DELETE FROM droneworks.aircraft;
  DELETE FROM droneworks.api_idempotency_requests;
  DELETE FROM droneworks.audit_events;
  DELETE FROM droneworks.memberships;
  DELETE FROM droneworks.organizations
   WHERE id = requested_organization_id;

  PERFORM droneworks_ops.record_organization_deletion(
    requested_organization_id,
    locked_deletion_requested_at,
    requested_completed_at,
    maximum_backup_retention_days,
    counted_raw_objects,
    counted_export_objects
  );

  RETURN QUERY SELECT
    'deleted'::text,
    requested_organization_id,
    locked_deletion_requested_at,
    requested_completed_at,
    requested_completed_at + make_interval(days => maximum_backup_retention_days),
    counted_raw_objects,
    counted_export_objects;
END
$$;

REVOKE ALL ON FUNCTION droneworks.permanently_delete_organization(
  text,
  timestamptz,
  timestamptz,
  integer
) FROM PUBLIC;

GRANT USAGE ON SCHEMA droneworks TO droneworks_deletion_worker;
GRANT EXECUTE ON FUNCTION droneworks.permanently_delete_organization(
  text,
  timestamptz,
  timestamptz,
  integer
) TO droneworks_deletion_worker;
