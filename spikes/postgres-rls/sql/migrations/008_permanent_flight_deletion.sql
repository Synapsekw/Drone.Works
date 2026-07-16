REVOKE DELETE ON droneworks.canonical_flights FROM droneworks_app;
REVOKE DELETE ON droneworks.raw_sources FROM droneworks_app;

CREATE FUNCTION droneworks.permanently_delete_flight(
  requested_organization_id text,
  requested_flight_id text,
  expected_deleted_at timestamptz,
  requested_completed_at timestamptz
)
RETURNS TABLE (
  outcome text,
  organization_id text,
  flight_id text,
  deleted_at timestamptz,
  completed_at timestamptz,
  deleted_raw_source_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks
AS $$
DECLARE
  existing_event record;
  locked_deleted_at timestamptz;
  exclusive_raw_source_ids text[];
  removed_raw_source_count integer;
BEGIN
  IF session_user <> 'droneworks_deletion_worker' THEN
    RAISE EXCEPTION 'permanent flight deletion requires the deletion worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('app.organization_id', requested_organization_id, true);
  SELECT event.metadata,
         event.occurred_at
    INTO existing_event
    FROM droneworks.audit_events AS event
   WHERE event.action = 'flight.permanently_deleted'
     AND event.resource_type = 'flight'
     AND event.resource_id = requested_flight_id
   ORDER BY event.occurred_at DESC, event.id DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT
      'already_deleted'::text,
      requested_organization_id,
      requested_flight_id,
      (existing_event.metadata->>'deleted_at')::timestamptz,
      existing_event.occurred_at,
      (existing_event.metadata->>'deleted_raw_source_count')::integer;
    RETURN;
  END IF;

  SELECT flight.deleted_at
    INTO locked_deleted_at
    FROM droneworks.canonical_flights AS flight
   WHERE flight.id = requested_flight_id
     AND flight.state = 'deleted'
     AND flight.deleted_at = expected_deleted_at
     AND flight.deleted_at <= requested_completed_at - interval '30 days'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'not_eligible'::text,
      requested_organization_id,
      requested_flight_id,
      NULL::timestamptz,
      NULL::timestamptz,
      0::integer;
    RETURN;
  END IF;

  SELECT coalesce(array_agg(link.raw_source_id ORDER BY link.raw_source_id), '{}')
    INTO exclusive_raw_source_ids
    FROM droneworks.raw_source_flights AS link
   WHERE link.canonical_flight_id = requested_flight_id
     AND NOT EXISTS (
       SELECT 1
         FROM droneworks.raw_source_flights AS other
        WHERE other.raw_source_id = link.raw_source_id
          AND other.canonical_flight_id <> requested_flight_id
     );
  removed_raw_source_count := cardinality(exclusive_raw_source_ids);

  UPDATE droneworks.import_items
     SET raw_source_id = NULL
   WHERE raw_source_id = ANY(exclusive_raw_source_ids);

  DELETE FROM droneworks.canonical_flights
   WHERE id = requested_flight_id;

  DELETE FROM droneworks.raw_sources
   WHERE id = ANY(exclusive_raw_source_ids);

  INSERT INTO droneworks.audit_events (
    organization_id,
    actor_user_id,
    action,
    resource_type,
    resource_id,
    changed_fields,
    metadata,
    occurred_at
  ) VALUES (
    droneworks.current_organization_id(),
    'system:deletion-worker',
    'flight.permanently_deleted',
    'flight',
    requested_flight_id,
    ARRAY['state'],
    jsonb_build_object(
      'deleted_at', to_char(
        locked_deleted_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'deleted_raw_source_count', removed_raw_source_count
    ),
    requested_completed_at
  );

  RETURN QUERY SELECT
    'deleted'::text,
    requested_organization_id,
    requested_flight_id,
    locked_deleted_at,
    requested_completed_at,
    removed_raw_source_count;
END
$$;

REVOKE ALL ON FUNCTION droneworks.permanently_delete_flight(
  text,
  text,
  timestamptz,
  timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION droneworks.permanently_delete_flight(
  text,
  text,
  timestamptz,
  timestamptz
) TO droneworks_deletion_worker;
