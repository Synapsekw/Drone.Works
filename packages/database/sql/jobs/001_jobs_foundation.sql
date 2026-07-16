CREATE TABLE droneworks_jobs.outbox (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type = 'raw-source-processing-v1'),
  payload_version integer NOT NULL CHECK (payload_version = 1),
  resource_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'dispatched', 'cancelled')),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  claim_token uuid,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  queue_job_id uuid,
  dispatched_at timestamptz,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, job_type, resource_id),
  CHECK (available_at >= created_at),
  CHECK (
    (state = 'pending' AND claim_token IS NULL AND claim_expires_at IS NULL
      AND queue_job_id IS NULL AND dispatched_at IS NULL)
    OR
    (state = 'claimed' AND claim_token IS NOT NULL
      AND claim_expires_at IS NOT NULL AND queue_job_id IS NULL
      AND dispatched_at IS NULL)
    OR
    (state = 'dispatched' AND claim_token IS NULL
      AND claim_expires_at IS NULL AND queue_job_id IS NOT NULL
      AND dispatched_at IS NOT NULL)
    OR
    (state = 'cancelled' AND claim_token IS NULL
      AND claim_expires_at IS NULL AND queue_job_id IS NULL
      AND dispatched_at IS NULL)
  )
);

CREATE INDEX outbox_dispatch_order
  ON droneworks_jobs.outbox (
    state, available_at, created_at, organization_id, id
  );

CREATE FUNCTION droneworks_jobs.enqueue_import(
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
    RAISE EXCEPTION 'job enqueue requires the application role'
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
    RAISE EXCEPTION 'job reference is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO droneworks_jobs.outbox (
    organization_id, id, job_type, payload_version, resource_id,
    state, available_at, created_at
  ) VALUES (
    requested_organization_id, requested_id, 'raw-source-processing-v1', 1,
    requested_resource_id, 'pending', requested_now, requested_now
  )
  ON CONFLICT (organization_id, job_type, resource_id)
    DO UPDATE SET id = droneworks_jobs.outbox.id
  RETURNING id INTO retained_id;
  RETURN retained_id;
END
$$;

