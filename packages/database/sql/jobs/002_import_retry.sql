CREATE FUNCTION droneworks_jobs.retry_import(
  requested_id uuid,
  requested_resource_id uuid,
  requested_now timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_jobs
AS $$
DECLARE
  requested_organization_id uuid;
  retained_id uuid;
BEGIN
  IF session_user <> 'droneworks_app' THEN
    RAISE EXCEPTION 'job retry requires the application role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  requested_organization_id :=
    nullif(current_setting('app.organization_id', true), '')::uuid;
  IF requested_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF requested_id IS NULL OR requested_resource_id IS NULL
     OR requested_now IS NULL THEN
    RAISE EXCEPTION 'job retry reference is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE droneworks_jobs.outbox
     SET id = requested_id,
         state = 'pending',
         available_at = requested_now,
         created_at = requested_now,
         claim_token = NULL,
         claim_expires_at = NULL,
         attempt_count = 0,
         queue_job_id = NULL,
         dispatched_at = NULL
   WHERE organization_id = requested_organization_id
     AND resource_id = requested_resource_id
     AND job_type = 'raw-source-processing-v1'
     AND state = 'dispatched'
  RETURNING id INTO retained_id;
  RETURN retained_id;
END
$$;

REVOKE ALL ON FUNCTION droneworks_jobs.retry_import(uuid, uuid, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION droneworks_jobs.retry_import(uuid, uuid, timestamptz)
  TO droneworks_app;
