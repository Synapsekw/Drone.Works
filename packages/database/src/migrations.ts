import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { ClientBase, QueryResultRow } from 'pg';

const migrationLockName = 'droneworks:reviewed-migrations';
const migratorRole = 'droneworks_migrator';

const coreCustomerTables = Object.freeze([
  'aircraft',
  'api_idempotency_requests',
  'audit_events',
  'canonical_flights',
  'flight_revisions',
  'import_attempts',
  'import_batches',
  'import_items',
  'memberships',
  'organizations',
  'outbox_events',
  'pilot_profiles',
  'raw_sources',
  'telemetry_objects',
]);

const keychainCustomerTables = Object.freeze(
  [
    ...coreCustomerTables,
    'keychain_authorizations',
    'keychain_cache_entries',
  ].sort(),
);

const customerTables = Object.freeze(
  [...keychainCustomerTables, 'aircraft_identifiers'].sort(),
);

const verifiedAuthCustomerTables = Object.freeze(
  [...customerTables, 'invitations'].sort(),
);

interface MigrationManifestEntry {
  readonly id: string;
  readonly sha256: string;
  readonly isolationSha256: string;
  readonly expectedTables: readonly string[];
  readonly url: URL;
}

export interface ReviewedMigration {
  readonly id: string;
  readonly sha256: string;
  readonly isolationSha256: string;
  readonly expectedTables: readonly string[];
  readonly sql: string;
}

export interface IsolationContractRow extends QueryResultRow {
  readonly table_name: string;
  readonly owner_name: string;
  readonly row_security: boolean;
  readonly force_row_security: boolean;
  readonly grants: readonly Record<string, unknown>[];
  readonly policies: readonly Record<string, unknown>[];
}