CREATE FUNCTION droneworks_jobs.cancel_import(requested_resource_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_jobs
AS $$
DECLARE
  requested_organization_id uuid;
BEGIN
  IF session_user <> 'droneworks_app' THEN
    RAISE EXCEPTION 'job cancellation requires the application role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  requested_organization_id :=
    nullif(current_setting('app.organization_id', true), '')::uuid;
  IF requested_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE droneworks_jobs.outbox
     SET state = 'cancelled',
         claim_token = NULL,
         claim_expires_at = NULL
   WHERE organization_id = requested_organization_id
     AND resource_id = requested_resource_id
     AND job_type = 'raw-source-processing-v1'
     AND state = 'pending';
  RETURN FOUND;
END
$$;

CREATE FUNCTION droneworks_jobs.claim_outbox(
  requested_claim_token uuid,
  requested_now timestamptz,
  requested_lease_seconds integer,
  requested_limit integer
)
RETURNS TABLE (
  organization_id uuid,
  id uuid,
  job_type text,
  payload_version integer,
  resource_id uuid,
  created_at timestamptz,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_jobs
AS $$
BEGIN
  IF session_user <> 'droneworks_dispatcher' THEN
    RAISE EXCEPTION 'outbox claim requires the dispatcher role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF requested_claim_token IS NULL OR requested_now IS NULL
     OR requested_lease_seconds NOT BETWEEN 10 AND 600
     OR requested_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'outbox claim parameters are invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT pending.organization_id, pending.id
      FROM droneworks_jobs.outbox AS pending
     WHERE (
             pending.state = 'pending'
             AND pending.available_at <= requested_now
           )
        OR (
             pending.state = 'claimed'
             AND pending.claim_expires_at <= requested_now
           )
     ORDER BY pending.available_at, pending.created_at,
              pending.organization_id, pending.id
     FOR UPDATE SKIP LOCKED
     LIMIT requested_limit
  )
  UPDATE droneworks_jobs.outbox AS claimed
     SET state = 'claimed',
         claim_token = requested_claim_token,
         claim_expires_at = requested_now
           + make_interval(secs => requested_lease_seconds),
         attempt_count = claimed.attempt_count + 1
    FROM eligible
   WHERE claimed.organization_id = eligible.organization_id
     AND claimed.id = eligible.id
  RETURNING claimed.organization_id, claimed.id, claimed.job_type,
            claimed.payload_version, claimed.resource_id,
            claimed.created_at, claimed.attempt_count;
END
$$;

CREATE FUNCTION droneworks_jobs.complete_outbox(
  requested_organization_id uuid,
  requested_id uuid,
  requested_claim_token uuid,
  requested_queue_job_id uuid,
  requested_dispatched_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_jobs
AS $$
BEGIN
  IF session_user <> 'droneworks_dispatcher' THEN
    RAISE EXCEPTION 'outbox completion requires the dispatcher role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE droneworks_jobs.outbox
     SET state = 'dispatched', claim_token = NULL, claim_expires_at = NULL,
         queue_job_id = requested_queue_job_id,
         dispatched_at = requested_dispatched_at
   WHERE organization_id = requested_organization_id
     AND id = requested_id
     AND state = 'claimed'
     AND claim_token = requested_claim_token;
  RETURN FOUND;
END
$$;

CREATE FUNCTION droneworks_jobs.release_outbox(
  requested_organization_id uuid,
  requested_id uuid,
  requested_claim_token uuid,
  requested_available_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_jobs
AS $$
BEGIN
  IF session_user <> 'droneworks_dispatcher' THEN
    RAISE EXCEPTION 'outbox release requires the dispatcher role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE droneworks_jobs.outbox
     SET state = 'pending', available_at = requested_available_at,
         claim_token = NULL, claim_expires_at = NULL
   WHERE organization_id = requested_organization_id
     AND id = requested_id
     AND state = 'claimed'
     AND claim_token = requested_claim_token;
  RETURN FOUND;
END
$$;

CREATE FUNCTION droneworks_jobs.outbox_metrics(requested_now timestamptz)
RETURNS TABLE (
  pending_count bigint,
  claimed_count bigint,
  cancelled_count bigint,
  oldest_pending_seconds double precision,
  retry_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_jobs
AS $$
BEGIN
  IF session_user <> 'droneworks_dispatcher' THEN
    RAISE EXCEPTION 'outbox metrics require the dispatcher role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT count(*) FILTER (WHERE state = 'pending'),
         count(*) FILTER (WHERE state = 'claimed'),
         count(*) FILTER (WHERE state = 'cancelled'),
         coalesce(
           extract(epoch FROM requested_now - min(created_at)
             FILTER (WHERE state = 'pending')),
           0
         )::double precision,
         coalesce(sum(greatest(attempt_count - 1, 0)), 0)
    FROM droneworks_jobs.outbox;
END
$$;

REVOKE ALL ON TABLE droneworks_jobs.outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks_jobs.enqueue_import(uuid, uuid, timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks_jobs.cancel_import(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks_jobs.claim_outbox(
  uuid, timestamptz, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks_jobs.complete_outbox(
  uuid, uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks_jobs.release_outbox(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks_jobs.outbox_metrics(timestamptz) FROM PUBLIC;

GRANT USAGE ON SCHEMA droneworks_jobs TO droneworks_app, droneworks_dispatcher;
GRANT EXECUTE ON FUNCTION droneworks_jobs.enqueue_import(
  uuid, uuid, timestamptz
) TO droneworks_app;
GRANT EXECUTE ON FUNCTION droneworks_jobs.cancel_import(uuid)
  TO droneworks_app;
GRANT EXECUTE ON FUNCTION droneworks_jobs.claim_outbox(
  uuid, timestamptz, integer, integer
) TO droneworks_dispatcher;
GRANT EXECUTE ON FUNCTION droneworks_jobs.complete_outbox(
  uuid, uuid, uuid, uuid, timestamptz
) TO droneworks_dispatcher;
GRANT EXECUTE ON FUNCTION droneworks_jobs.release_outbox(
  uuid, uuid, uuid, timestamptz
) TO droneworks_dispatcher;
GRANT EXECUTE ON FUNCTION droneworks_jobs.outbox_metrics(timestamptz)
  TO droneworks_dispatcher;
