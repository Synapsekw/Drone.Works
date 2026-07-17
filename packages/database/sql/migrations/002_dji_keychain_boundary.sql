CREATE TABLE droneworks.keychain_authorizations (
  organization_id uuid NOT NULL,
  raw_source_id uuid NOT NULL,
  keychain_use_authorized boolean NOT NULL DEFAULT false,
  external_service_processing_authorized boolean NOT NULL DEFAULT false,
  notice_version text NOT NULL
    CHECK (notice_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  terms_version text NOT NULL
    CHECK (terms_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  approved_by_user_id uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (organization_id, raw_source_id),
  CHECK (revoked_at IS NULL OR revoked_at >= approved_at),
  CHECK (
    revoked_at IS NULL
    OR (
      NOT keychain_use_authorized
      AND NOT external_service_processing_authorized
    )
  ),
  FOREIGN KEY (organization_id, raw_source_id)
    REFERENCES droneworks.raw_sources (organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE droneworks.keychain_cache_entries (
  organization_id uuid NOT NULL,
  raw_source_id uuid NOT NULL,
  parser_id text NOT NULL
    CHECK (parser_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  log_version integer NOT NULL CHECK (log_version BETWEEN 13 AND 255),
  provider_id text NOT NULL
    CHECK (provider_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  notice_version text NOT NULL
    CHECK (notice_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  terms_version text NOT NULL
    CHECK (terms_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  key_reference text NOT NULL
    CHECK (key_reference ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  key_version text NOT NULL
    CHECK (key_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$'),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  authentication_tag bytea NOT NULL
    CHECK (octet_length(authentication_tag) = 16),
  ciphertext bytea NOT NULL
    CHECK (octet_length(ciphertext) BETWEEN 1 AND 262144),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, raw_source_id, parser_id, log_version),
  CHECK (last_used_at >= created_at),
  FOREIGN KEY (organization_id, raw_source_id)
    REFERENCES droneworks.raw_sources (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, raw_source_id)
    REFERENCES droneworks.keychain_authorizations (
      organization_id,
      raw_source_id
    )
    ON DELETE CASCADE
);

ALTER TABLE droneworks.keychain_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.keychain_authorizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.keychain_authorizations
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

ALTER TABLE droneworks.keychain_cache_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE droneworks.keychain_cache_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON droneworks.keychain_cache_entries
  USING (organization_id = droneworks.current_organization_id())
  WITH CHECK (organization_id = droneworks.current_organization_id());

REVOKE ALL ON
  droneworks.keychain_authorizations,
  droneworks.keychain_cache_entries
FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  droneworks.keychain_authorizations,
  droneworks.keychain_cache_entries
TO droneworks_app;
