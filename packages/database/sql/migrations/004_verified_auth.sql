CREATE TABLE droneworks_auth.users (
  id uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL,
  image text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE droneworks_auth.sessions (
  id uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL
    REFERENCES droneworks_auth.users (id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks_auth.accounts (
  id uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL
    REFERENCES droneworks_auth.users (id)
    ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL
);

CREATE TABLE droneworks_auth.verifications (
  id uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX sessions_user_id_idx
  ON droneworks_auth.sessions (user_id);
CREATE INDEX accounts_user_id_idx
  ON droneworks_auth.accounts (user_id);
CREATE INDEX verifications_identifier_idx
  ON droneworks_auth.verifications (identifier);

CREATE TABLE droneworks_auth.auth_audit_events (
  id uuid PRIMARY KEY,
  action text NOT NULL
    CHECK (action ~ '^[a-z0-9][a-z0-9._-]{0,199}$'),
  resource_type text NOT NULL CHECK (resource_type IN ('session', 'user')),
  resource_id uuid NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL
);

CREATE TABLE droneworks_auth.membership_locator (
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE droneworks.invitations (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  email_normalized text NOT NULL
    CHECK (
      email_normalized = lower(btrim(email_normalized))
      AND length(email_normalized) BETWEEN 3 AND 320
    ),
  role text NOT NULL CHECK (role IN ('admin', 'pilot', 'viewer')),
  token_sha256 text NOT NULL UNIQUE
    CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid,
  revoked_at timestamptz,
  PRIMARY KEY (organization_id, id),
  CHECK (expires_at > created_at),
  CHECK (
    (accepted_at IS NULL AND accepted_by_user_id IS NULL)
    OR (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)
  ),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  FOREIGN KEY (organization_id)
    REFERENCES droneworks.organizations (id)
    ON DELETE CASCADE
);

CREATE INDEX invitations_active_email_idx
  ON droneworks.invitations (organization_id, email_normalized, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE droneworks.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.invitations
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

CREATE FUNCTION droneworks.sync_membership_locator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks_auth
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM droneworks_auth.membership_locator
     WHERE user_id = OLD.user_id
       AND organization_id = OLD.organization_id;
    RETURN OLD;
  END IF;

  INSERT INTO droneworks_auth.membership_locator (user_id, organization_id)
  VALUES (NEW.user_id, NEW.organization_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;

CREATE TRIGGER sync_membership_locator
AFTER INSERT OR DELETE ON droneworks.memberships
FOR EACH ROW EXECUTE FUNCTION droneworks.sync_membership_locator();

CREATE FUNCTION droneworks.prepare_auth_user_deletion(requested_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, droneworks, droneworks_auth
AS $$
DECLARE
  located_organization_id uuid;
  requested_role text;
  remaining_owner_count integer;
BEGIN
  IF session_user <> 'droneworks_app' THEN
    RAISE EXCEPTION 'identity lifecycle requires the application role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR located_organization_id IN
    SELECT locator.organization_id
      FROM droneworks_auth.membership_locator AS locator
     WHERE locator.user_id = requested_user_id
     ORDER BY locator.organization_id
  LOOP
    PERFORM set_config(
      'app.organization_id',
      located_organization_id::text,
      true
    );
    PERFORM 1
      FROM droneworks.organizations
     WHERE id = located_organization_id
       FOR UPDATE;
    SELECT membership.role
      INTO requested_role
      FROM droneworks.memberships AS membership
     WHERE membership.organization_id = located_organization_id
       AND membership.user_id = requested_user_id;
    IF requested_role = 'owner' THEN
      SELECT count(*)::integer
        INTO remaining_owner_count
        FROM droneworks.memberships AS membership
       WHERE membership.organization_id = located_organization_id
         AND membership.role = 'owner'
         AND membership.user_id <> requested_user_id;
      IF remaining_owner_count = 0 THEN
        RAISE EXCEPTION 'account deletion would orphan an organization'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  FOR located_organization_id IN
    SELECT locator.organization_id
      FROM droneworks_auth.membership_locator AS locator
     WHERE locator.user_id = requested_user_id
     ORDER BY locator.organization_id
  LOOP
    PERFORM set_config(
      'app.organization_id',
      located_organization_id::text,
      true
    );
    UPDATE droneworks.pilot_profiles
       SET membership_user_id = NULL
     WHERE organization_id = located_organization_id
       AND membership_user_id = requested_user_id;
    DELETE FROM droneworks.memberships
     WHERE organization_id = located_organization_id
       AND user_id = requested_user_id;
    INSERT INTO droneworks.audit_events (
      organization_id, id, actor_kind, actor_user_id, action,
      resource_type, resource_id, changed_fields, metadata, occurred_at
    ) VALUES (
      located_organization_id,
      gen_random_uuid(),
      'user',
      requested_user_id,
      'membership.removed_for_account_deletion',
      'membership',
      requested_user_id,
      ARRAY['membership_user_id', 'role'],
      '{}'::jsonb,
      now()
    );
  END LOOP;
  PERFORM set_config('app.organization_id', '', true);
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA droneworks_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA droneworks_auth FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks.sync_membership_locator() FROM PUBLIC;
REVOKE ALL ON FUNCTION droneworks.prepare_auth_user_deletion(uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA droneworks_auth TO droneworks_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  droneworks_auth.users,
  droneworks_auth.sessions,
  droneworks_auth.accounts,
  droneworks_auth.verifications,
  droneworks_auth.auth_audit_events
TO droneworks_auth;

GRANT SELECT, INSERT, UPDATE, DELETE ON droneworks.invitations
TO droneworks_app;
GRANT EXECUTE ON FUNCTION droneworks.prepare_auth_user_deletion(uuid)
TO droneworks_app;
