import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const MIGRATION_LOCK_NAME = "droneworks:reviewed-migrations";
const MIGRATOR_ROLE = "droneworks_migrator";
const REVIEWED_MIGRATIONS = Object.freeze([
  Object.freeze({
    id: "002_audit_event_resource_index",
    sha256: "fb500ee71794b8c0fd9f7a0746396275b6c070b29f49b22921300ea80dcbaef5",
    isolationContract: "preserve",
    url: new URL(
      "../sql/migrations/002_audit_event_resource_index.sql",
      import.meta.url,
    ),
  }),
  Object.freeze({
    id: "003_organization_administration",
    sha256: "38b8dc1212c55b98a019331df940a751674f1600372376c12149c31cbe86feaf",
    isolationContract: "preserve",
    url: new URL(
      "../sql/migrations/003_organization_administration.sql",
      import.meta.url,
    ),
  }),
  Object.freeze({
    id: "004_remaining_resources",
    sha256: "f4bd578249dea0e8d9b9035191350d224e8c60238437241f2e7c358df487ca90",
    isolationContract: "expand",
    addedTables: Object.freeze([
      "batteries",
      "flight_batteries",
      "flight_tags",
      "import_batches",
      "import_items",
      "tags",
    ]),
    url: new URL(
      "../sql/migrations/004_remaining_resources.sql",
      import.meta.url,
    ),
  }),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireMigration(migration) {
  if (migration === null || typeof migration !== "object") {
    throw new TypeError("migration must be an object");
  }
  if (typeof migration.id !== "string"
      || !/^[a-z0-9][a-z0-9_]{0,127}$/.test(migration.id)) {
    throw new TypeError("migration.id must be a stable snake-case identifier");
  }
  if (typeof migration.sql !== "string" || migration.sql.trim().length === 0) {
    throw new TypeError("migration.sql must be non-empty");
  }
  if (typeof migration.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(migration.sha256)) {
    throw new TypeError("migration.sha256 must be a lowercase SHA-256 digest");
  }
  const actualSha256 = sha256(migration.sql);
  if (actualSha256 !== migration.sha256) {
    throw new MigrationIntegrityError(migration.id, migration.sha256, actualSha256);
  }
  return migration;
}

export class MigrationIntegrityError extends Error {
  constructor(migrationId, expectedSha256, actualSha256) {
    super(`reviewed migration ${migrationId} does not match its pinned checksum`);
    this.name = "MigrationIntegrityError";
    this.migrationId = migrationId;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export class MigrationConflictError extends Error {
  constructor(migrationId) {
    super(`migration ${migrationId} was already recorded with another checksum`);
    this.name = "MigrationConflictError";
    this.migrationId = migrationId;
  }
}

export async function loadReviewedMigrations() {
  return Promise.all(REVIEWED_MIGRATIONS.map(async (migration) => {
    const sql = await readFile(migration.url, "utf8");
    return Object.freeze(requireMigration({
      id: migration.id,
      sha256: migration.sha256,
      sql,
      isolationContract: migration.isolationContract,
      addedTables: migration.addedTables ?? Object.freeze([]),
    }));
  }));
}

export async function readCustomerIsolationContract(client) {
  const result = await client.query(
    `SELECT c.relname,
            owner.rolname AS owner,
            c.relrowsecurity,
            c.relforcerowsecurity,
            c.relacl::text AS grants,
            coalesce(
              (
                SELECT jsonb_agg(
                         jsonb_build_object(
                           'name', policy.polname,
                           'command', policy.polcmd,
                           'roles', policy.polroles,
                           'using', pg_get_expr(policy.polqual, policy.polrelid),
                           'check', pg_get_expr(policy.polwithcheck, policy.polrelid)
                         )
                         ORDER BY policy.polname
                       )
                  FROM pg_policy AS policy
                 WHERE policy.polrelid = c.oid
              ),
              '[]'::jsonb
            ) AS policies
       FROM pg_class AS c
       JOIN pg_namespace AS namespace ON namespace.oid = c.relnamespace
       JOIN pg_roles AS owner ON owner.oid = c.relowner
      WHERE namespace.nspname = 'droneworks'
        AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  return result.rows;
}

export function isolationContractSha256(contract) {
  if (!Array.isArray(contract)) {
    throw new TypeError("contract must be an array");
  }
  return sha256(JSON.stringify(contract));
}

export async function applyReviewedMigration(client, migration, options = {}) {
  if (client === null || typeof client?.query !== "function") {
    throw new TypeError("client.query must be a function");
  }
  const reviewed = requireMigration(migration);
  const appliedAt = options.appliedAt ?? new Date();
  if (!(appliedAt instanceof Date) || Number.isNaN(appliedAt.valueOf())) {
    throw new TypeError("appliedAt must be a valid Date");
  }

  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [MIGRATION_LOCK_NAME],
    );
    const previous = await client.query(
      `SELECT migration_id, sha256
         FROM droneworks_ops.find_migration($1)`,
      [reviewed.id],
    );
    if (previous.rowCount > 0) {
      if (previous.rows[0].sha256 !== reviewed.sha256) {
        throw new MigrationConflictError(reviewed.id);
      }
      await client.query("COMMIT");
      return Object.freeze({
        status: "already_applied",
        migrationId: reviewed.id,
        sha256: reviewed.sha256,
      });
    }

    await client.query(`SET LOCAL ROLE ${MIGRATOR_ROLE}`);
    await client.query(reviewed.sql);
    const elevatedIdentity = await client.query(
      "SELECT current_user, session_user",
    );
    if (elevatedIdentity.rows[0].current_user !== MIGRATOR_ROLE
        || elevatedIdentity.rows[0].session_user !== "droneworks_migration_runner") {
      throw new Error("migration role identity changed while applying reviewed SQL");
    }
    await client.query("RESET ROLE");
    await client.query(
      "SELECT droneworks_ops.record_migration($1, $2, $3)",
      [reviewed.id, reviewed.sha256, appliedAt.toISOString()],
    );
    await client.query("COMMIT");
    return Object.freeze({
      status: "applied",
      migrationId: reviewed.id,
      sha256: reviewed.sha256,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
