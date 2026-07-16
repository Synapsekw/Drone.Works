ALTER TABLE droneworks.organizations
  ADD COLUMN default_timezone text NOT NULL DEFAULT 'UTC'
    CHECK (length(btrim(default_timezone)) > 0),
  ADD COLUMN unit_preference text NOT NULL DEFAULT 'metric'
    CHECK (unit_preference IN ('metric', 'imperial')),
  ADD COLUMN state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'pending_deletion')),
  ADD COLUMN deletion_requested_at timestamptz,
  ADD CONSTRAINT organizations_deletion_state_check
    CHECK ((state = 'pending_deletion') = (deletion_requested_at IS NOT NULL));

CREATE UNIQUE INDEX memberships_one_owner_idx
  ON droneworks.memberships (organization_id)
  WHERE role = 'owner';

ALTER TABLE droneworks.pilot_profiles
  DROP CONSTRAINT pilot_profiles_membership_fkey,
  ADD CONSTRAINT pilot_profiles_membership_fkey
    FOREIGN KEY (organization_id, membership_user_id)
    REFERENCES droneworks.memberships (organization_id, user_id)
    ON DELETE SET NULL (membership_user_id);