const manifest: readonly MigrationManifestEntry[] = Object.freeze([
  Object.freeze({
    id: '001_phase_1a_core',
    sha256: '1dcf6c21fe90aaffeeb723de5edf33578f3c62cfc7d698c0364cdb4694b937e2',
    isolationSha256:
      'e1821261adf6d56dc738196ad42f9fc3f6b11e7904bd2546d32005c706753801',
    expectedTables: coreCustomerTables,
    url: new URL('../sql/migrations/001_phase_1a_core.sql', import.meta.url),
  }),
  Object.freeze({
    id: '002_dji_keychain_boundary',
    sha256: 'c3ce1664ddee4066b59ef5e849da4bb3e050f3d5dee2664bf31fba816925489f',
    isolationSha256:
      'ea99e03a1cbe9f2f91e992e9295e7c33fa6103d5a04abe51fd171e00c8c83cc9',
    expectedTables: keychainCustomerTables,
    url: new URL(
      '../sql/migrations/002_dji_keychain_boundary.sql',
      import.meta.url,
    ),
  }),
  Object.freeze({
    id: '003_canonical_normalization',
    sha256: '507144a7b6e0c0a6660c50dcc618d0ed507d07640543881dfae391bc2b344ba7',
    isolationSha256:
      'a6b9627f5d6e6561d5e1155bd374e702a1b0fec8f7541066b377679d5cfdc9bd',
    expectedTables: customerTables,
    url: new URL(
      '../sql/migrations/003_canonical_normalization.sql',
      import.meta.url,
    ),
  }),
  Object.freeze({
    id: '004_verified_auth',
    sha256: '01955a4a59d24461e0b0f161094c9bb1a9140fc453027919f1d89d715ef922a0',
    isolationSha256:
      'fc65745bfc3c6e986754f1705cce5921d0916ca0e8bde1b47b8f81b1ff97f270',
    expectedTables: verifiedAuthCustomerTables,
    url: new URL('../sql/migrations/004_verified_auth.sql', import.meta.url),
  }),
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validateMigration(migration: ReviewedMigration): ReviewedMigration {
  if (!/^[a-z0-9][a-z0-9_]{0,127}$/.test(migration.id)) {
    throw new TypeError('Migration ID must be stable snake_case.');
  }
  const actualSha256 = sha256(migration.sql);
  if (actualSha256 !== migration.sha256) {
    throw new MigrationIntegrityError(
      migration.id,
      migration.sha256,
      actualSha256,
    );
  }
  return migration;
}

export class MigrationIntegrityError extends Error {
  readonly migrationId: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(
    migrationId: string,
    expectedSha256: string,
    actualSha256: string,
  ) {
    super(`Reviewed migration ${migrationId} does not match its checksum.`);
    this.name = 'MigrationIntegrityError';
    this.migrationId = migrationId;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export class MigrationConflictError extends Error {
  readonly migrationId: string;

  constructor(migrationId: string) {
    super(`Migration ${migrationId} is recorded with a different contract.`);
    this.name = 'MigrationConflictError';
    this.migrationId = migrationId;
  }
}

export class IsolationContractError extends Error {
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(expectedSha256: string, actualSha256: string, detail: string) {
    super(`Customer isolation contract changed: ${detail}`);
    this.name = 'IsolationContractError';
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export async function loadReviewedMigrations(): Promise<
  readonly ReviewedMigration[]
> {
  return Promise.all(
    manifest.map(async (entry) =>
      Object.freeze(
        validateMigration({
          id: entry.id,
          sha256: entry.sha256,
          isolationSha256: entry.isolationSha256,
          expectedTables: entry.expectedTables,
          sql: await readFile(entry.url, 'utf8'),
        }),
      ),
    ),
  );
}

export async function readCustomerIsolationContract(
  client: Pick<ClientBase, 'query'>,
): Promise<readonly IsolationContractRow[]> {
  const result = await client.query<IsolationContractRow>(`
    SELECT relation.relname AS table_name,
           owner.rolname AS owner_name,
           relation.relrowsecurity AS row_security,
           relation.relforcerowsecurity AS force_row_security,
           coalesce(
             (
               SELECT jsonb_agg(
                        jsonb_build_object(
                          'grantee', CASE
                            WHEN acl.grantee = 0 THEN 'PUBLIC'
                            ELSE pg_get_userbyid(acl.grantee)
                          END,
                          'grantor', pg_get_userbyid(acl.grantor),
                          'privilege', acl.privilege_type,
                          'grantable', acl.is_grantable
                        )
                        ORDER BY acl.grantee, acl.privilege_type
                      )
                 FROM aclexplode(
                        coalesce(
                          relation.relacl,
                          acldefault('r', relation.relowner)
                        )
                      ) AS acl
             ),
             '[]'::jsonb
           ) AS grants,
           coalesce(
             (
               SELECT jsonb_agg(
                        jsonb_build_object(
                          'name', policy.polname,
                          'command', policy.polcmd,
                          'permissive', policy.polpermissive,
                          'roles', (
                            SELECT jsonb_agg(
                                     CASE
                                       WHEN role_id = 0 THEN 'PUBLIC'
                                       ELSE pg_get_userbyid(role_id)
                                     END
                                     ORDER BY role_id
                                   )
                              FROM unnest(policy.polroles) AS role_id
                          ),
                          'using', pg_get_expr(
                            policy.polqual,
                            policy.polrelid
                          ),
                          'check', pg_get_expr(
                            policy.polwithcheck,
                            policy.polrelid
                          )
                        )
                        ORDER BY policy.polname
                      )
                 FROM pg_policy AS policy
                WHERE policy.polrelid = relation.oid
             ),
             '[]'::jsonb
           ) AS policies
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles AS owner ON owner.oid = relation.relowner
     WHERE namespace.nspname = 'droneworks'
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  `);
  return result.rows;
}

export function isolationContractSha256(
  contract: readonly IsolationContractRow[],
): string {
  return sha256(JSON.stringify(contract));
}

export async function verifyIsolationContract(
  client: Pick<ClientBase, 'query'>,
  migration: ReviewedMigration,
): Promise<string> {
  const contract = await readCustomerIsolationContract(client);
  const actualTables = contract.map((row) => row.table_name);
  const expectedTables = [...migration.expectedTables].sort();
  const actualSha256 = isolationContractSha256(contract);

  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new IsolationContractError(
      migration.isolationSha256,
      actualSha256,
      'the customer table set is not the reviewed set',
    );
  }

  for (const table of contract) {
    if (
      table.owner_name !== migratorRole ||
      !table.row_security ||
      !table.force_row_security ||
      table.policies.length !== 1
    ) {
      throw new IsolationContractError(
        migration.isolationSha256,
        actualSha256,
        `${table.table_name} is not migrator-owned with one forced-RLS policy`,
      );
    }
  }

  if (actualSha256 !== migration.isolationSha256) {
    throw new IsolationContractError(
      migration.isolationSha256,
      actualSha256,
      'the deterministic digest does not match',
    );
  }
  return actualSha256;
}

export interface MigrationResult {
  readonly status: 'applied' | 'already_applied';
  readonly migrationId: string;
  readonly sha256: string;
  readonly isolationSha256: string;
}

export async function applyReviewedMigration(
  client: Pick<ClientBase, 'query'>,
  migration: ReviewedMigration,
  appliedAt = new Date(),
  verifyRecordedContract = true,
): Promise<MigrationResult> {
  const reviewed = validateMigration(migration);
  if (Number.isNaN(appliedAt.valueOf())) {
    throw new TypeError('Migration appliedAt must be a valid Date.');
  }

  await client.query('BEGIN');
  try {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [migrationLockName],
    );
    const previous = await client.query<
      QueryResultRow & { sha256: string; isolation_sha256: string }
    >(
      `SELECT sha256, isolation_sha256
         FROM droneworks_ops.find_migration($1)`,
      [reviewed.id],
    );

    if (previous.rowCount === 1) {
      const recorded = previous.rows[0];
      if (
        recorded?.sha256 !== reviewed.sha256 ||
        recorded.isolation_sha256 !== reviewed.isolationSha256
      ) {
        throw new MigrationConflictError(reviewed.id);
      }
      if (verifyRecordedContract) {
        await verifyIsolationContract(client, reviewed);
      }
      await client.query('COMMIT');
      return {
        status: 'already_applied',
        migrationId: reviewed.id,
        sha256: reviewed.sha256,
        isolationSha256: reviewed.isolationSha256,
      };
    }

    await client.query(`SET LOCAL ROLE ${migratorRole}`);
    await client.query(reviewed.sql);
    const identity = await client.query<
      QueryResultRow & { current_user: string; session_user: string }
    >('SELECT current_user, session_user');
    if (
      identity.rows[0]?.current_user !== migratorRole ||
      identity.rows[0].session_user !== 'droneworks_migration_runner'
    ) {
      throw new Error('Reviewed migration role identity changed unexpectedly.');
    }
    await client.query('RESET ROLE');
    const isolationSha256 = await verifyIsolationContract(client, reviewed);
    await client.query(
      'SELECT droneworks_ops.record_migration($1, $2, $3, $4)',
      [reviewed.id, reviewed.sha256, isolationSha256, appliedAt.toISOString()],
    );
    await client.query('COMMIT');
    return {
      status: 'applied',
      migrationId: reviewed.id,
      sha256: reviewed.sha256,
      isolationSha256,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function applyReviewedMigrations(
  client: Pick<ClientBase, 'query'>,
  appliedAt = new Date(),
): Promise<readonly MigrationResult[]> {
  const migrations = await loadReviewedMigrations();
  const results: MigrationResult[] = [];
  for (const migration of migrations) {
    results.push(
      await applyReviewedMigration(client, migration, appliedAt, false),
    );
  }
  const latest = migrations.at(-1);
  if (latest) await verifyIsolationContract(client, latest);
  return results;
}
