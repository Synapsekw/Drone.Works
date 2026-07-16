import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { API_PREFIX, createApiServer } from "../src/api.mjs";
import {
  DownloadAuthorizationError,
  MAX_DOWNLOAD_TTL_MS,
  deriveObjectKey,
  issueAuthorizedDownload,
} from "../src/downloads.mjs";
import {
  FLIGHT_REFRESH_QUEUE,
  enqueueFlightRefresh,
  processNextFlightRefresh,
} from "../src/jobs.mjs";
import {
  applyReviewedMigration,
  isolationContractSha256,
  loadReviewedMigrations,
  MigrationConflictError,
  MigrationIntegrityError,
  readCustomerIsolationContract,
} from "../src/migrations.mjs";
import {
  loadFlightForJob,
  withOrganization,
} from "../src/repositories.mjs";

const { Client, Pool } = pg;

const applicationPool = new Pool({ max: 1 });
const bootstrapPool = new Pool({
  max: 1,
  user: process.env.DRONEWORKS_PG_BOOTSTRAP_USER,
});
const migrationPool = new Pool({
  max: 1,
  user: process.env.DRONEWORKS_PG_MIGRATION_USER,
  application_name: "droneworks-reviewed-migration",
});
const queueAccessPool = new Pool({
  max: 1,
  user: process.env.DRONEWORKS_PG_QUEUE_USER,
});
const queueBoss = new PgBoss({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.DRONEWORKS_PG_QUEUE_USER,
  schema: process.env.DRONEWORKS_PG_QUEUE_SCHEMA,
  application_name: "droneworks-queue-proof",
  createSchema: false,
  schedule: false,
  supervise: false,
});

const fixedNow = new Date("2026-07-15T12:00:00Z");

function recordingSigner() {
  const calls = [];
  const issued = new Map();
  return {
    calls,
    async issue(input) {
      calls.push(input);
      const url = `https://download.invalid/token-${calls.length}`;
      issued.set(url, input.expiresAt);
      return { url };
    },
    verify(url, now) {
      const expiresAt = issued.get(url);
      return expiresAt instanceof Date && expiresAt > now;
    },
  };
}

function isHiddenDownloadDenial(error) {
  return error instanceof DownloadAuthorizationError
    && error.code === "download_not_found"
    && error.status === 404
    && error.message === "Download is not available";
}

const apiSigner = recordingSigner();
const sessions = new Map([
  ["session-alpha-owner", "user-alpha-owner"],
  ["session-alpha-admin", "user-alpha"],
  ["session-alpha-pilot", "user-alpha-pilot"],
  ["session-alpha-other-pilot", "user-alpha-other-pilot"],
  ["session-alpha-viewer", "user-alpha-viewer"],
  ["session-alpha-new-member", "user-alpha-new-member"],
  ["session-beta-owner", "user-beta-owner"],
  ["session-beta-admin", "user-beta"],
  ["session-beta-pilot", "user-beta-pilot"],
  ["session-beta-viewer", "user-beta-viewer"],
]);
const hiddenResourceProblem = Object.freeze({
  type: "about:blank",
  title: "Not Found",
  status: 404,
  detail: "Resource is not available",
});
const createdResourceSequences = new Map();
const apiServer = createApiServer({
  pool: applicationPool,
  signer: apiSigner,
  now: () => new Date(fixedNow),
  createId(kind) {
    const sequence = (createdResourceSequences.get(kind) ?? 0) + 1;
    createdResourceSequences.set(kind, sequence);
    return `${kind}-${sequence}`;
  },
  authenticate(request) {
    const authorization = request.headers.authorization;
    const session = typeof authorization === "string"
      ? authorization.match(/^Bearer (.+)$/)?.[1]
      : undefined;
    const userId = sessions.get(session);
    return userId === undefined ? null : { userId };
  },
});
let apiOrigin;

async function apiRequest(path, session, options = {}) {
  const headers = new Headers(options.headers);
  if (session !== null) {
    headers.set("authorization", `Bearer ${session}`);
  }
  const response = await fetch(`${apiOrigin}${path}`, {
    ...options,
    headers,
  });
  const responseText = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: responseText.length === 0 ? null : JSON.parse(responseText),
  };
}

async function assertOrganizationSqlRejects(organizationId, sql, predicate) {
  const client = await applicationPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.organization_id', $1, true)",
      [organizationId],
    );
    await assert.rejects(client.query(sql), predicate);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

before(async () => {
  queueBoss.on("error", () => {});
  await queueBoss.start();
  await queueBoss.createQueue(FLIGHT_REFRESH_QUEUE, {
    retryLimit: 1,
    retryDelay: 0,
    deleteAfterSeconds: 3600,
  });
  await new Promise((resolve, reject) => {
    apiServer.once("error", reject);
    apiServer.listen(0, "127.0.0.1", resolve);
  });
  const address = apiServer.address();
  apiOrigin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    apiServer.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await queueBoss.stop({ graceful: false });
  await applicationPool.end();
  await bootstrapPool.end();
  await migrationPool.end();
  await queueAccessPool.end();
});

test("ordinary connections are non-owner, non-superuser, and unable to bypass RLS", async () => {
  const roleResult = await applicationPool.query(
    `SELECT current_user,
            rolsuper,
            rolcreaterole,
            rolcreatedb,
            rolcanlogin,
            rolbypassrls,
            pg_has_role(current_user, 'droneworks_migrator', 'MEMBER') AS owns_migrator
       FROM pg_roles
      WHERE rolname = current_user`,
  );
  assert.deepEqual(roleResult.rows[0], {
    current_user: "droneworks_app",
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolbypassrls: false,
    owns_migrator: false,
  });

  const tables = await applicationPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, r.rolname AS owner
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       JOIN pg_roles AS r ON r.oid = c.relowner
      WHERE n.nspname = 'droneworks'
        AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  assert.equal(tables.rowCount, 20);
  for (const table of tables.rows) {
    assert.equal(table.owner, "droneworks_migrator");
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.relforcerowsecurity, true);
  }
});

test("reviewed migrations use narrow explicit elevation and an independent audit ledger", async () => {
  const roles = await bootstrapPool.query(
    `SELECT rolname,
            rolsuper,
            rolcreaterole,
            rolcreatedb,
            rolcanlogin,
            rolinherit,
            rolbypassrls
       FROM pg_roles
      WHERE rolname IN (
        'droneworks_migrator',
        'droneworks_migration_auditor',
        'droneworks_migration_runner'
      )
      ORDER BY rolname`,
  );
  assert.deepEqual(roles.rows, [{
    rolname: "droneworks_migration_auditor",
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: false,
    rolinherit: false,
    rolbypassrls: false,
  }, {
    rolname: "droneworks_migration_runner",
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolinherit: false,
    rolbypassrls: false,
  }, {
    rolname: "droneworks_migrator",
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: false,
    rolinherit: false,
    rolbypassrls: false,
  }]);

  const memberships = await bootstrapPool.query(
    `SELECT member.rolname AS member,
            granted.rolname AS granted_role,
            membership.inherit_option,
            membership.set_option
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS granted ON granted.oid = membership.roleid
      WHERE granted.rolname IN (
        'droneworks_migrator',
        'droneworks_migration_auditor'
      )
      ORDER BY member.rolname, granted.rolname`,
  );
  assert.deepEqual(memberships.rows, [{
    member: "droneworks_migration_runner",
    granted_role: "droneworks_migrator",
    inherit_option: false,
    set_option: true,
  }]);

  for (const ordinaryPool of [applicationPool, queueAccessPool]) {
    await assert.rejects(
      ordinaryPool.query("SET ROLE droneworks_migrator"),
      (error) => error.code === "42501",
    );
  }
  await assert.rejects(
    migrationPool.query("SELECT count(*) FROM droneworks.canonical_flights"),
    (error) => error.code === "42501",
  );
  await assert.rejects(
    migrationPool.query("SET ROLE droneworks_migration_auditor"),
    (error) => error.code === "42501",
  );
  await assert.rejects(
    applicationPool.query(
      "SELECT * FROM droneworks_ops.find_migration('002_audit_event_resource_index')",
    ),
    (error) => error.code === "42501",
  );

  const noLoginOwner = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: "droneworks_migrator",
  });
  await assert.rejects(
    noLoginOwner.connect(),
    /role "droneworks_migrator" is not permitted to log in/,
  );

  const reviewedMigrations = await loadReviewedMigrations();
  const [reviewedMigration] = reviewedMigrations;
  assert.equal(reviewedMigration.id, process.env.DRONEWORKS_PG_REVIEWED_MIGRATION_ID);
  assert.equal(
    reviewedMigration.sha256,
    process.env.DRONEWORKS_PG_REVIEWED_MIGRATION_SHA256,
  );
  const replayClient = await migrationPool.connect();
  try {
    for (const migration of reviewedMigrations) {
      const replay = await applyReviewedMigration(
        replayClient,
        migration,
        { appliedAt: new Date("2026-07-16T00:01:00Z") },
      );
      assert.deepEqual(replay, {
        status: "already_applied",
        migrationId: migration.id,
        sha256: migration.sha256,
      });
    }

    await assert.rejects(
      applyReviewedMigration(replayClient, {
        ...reviewedMigration,
        sql: `${reviewedMigration.sql}\n-- unreviewed change\n`,
      }),
      MigrationIntegrityError,
    );
    const conflictingSql = `${reviewedMigration.sql}\n-- separately reviewed replacement\n`;
    await assert.rejects(
      applyReviewedMigration(replayClient, {
        id: reviewedMigration.id,
        sql: conflictingSql,
        sha256: createHash("sha256").update(conflictingSql).digest("hex"),
      }),
      MigrationConflictError,
    );
  } finally {
    replayClient.release();
  }

  const ledger = [];
  for (const migration of reviewedMigrations) {
    const result = await migrationPool.query(
      `SELECT migration_id,
              sha256,
              applied_at,
              applied_by,
              application_name
         FROM droneworks_ops.find_migration($1)`,
      [migration.id],
    );
    ledger.push(...result.rows);
  }
  assert.deepEqual(ledger.map((row) => ({
    ...row,
    applied_at: row.applied_at.toISOString(),
  })), reviewedMigrations.map((migration) => ({
    migration_id: migration.id,
    sha256: migration.sha256,
    applied_at: "2026-07-16T00:00:00.000Z",
    applied_by: "droneworks_migration_runner",
    application_name: "droneworks-reviewed-migration",
  })));

  const operationalBoundary = await bootstrapPool.query(
    `SELECT table_owner.rolname AS ledger_owner,
            has_table_privilege(
              'droneworks_migration_runner',
              'droneworks_ops.migration_runs',
              'SELECT,INSERT,UPDATE,DELETE'
            ) AS runner_reads_or_writes_ledger,
            has_table_privilege(
              'droneworks_migrator',
              'droneworks_ops.migration_runs',
              'SELECT,INSERT,UPDATE,DELETE'
            ) AS migrator_reads_or_writes_ledger,
            has_function_privilege(
              'droneworks_migration_runner',
              'droneworks_ops.find_migration(text)',
              'EXECUTE'
            ) AS runner_executes_ledger_reader
       FROM pg_class AS ledger
       JOIN pg_namespace AS namespace ON namespace.oid = ledger.relnamespace
       JOIN pg_roles AS table_owner ON table_owner.oid = ledger.relowner
      WHERE namespace.nspname = 'droneworks_ops'
        AND ledger.relname = 'migration_runs'`,
  );
  assert.deepEqual(operationalBoundary.rows[0], {
    ledger_owner: "droneworks_migration_auditor",
    runner_reads_or_writes_ledger: false,
    migrator_reads_or_writes_ledger: false,
    runner_executes_ledger_reader: true,
  });

  const index = await bootstrapPool.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'droneworks'
        AND indexname = 'audit_events_resource_occurred_idx'`,
  );
  assert.deepEqual(index.rows, [{
    indexname: "audit_events_resource_occurred_idx",
  }]);
  const finalContract = await readCustomerIsolationContract(bootstrapPool);
  assert.equal(
    isolationContractSha256(finalContract),
    process.env.DRONEWORKS_PG_ISOLATION_CONTRACT_SHA256,
  );
});

test("queue ownership is limited to infrastructure and cannot read customer tables", async () => {
  const roleResult = await bootstrapPool.query(
    `SELECT rolsuper,
            rolcreaterole,
            rolcreatedb,
            rolcanlogin,
            rolbypassrls,
            has_schema_privilege('droneworks_queue', 'droneworks_jobs', 'USAGE') AS owns_queue_schema,
            has_table_privilege('droneworks_queue', 'droneworks.canonical_flights', 'SELECT') AS reads_customer_flights,
            has_schema_privilege('droneworks_app', 'droneworks_jobs', 'USAGE') AS app_reads_queue_schema
       FROM pg_roles
      WHERE rolname = 'droneworks_queue'`,
  );
  assert.deepEqual(roleResult.rows[0], {
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolbypassrls: false,
    owns_queue_schema: true,
    reads_customer_flights: false,
    app_reads_queue_schema: false,
  });
});

test("missing organization context fails closed for reads and writes", async () => {
  const flights = await applicationPool.query(
    "SELECT id FROM droneworks.canonical_flights",
  );
  assert.deepEqual(flights.rows, []);
  const artifacts = await applicationPool.query(
    `SELECT id FROM droneworks.raw_sources
     UNION ALL
     SELECT id FROM droneworks.export_artifacts`,
  );
  assert.deepEqual(artifacts.rows, []);

  await assert.rejects(
    applicationPool.query(
      "INSERT INTO droneworks.aircraft (organization_id, id, display_name) VALUES ('org-alpha', 'aircraft-missing-context', 'Denied')",
    ),
    (error) => error.code === "42501" && /row-level security policy/.test(error.message),
  );
});

test("authorized raw-source and export downloads derive short-lived organization keys", async () => {
  const signer = recordingSigner();
  const rawDownload = await issueAuthorizedDownload(applicationPool, {
    organizationId: "org-alpha",
    userId: "user-alpha",
    resourceType: "raw_source",
    resourceId: "raw-alpha",
  }, signer, { now: fixedNow });
  const exportDownload = await issueAuthorizedDownload(applicationPool, {
    organizationId: "org-beta",
    userId: "user-beta",
    resourceType: "export",
    resourceId: "export-beta",
  }, signer, { now: fixedNow, ttlMs: 60_000 });

  assert.deepEqual(rawDownload, {
    url: "https://download.invalid/token-1",
    expiresAt: "2026-07-15T12:05:00.000Z",
  });
  assert.deepEqual(exportDownload, {
    url: "https://download.invalid/token-2",
    expiresAt: "2026-07-15T12:01:00.000Z",
  });
  assert.deepEqual(signer.calls, [{
    objectKey: "organizations/org-alpha/raw-sources/raw-alpha/revisions/raw-revision-alpha",
    expiresAt: new Date("2026-07-15T12:05:00.000Z"),
  }, {
    objectKey: "organizations/org-beta/exports/export-beta/artifact-beta",
    expiresAt: new Date("2026-07-15T12:01:00.000Z"),
  }]);
  assert.equal(Object.hasOwn(rawDownload, "objectKey"), false);
});

test("cross-organization, viewer, deleted, and expired download denials are indistinguishable", async () => {
  const signer = recordingSigner();
  const deniedInputs = [{
    organizationId: "org-beta",
    userId: "user-beta",
    resourceType: "raw_source",
    resourceId: "raw-alpha",
  }, {
    organizationId: "org-alpha",
    userId: "user-alpha-viewer",
    resourceType: "raw_source",
    resourceId: "raw-alpha",
  }, {
    organizationId: "org-alpha",
    userId: "user-alpha",
    resourceType: "raw_source",
    resourceId: "raw-alpha-deleted",
  }, {
    organizationId: "org-alpha",
    userId: "user-alpha",
    resourceType: "export",
    resourceId: "export-alpha-expired",
  }, {
    organizationId: "org-alpha",
    userId: "user-alpha",
    resourceType: "export",
    resourceId: "export-does-not-exist",
  }];

  for (const input of deniedInputs) {
    await assert.rejects(
      issueAuthorizedDownload(applicationPool, input, signer, { now: fixedNow }),
      isHiddenDownloadDenial,
    );
  }
  assert.deepEqual(signer.calls, []);
});

test("membership revocation prevents refreshing a previously authorized download", async () => {
  const signer = recordingSigner();
  const previous = await issueAuthorizedDownload(applicationPool, {
    organizationId: "org-alpha",
    userId: "user-alpha-former",
    resourceType: "export",
    resourceId: "export-alpha",
  }, signer, { now: fixedNow, ttlMs: 1_000 });
  assert.equal(previous.expiresAt, "2026-07-15T12:00:01.000Z");
  assert.equal(signer.verify(previous.url, new Date("2026-07-15T12:00:00.500Z")), true);

  const revoked = await withOrganization(
    applicationPool,
    "org-alpha",
    (repositories) => repositories.revokeMembership("user-alpha-former"),
  );
  assert.deepEqual(revoked, {
    organization_id: "org-alpha",
    user_id: "user-alpha-former",
  });

  await assert.rejects(
    issueAuthorizedDownload(applicationPool, {
      organizationId: "org-alpha",
      userId: "user-alpha-former",
      resourceType: "export",
      resourceId: "export-alpha",
    }, signer, { now: new Date("2026-07-15T12:00:02Z") }),
    isHiddenDownloadDenial,
  );
  assert.equal(signer.verify(previous.url, new Date("2026-07-15T12:00:02Z")), false);
  assert.equal(signer.calls.length, 1);
});

test("object keys cannot be client supplied and every segment is escaped", async () => {
  const signer = recordingSigner();
  await assert.rejects(
    issueAuthorizedDownload(applicationPool, {
      organizationId: "org-alpha",
      userId: "user-alpha",
      resourceType: "raw_source",
      resourceId: "raw-alpha",
      objectKey: "organizations/org-beta/raw-sources/raw-beta",
    }, signer, { now: fixedNow }),
    /objectKey is derived from an authorized resource/,
  );
  await assert.rejects(
    issueAuthorizedDownload(applicationPool, {
      organizationId: "org-alpha",
      userId: "user-alpha",
      resourceType: "raw_source",
      resourceId: "raw-alpha",
    }, signer, { now: fixedNow, ttlMs: MAX_DOWNLOAD_TTL_MS + 1 }),
    /ttlMs must be between/,
  );
  assert.equal(deriveObjectKey("raw_source", {
    organization_id: "org/alpha",
    resource_id: "raw/../beta",
    object_component: "revision?1",
  }), "organizations/org%2Falpha/raw-sources/raw%2F..%2Fbeta/revisions/revision%3F1");
  assert.deepEqual(signer.calls, []);
});

test("versioned flight API permits every member role and hides cross-organization IDs", async () => {
  for (const session of [
    "session-alpha-owner",
    "session-alpha-admin",
    "session-alpha-pilot",
    "session-alpha-viewer",
  ]) {
    const response = await apiRequest(
      "/api/v1/organizations/org-alpha/flights/flight-alpha",
      session,
    );
    assert.equal(response.status, 200);
    assert.match(response.contentType, /^application\/json/);
    assert.deepEqual(response.body, {
      data: {
        id: "flight-alpha",
        organization_id: "org-alpha",
        aircraft_id: "aircraft-alpha",
        pilot_profile_id: "pilot-alpha",
        duration_ms: "3600000",
        notes: "alpha-only",
      },
    });
  }
  const pilotViewingAnotherPilot = await apiRequest(
    "/api/v1/organizations/org-alpha/flights/flight-alpha-other",
    "session-alpha-pilot",
  );
  assert.equal(pilotViewingAnotherPilot.status, 200);
  assert.equal(pilotViewingAnotherPilot.body.data.id, "flight-alpha-other");

  const hiddenRequests = [{
    path: "/api/v1/organizations/org-alpha/flights/flight-alpha",
    session: "session-beta-admin",
  }, {
    path: "/api/v1/organizations/org-beta/flights/flight-alpha",
    session: "session-beta-admin",
  }, {
    path: "/api/v1/organizations/org-alpha/flights/flight-beta",
    session: "session-alpha-admin",
  }, {
    path: "/api/v1/organizations/org-alpha/flights/flight-unknown",
    session: "session-alpha-admin",
  }];
  for (const input of hiddenRequests) {
    const response = await apiRequest(input.path, input.session);
    assert.equal(response.status, 404);
    assert.match(response.contentType, /^application\/problem\+json/);
    assert.deepEqual(response.body, hiddenResourceProblem);
  }

  const unauthenticated = await apiRequest(
    "/api/v1/organizations/org-alpha/flights/flight-alpha",
    null,
  );
  assert.deepEqual(unauthenticated.body, {
    type: "about:blank",
    title: "Unauthorized",
    status: 401,
    detail: "Authentication is required",
  });
});

test("versioned download API enforces owner, admin, viewer, and pilot-own-flight scope", async () => {
  const callsBefore = apiSigner.calls.length;
  const authorizedRequests = [{
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-alpha-other/downloads",
    session: "session-alpha-owner",
  }, {
    path: "/api/v1/organizations/org-alpha/exports/export-alpha-other/downloads",
    session: "session-alpha-owner",
  }, {
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-alpha-shared/downloads",
    session: "session-alpha-admin",
  }, {
    path: "/api/v1/organizations/org-alpha/exports/export-alpha-shared/downloads",
    session: "session-alpha-admin",
  }, {
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-alpha/downloads",
    session: "session-alpha-pilot",
  }, {
    path: "/api/v1/organizations/org-alpha/exports/export-alpha/downloads",
    session: "session-alpha-pilot",
  }];
  for (const input of authorizedRequests) {
    const response = await apiRequest(input.path, input.session, { method: "POST" });
    assert.equal(response.status, 200);
    assert.match(response.contentType, /^application\/json/);
    assert.equal(typeof response.body.data.url, "string");
    assert.equal(response.body.data.expires_at, "2026-07-15T12:05:00.000Z");
    assert.equal(Object.hasOwn(response.body.data, "object_key"), false);
  }
  assert.deepEqual(
    apiSigner.calls.slice(callsBefore).map((call) => call.objectKey),
    [
      "organizations/org-alpha/raw-sources/raw-alpha-other/revisions/raw-revision-alpha-other",
      "organizations/org-alpha/exports/export-alpha-other/artifact-alpha-other",
      "organizations/org-alpha/raw-sources/raw-alpha-shared/revisions/raw-revision-alpha-shared",
      "organizations/org-alpha/exports/export-alpha-shared/artifact-alpha-shared",
      "organizations/org-alpha/raw-sources/raw-alpha/revisions/raw-revision-alpha",
      "organizations/org-alpha/exports/export-alpha/artifact-alpha",
    ],
  );

  const deniedRequests = [{
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-alpha/downloads",
    session: "session-alpha-viewer",
  }, {
    path: "/api/v1/organizations/org-alpha/exports/export-alpha/downloads",
    session: "session-alpha-viewer",
  }, {
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-alpha-other/downloads",
    session: "session-alpha-pilot",
  }, {
    path: "/api/v1/organizations/org-alpha/exports/export-alpha-other/downloads",
    session: "session-alpha-pilot",
  }, {
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-alpha-shared/downloads",
    session: "session-alpha-pilot",
  }, {
    path: "/api/v1/organizations/org-alpha/exports/export-alpha-shared/downloads",
    session: "session-alpha-pilot",
  }, {
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-alpha/downloads",
    session: "session-beta-admin",
  }, {
    path: "/api/v1/organizations/org-alpha/raw-sources/raw-beta/downloads",
    session: "session-alpha-admin",
  }];
  const callsAfterAuthorized = apiSigner.calls.length;
  for (const input of deniedRequests) {
    const response = await apiRequest(input.path, input.session, {
      method: "POST",
      headers: { "x-user-id": "user-alpha-owner" },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, hiddenResourceProblem);
  }
  assert.equal(apiSigner.calls.length, callsAfterAuthorized);
});

test("organization policy can disable pilot raw and export downloads without limiting admins", async () => {
  for (const resourcePath of [
    "raw-sources/raw-beta",
    "exports/export-beta",
  ]) {
    const pilot = await apiRequest(
      `/api/v1/organizations/org-beta/${resourcePath}/downloads`,
      "session-beta-pilot",
      { method: "POST" },
    );
    assert.equal(pilot.status, 404);
    assert.deepEqual(pilot.body, hiddenResourceProblem);

    const admin = await apiRequest(
      `/api/v1/organizations/org-beta/${resourcePath}/downloads`,
      "session-beta-admin",
      { method: "POST" },
    );
    assert.equal(admin.status, 200);
    assert.equal(admin.body.data.expires_at, "2026-07-15T12:05:00.000Z");
  }
});

test("Alpha and Beta direct reads, joins, aggregates, and exports remain isolated", async () => {
  const alpha = await withOrganization(applicationPool, "org-alpha", async (repositories) => ({
    own: await repositories.findFlightById("flight-alpha"),
    other: await repositories.findFlightById("flight-beta"),
    joined: await repositories.listFlightsWithAircraft(),
    totals: await repositories.flightTotals(),
    exported: await repositories.exportFlights(),
  }));
  assert.equal(alpha.own.id, "flight-alpha");
  assert.equal(alpha.own.notes, "alpha-only");
  assert.equal(alpha.other, null);
  assert.deepEqual(alpha.joined, [{
    id: "flight-alpha",
    organization_id: "org-alpha",
    aircraft_name: "Alpha Aircraft",
  }, {
    id: "flight-alpha-other",
    organization_id: "org-alpha",
    aircraft_name: "Alpha Aircraft",
  }]);
  assert.deepEqual(alpha.totals, { flightCount: 2, durationMs: 3601000 });
  assert.deepEqual(alpha.exported, [{
    id: "flight-alpha",
    organization_id: "org-alpha",
    duration_ms: "3600000",
    revision_id: "revision-alpha",
    telemetry_sample_count: 2,
  }]);

  const beta = await withOrganization(applicationPool, "org-beta", async (repositories) => ({
    own: await repositories.findFlightById("flight-beta"),
    other: await repositories.findFlightById("flight-alpha"),
    joined: await repositories.listFlightsWithAircraft(),
    totals: await repositories.flightTotals(),
    exported: await repositories.exportFlights(),
  }));
  assert.equal(beta.own.id, "flight-beta");
  assert.equal(beta.own.notes, "beta-only");
  assert.equal(beta.other, null);
  assert.deepEqual(beta.joined, [{
    id: "flight-beta",
    organization_id: "org-beta",
    aircraft_name: "Beta Aircraft",
  }]);
  assert.deepEqual(beta.totals, { flightCount: 1, durationMs: 7200000 });
  assert.deepEqual(beta.exported, [{
    id: "flight-beta",
    organization_id: "org-beta",
    duration_ms: "7200000",
    revision_id: "revision-beta",
    telemetry_sample_count: 2,
  }]);
});

test("transaction-local context cannot leak through a one-connection pool", async () => {
  const alpha = await withOrganization(applicationPool, "org-alpha", async (repositories) => ({
    pid: await repositories.connectionId(),
    rows: await repositories.listFlightsWithAircraft(),
  }));

  const contextless = await applicationPool.query(
    `SELECT pg_backend_pid() AS pid,
            current_setting('app.organization_id', true) AS organization_id,
            (SELECT count(*)::integer
               FROM droneworks.canonical_flights) AS flight_count`,
  );
  assert.equal(Number(contextless.rows[0].pid), alpha.pid);
  assert.equal(contextless.rows[0].organization_id, "");
  assert.equal(contextless.rows[0].flight_count, 0);

  const beta = await withOrganization(applicationPool, "org-beta", async (repositories) => ({
    pid: await repositories.connectionId(),
    rows: await repositories.listFlightsWithAircraft(),
  }));
  assert.equal(beta.pid, alpha.pid);
  assert.deepEqual(
    alpha.rows.map((row) => row.organization_id),
    ["org-alpha", "org-alpha"],
  );
  assert.deepEqual(beta.rows.map((row) => row.organization_id), ["org-beta"]);
});

test("cross-organization mutations fail through both RLS and composite ownership constraints", async () => {
  const hiddenUpdate = await withOrganization(
    applicationPool,
    "org-alpha",
    (repositories) => repositories.updateFlightNotes("flight-beta", "not-allowed"),
  );
  assert.equal(hiddenUpdate, null);

  const beta = await withOrganization(
    applicationPool,
    "org-beta",
    (repositories) => repositories.findFlightById("flight-beta"),
  );
  assert.equal(beta.notes, "beta-only");

  await assert.rejects(
    withOrganization(applicationPool, "org-beta", (repositories) => repositories.insertFlight({
      organizationId: "org-alpha",
      flightId: "flight-wrong-organization",
      pilotProfileId: "pilot-alpha",
      aircraftId: "aircraft-alpha",
      takeoffAt: new Date("2026-07-15T08:00:00Z"),
      takeoffTimezone: "Asia/Dubai",
      durationMs: 1000,
      locationText: "Synthetic Site",
    })),
    (error) => error.code === "42501" && /row-level security policy/.test(error.message),
  );

  await assert.rejects(
    withOrganization(applicationPool, "org-beta", (repositories) => repositories.insertFlight({
      organizationId: "org-beta",
      flightId: "flight-cross-asset",
      pilotProfileId: "pilot-beta",
      aircraftId: "aircraft-alpha",
      takeoffAt: new Date("2026-07-15T08:00:00Z"),
      takeoffTimezone: "Asia/Dubai",
      durationMs: 1000,
      locationText: "Synthetic Site",
    })),
    (error) => error.code === "23503" && error.constraint === "canonical_flights_organization_id_aircraft_id_fkey",
  );
});

test("background jobs require organization context and cannot load by a global flight ID", async () => {
  await assert.rejects(
    loadFlightForJob(applicationPool, { flightId: "flight-alpha" }),
    /organizationId must be a non-empty identifier/,
  );
  assert.equal(
    await loadFlightForJob(applicationPool, {
      organizationId: "org-beta",
      flightId: "flight-alpha",
    }),
    null,
  );
  const flight = await loadFlightForJob(applicationPool, {
    organizationId: "org-alpha",
    flightId: "flight-alpha",
  });
  assert.equal(flight.id, "flight-alpha");
});

test("durable queue jobs reject ID-only payloads and preserve organization isolation across retry", async () => {
  await assert.rejects(
    enqueueFlightRefresh(queueBoss, {
      schemaVersion: 1,
      flightId: "flight-alpha",
    }),
    /only schemaVersion, organizationId, and flightId/,
  );
  await assert.rejects(
    enqueueFlightRefresh(queueBoss, {
      schemaVersion: 1,
      organizationId: "org-alpha",
      flightId: "flight-alpha",
      parserPayload: { coordinates: "must-not-be-durable" },
    }),
    /only schemaVersion, organizationId, and flightId/,
  );
  assert.deepEqual(await queueBoss.findJobs(FLIGHT_REFRESH_QUEUE), []);

  const alphaJobId = await enqueueFlightRefresh(queueBoss, {
    schemaVersion: 1,
    organizationId: "org-alpha",
    flightId: "flight-alpha",
  });
  const durableAlpha = await queueBoss.getJobById(
    FLIGHT_REFRESH_QUEUE,
    alphaJobId,
  );
  assert.deepEqual(durableAlpha.data, {
    schemaVersion: 1,
    organizationId: "org-alpha",
    flightId: "flight-alpha",
  });

  const attempts = [];
  await assert.rejects(
    processNextFlightRefresh(queueBoss, applicationPool, async (input) => {
      attempts.push({
        organizationId: input.organizationId,
        flightId: input.flightId,
        visibleOrganizationId: input.flight.organization_id,
      });
      throw new Error("synthetic transient failure");
    }),
    /synthetic transient failure/,
  );
  const retry = await processNextFlightRefresh(
    queueBoss,
    applicationPool,
    async (input) => {
      attempts.push({
        organizationId: input.organizationId,
        flightId: input.flightId,
        visibleOrganizationId: input.flight.organization_id,
      });
      return { revision: "synthetic-retry-success" };
    },
  );
  assert.equal(retry.jobId, alphaJobId);
  assert.deepEqual(retry.outcome, {
    status: "processed",
    result: { revision: "synthetic-retry-success" },
  });
  assert.deepEqual(attempts, [{
    organizationId: "org-alpha",
    flightId: "flight-alpha",
    visibleOrganizationId: "org-alpha",
  }, {
    organizationId: "org-alpha",
    flightId: "flight-alpha",
    visibleOrganizationId: "org-alpha",
  }]);

  const crossOrganizationJobId = await enqueueFlightRefresh(queueBoss, {
    schemaVersion: 1,
    organizationId: "org-beta",
    flightId: "flight-alpha",
  });
  let crossOrganizationHandlerCalls = 0;
  const hidden = await processNextFlightRefresh(
    queueBoss,
    applicationPool,
    async () => {
      crossOrganizationHandlerCalls += 1;
    },
  );
  assert.equal(hidden.jobId, crossOrganizationJobId);
  assert.deepEqual(hidden.outcome, { status: "not_found" });
  assert.equal(crossOrganizationHandlerCalls, 0);

  const malformedJobId = await queueBoss.send(
    FLIGHT_REFRESH_QUEUE,
    { flightId: "flight-beta" },
    { retryLimit: 0 },
  );
  await assert.rejects(
    processNextFlightRefresh(queueBoss, applicationPool, async () => {
      assert.fail("malformed durable payload reached the domain handler");
    }),
    /only schemaVersion, organizationId, and flightId/,
  );
  const malformed = await queueBoss.getJobById(
    FLIGHT_REFRESH_QUEUE,
    malformedJobId,
  );
  assert.equal(malformed.state, "failed");
});

test("FORCE RLS applies to the migration owner while bootstrap bypass stays explicit", async () => {
  const ownerClient = await bootstrapPool.connect();
  try {
    await ownerClient.query("SET ROLE droneworks_migrator");
    const ownerRows = await ownerClient.query(
      "SELECT id FROM droneworks.canonical_flights ORDER BY id",
    );
    assert.deepEqual(ownerRows.rows, []);
  } finally {
    await ownerClient.query("RESET ROLE");
    ownerClient.release();
  }

  const bootstrapRows = await bootstrapPool.query(
    "SELECT id FROM droneworks.canonical_flights ORDER BY id",
  );
  assert.deepEqual(
    bootstrapRows.rows.map((row) => row.id),
    [
      "flight-alpha",
      "flight-alpha-expired-delete",
      "flight-alpha-other",
      "flight-beta",
    ],
  );
});

test("manual-flight creation enforces roles, required fields, and idempotency", async () => {
  const ownerInput = {
    pilot_profile_id: "pilot-alpha-other",
    aircraft_id: "aircraft-alpha",
    takeoff_at: "2026-07-15T08:00:00Z",
    takeoff_timezone: "Asia/Dubai",
    duration_ms: 120000,
    location_text: "Synthetic Manual Site",
    notes: "owner-created",
  };

  const missingKey = await apiRequest(
    "/api/v1/organizations/org-alpha/flights",
    "session-alpha-owner",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ownerInput),
    },
  );
  assert.equal(missingKey.status, 400);
  assert.deepEqual(missingKey.body.errors, [{
    field: "Idempotency-Key",
    detail: "must be a non-empty opaque identifier",
  }]);

  const invalid = await apiRequest(
    "/api/v1/organizations/org-alpha/flights",
    "session-alpha-owner",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "manual-invalid",
      },
      body: JSON.stringify({
        ...ownerInput,
        location_text: "",
        object_key: "not-accepted",
      }),
    },
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body.errors, [{
    field: "object_key",
    detail: "is not allowed",
  }, {
    field: "location_text",
    detail: "must be a non-empty string",
  }]);

  const deniedCreations = [{
    session: "session-alpha-viewer",
    key: "manual-viewer",
    input: ownerInput,
  }, {
    session: "session-alpha-admin",
    key: "manual-cross-organization",
    input: { ...ownerInput, pilot_profile_id: "pilot-beta" },
  }];
  for (const denied of deniedCreations) {
    const response = await apiRequest(
      "/api/v1/organizations/org-alpha/flights",
      denied.session,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": denied.key,
        },
        body: JSON.stringify(denied.input),
      },
    );
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, hiddenResourceProblem);
  }

  const created = await apiRequest(
    "/api/v1/organizations/org-alpha/flights",
    "session-alpha-owner",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "manual-owner-1",
      },
      body: JSON.stringify(ownerInput),
    },
  );
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, {
    data: {
      id: "flight-manual-1",
      organization_id: "org-alpha",
      pilot_profile_id: "pilot-alpha-other",
      aircraft_id: "aircraft-alpha",
      source_kind: "manual",
      state: "active",
      takeoff_at: "2026-07-15T08:00:00.000Z",
      takeoff_timezone: "Asia/Dubai",
      duration_ms: "120000",
      location_text: "Synthetic Manual Site",
      notes: "owner-created",
    },
  });

  const replayed = await apiRequest(
    "/api/v1/organizations/org-alpha/flights",
    "session-alpha-owner",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "manual-owner-1",
      },
      body: JSON.stringify(ownerInput),
    },
  );
  assert.equal(replayed.status, 201);
  assert.deepEqual(replayed.body, created.body);

  const conflict = await apiRequest(
    "/api/v1/organizations/org-alpha/flights",
    "session-alpha-owner",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "manual-owner-1",
      },
      body: JSON.stringify({ ...ownerInput, duration_ms: 120001 }),
    },
  );
  assert.deepEqual(conflict.body, {
    type: "about:blank",
    title: "Conflict",
    status: 409,
    detail: "The idempotency key was already used with different input",
  });

  const admin = await apiRequest(
    "/api/v1/organizations/org-alpha/flights",
    "session-alpha-admin",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "manual-admin-1",
      },
      body: JSON.stringify({ ...ownerInput, notes: "admin-created" }),
    },
  );
  assert.equal(admin.status, 201);
  assert.equal(admin.body.data.id, "flight-manual-2");

  const pilot = await apiRequest(
    "/api/v1/organizations/org-alpha/flights",
    "session-alpha-pilot",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "manual-pilot-1",
      },
      body: JSON.stringify({
        ...ownerInput,
        pilot_profile_id: "pilot-alpha",
        notes: "pilot-created",
      }),
    },
  );
  assert.equal(pilot.status, 201);
  assert.equal(pilot.body.data.id, "flight-manual-3");
  assert.equal(pilot.body.data.pilot_profile_id, "pilot-alpha");
});

test("flight mutations enforce the role matrix, grace window, audit redaction, and IDOR denial", async () => {
  const notesPath = "/api/v1/organizations/org-alpha/flights/flight-alpha-other/notes";
  for (const session of ["session-alpha-pilot", "session-alpha-viewer", "session-beta-admin"]) {
    const denied = await apiRequest(notesPath, session, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "must-not-apply" }),
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const crossOrganizationNotes = await apiRequest(
    "/api/v1/organizations/org-alpha/flights/flight-beta/notes",
    "session-alpha-admin",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "must-not-apply" }),
    },
  );
  assert.equal(crossOrganizationNotes.status, 404);
  assert.deepEqual(crossOrganizationNotes.body, hiddenResourceProblem);

  const pilotNotes = await apiRequest(
    notesPath,
    "session-alpha-other-pilot",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "pilot-owned note" }),
    },
  );
  assert.deepEqual(pilotNotes.body, {
    data: {
      id: "flight-alpha-other",
      organization_id: "org-alpha",
      notes: "pilot-owned note",
    },
  });

  const assignmentPath = "/api/v1/organizations/org-alpha/flights/flight-alpha-other/assignment";
  for (const session of ["session-alpha-other-pilot", "session-alpha-viewer", "session-beta-admin"]) {
    const denied = await apiRequest(assignmentPath, session, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pilot_profile_id: "pilot-alpha",
        aircraft_id: "aircraft-alpha",
      }),
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const crossOrganizationTarget = await apiRequest(
    assignmentPath,
    "session-alpha-admin",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pilot_profile_id: "pilot-beta",
        aircraft_id: "aircraft-alpha",
      }),
    },
  );
  assert.equal(crossOrganizationTarget.status, 404);
  assert.deepEqual(crossOrganizationTarget.body, hiddenResourceProblem);
  const crossOrganizationAssignment = await apiRequest(
    "/api/v1/organizations/org-alpha/flights/flight-beta/assignment",
    "session-alpha-admin",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pilot_profile_id: "pilot-alpha",
        aircraft_id: "aircraft-alpha",
      }),
    },
  );
  assert.equal(crossOrganizationAssignment.status, 404);
  assert.deepEqual(crossOrganizationAssignment.body, hiddenResourceProblem);

  const reassigned = await apiRequest(
    assignmentPath,
    "session-alpha-admin",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pilot_profile_id: "pilot-alpha",
        aircraft_id: "aircraft-alpha",
      }),
    },
  );
  assert.equal(reassigned.status, 200);
  assert.equal(reassigned.body.data.pilot_profile_id, "pilot-alpha");
  const assignmentState = await withOrganization(
    applicationPool,
    "org-alpha",
    (repositories) => repositories.findFlightAssignmentState("flight-alpha-other"),
  );
  assert.deepEqual(assignmentState, {
    pilot_profile_id: "pilot-alpha",
    aircraft_id: "aircraft-alpha",
    imported_pilot_profile_id: "pilot-alpha-other",
    imported_aircraft_id: "aircraft-alpha",
    override_pilot_profile_id: "pilot-alpha",
    override_aircraft_id: "aircraft-alpha",
  });

  const newPilotNotes = await apiRequest(
    notesPath,
    "session-alpha-pilot",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "after reassignment" }),
    },
  );
  assert.equal(newPilotNotes.status, 200);

  const totalsBeforeDelete = await withOrganization(
    applicationPool,
    "org-alpha",
    (repositories) => repositories.flightTotals(),
  );
  const deletePath = "/api/v1/organizations/org-alpha/flights/flight-alpha-other";
  for (const session of ["session-alpha-pilot", "session-alpha-viewer", "session-beta-admin"]) {
    const denied = await apiRequest(deletePath, session, { method: "DELETE" });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const crossOrganizationDelete = await apiRequest(
    "/api/v1/organizations/org-alpha/flights/flight-beta",
    "session-alpha-admin",
    { method: "DELETE" },
  );
  assert.equal(crossOrganizationDelete.status, 404);
  assert.deepEqual(crossOrganizationDelete.body, hiddenResourceProblem);
  const deleted = await apiRequest(deletePath, "session-alpha-admin", {
    method: "DELETE",
  });
  assert.equal(deleted.status, 204);
  assert.equal(deleted.body, null);

  const hiddenDeleted = await apiRequest(deletePath, "session-alpha-owner");
  assert.equal(hiddenDeleted.status, 404);
  assert.deepEqual(hiddenDeleted.body, hiddenResourceProblem);
  const totalsAfterDelete = await withOrganization(
    applicationPool,
    "org-alpha",
    (repositories) => repositories.flightTotals(),
  );
  assert.deepEqual(totalsAfterDelete, {
    flightCount: totalsBeforeDelete.flightCount - 1,
    durationMs: totalsBeforeDelete.durationMs - 1000,
  });

  const expiredRestore = await apiRequest(
    "/api/v1/organizations/org-alpha/flights/flight-alpha-expired-delete/restore",
    "session-alpha-owner",
    { method: "POST" },
  );
  assert.equal(expiredRestore.status, 404);
  assert.deepEqual(expiredRestore.body, hiddenResourceProblem);

  const restored = await apiRequest(
    `${deletePath}/restore`,
    "session-alpha-owner",
    { method: "POST" },
  );
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.state, "active");
  assert.equal(restored.body.data.deleted_at, null);
  const totalsAfterRestore = await withOrganization(
    applicationPool,
    "org-alpha",
    (repositories) => repositories.flightTotals(),
  );
  assert.deepEqual(totalsAfterRestore, totalsBeforeDelete);

  const events = await withOrganization(
    applicationPool,
    "org-alpha",
    (repositories) => repositories.listAuditEvents(),
  );
  assert.deepEqual(events.map((event) => event.action), [
    "flight.assignment_updated",
    "flight.created_manual",
    "flight.created_manual",
    "flight.created_manual",
    "flight.deleted",
    "flight.notes_updated",
    "flight.notes_updated",
    "flight.restored",
  ]);
  assert.equal(events.every((event) => event.resource_type === "flight"), true);
  assert.equal(events.some((event) => event.changed_fields.includes("state")), true);
  const serializedAudit = JSON.stringify(events);
  assert.equal(serializedAudit.includes("pilot-owned note"), false);
  assert.equal(serializedAudit.includes("after reassignment"), false);
  assert.equal(serializedAudit.includes("owner-created"), false);

  const contextless = await applicationPool.query(
    `SELECT current_setting('app.organization_id', true) AS organization_id,
            (SELECT count(*)::integer FROM droneworks.canonical_flights) AS flight_count,
            (SELECT count(*)::integer FROM droneworks.audit_events) AS audit_count,
            (SELECT count(*)::integer FROM droneworks.api_idempotency_requests) AS idempotency_count,
            (SELECT count(*)::integer FROM droneworks.flight_assignment_overrides) AS assignment_override_count`,
  );
  assert.deepEqual(contextless.rows[0], {
    organization_id: "",
    flight_count: 0,
    audit_count: 0,
    idempotency_count: 0,
    assignment_override_count: 0,
  });
});

test("organization member and settings operations enforce manager scope and preserve history", async () => {
  const membersPath = "/api/v1/organizations/org-alpha/members";
  for (const session of ["session-alpha-owner", "session-alpha-admin"]) {
    const listed = await apiRequest(membersPath, session);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.some(
      (member) => member.user_id === "user-alpha-owner" && member.role === "owner",
    ), true);
  }
  for (const session of [
    "session-alpha-pilot",
    "session-alpha-viewer",
    "session-beta-admin",
  ]) {
    const denied = await apiRequest(membersPath, session);
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const crossOrganizationMember = await apiRequest(
    `${membersPath}/user-beta`,
    "session-alpha-owner",
    { method: "DELETE" },
  );
  assert.equal(crossOrganizationMember.status, 404);
  assert.deepEqual(crossOrganizationMember.body, hiddenResourceProblem);

  const invalidOwnerRole = await apiRequest(
    `${membersPath}/user-alpha-new-member`,
    "session-alpha-owner",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    },
  );
  assert.equal(invalidOwnerRole.status, 400);
  assert.deepEqual(invalidOwnerRole.body.errors, [{
    field: "role",
    detail: "must be admin, pilot, or viewer",
  }]);

  for (const session of [
    "session-alpha-pilot",
    "session-alpha-viewer",
    "session-beta-admin",
  ]) {
    const denied = await apiRequest(
      `${membersPath}/user-alpha-denied-member`,
      session,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      },
    );
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }

  const created = await apiRequest(
    `${membersPath}/user-alpha-new-member`,
    "session-alpha-admin",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    },
  );
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.data, {
    organization_id: "org-alpha",
    user_id: "user-alpha-new-member",
    role: "viewer",
  });
  const replayed = await apiRequest(
    `${membersPath}/user-alpha-new-member`,
    "session-alpha-admin",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    },
  );
  assert.equal(replayed.status, 200);
  assert.deepEqual(replayed.body, created.body);
  const promoted = await apiRequest(
    `${membersPath}/user-alpha-new-member`,
    "session-alpha-owner",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "pilot" }),
    },
  );
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.data.role, "pilot");

  const protectedOwner = await apiRequest(
    `${membersPath}/user-alpha-owner`,
    "session-alpha-admin",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    },
  );
  assert.equal(protectedOwner.status, 404);
  assert.deepEqual(protectedOwner.body, hiddenResourceProblem);

  const settingsPath = "/api/v1/organizations/org-alpha/settings";
  const invalidSettings = await apiRequest(settingsPath, "session-alpha-admin", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ default_timezone: "Not/A-Timezone" }),
  });
  assert.equal(invalidSettings.status, 400);
  assert.deepEqual(invalidSettings.body.errors, [{
    field: "default_timezone",
    detail: "must be an IANA timezone",
  }]);
  for (const session of [
    "session-alpha-pilot",
    "session-alpha-viewer",
    "session-beta-admin",
  ]) {
    const denied = await apiRequest(settingsPath, session, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit_preference: "imperial" }),
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const adminSettings = await apiRequest(settingsPath, "session-alpha-admin", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Alpha Operations",
      unit_preference: "imperial",
      pilot_export_enabled: false,
    }),
  });
  assert.equal(adminSettings.status, 200);
  assert.deepEqual(adminSettings.body.data, {
    id: "org-alpha",
    name: "Alpha Operations",
    default_timezone: "Asia/Dubai",
    unit_preference: "imperial",
    pilot_raw_download_enabled: true,
    pilot_export_enabled: false,
  });
  const ownerSettings = await apiRequest(settingsPath, "session-alpha-owner", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      default_timezone: "Europe/London",
      pilot_raw_download_enabled: false,
    }),
  });
  assert.equal(ownerSettings.status, 200);
  assert.equal(ownerSettings.body.data.default_timezone, "Europe/London");
  assert.equal(ownerSettings.body.data.pilot_raw_download_enabled, false);

  const removedNewMember = await apiRequest(
    `${membersPath}/user-alpha-new-member`,
    "session-alpha-admin",
    { method: "DELETE" },
  );
  assert.equal(removedNewMember.status, 204);
  const removedHistoricalPilot = await apiRequest(
    `${membersPath}/user-alpha-other-pilot`,
    "session-alpha-owner",
    { method: "DELETE" },
  );
  assert.equal(removedHistoricalPilot.status, 204);
  const historicalPilot = await bootstrapPool.query(
    `SELECT id, membership_user_id
       FROM droneworks.pilot_profiles
      WHERE organization_id = 'org-alpha'
        AND id = 'pilot-alpha-other'`,
  );
  assert.deepEqual(historicalPilot.rows, [{
    id: "pilot-alpha-other",
    membership_user_id: null,
  }]);
  const removedIdentity = await apiRequest(membersPath, "session-alpha-new-member");
  assert.equal(removedIdentity.status, 404);
  assert.deepEqual(removedIdentity.body, hiddenResourceProblem);
});

test("ownership transfer and deletion requests are owner-only and organization-isolated", async () => {
  const transferPath = "/api/v1/organizations/org-alpha/ownership-transfers";
  for (const session of [
    "session-alpha-admin",
    "session-alpha-pilot",
    "session-alpha-viewer",
    "session-beta-owner",
  ]) {
    const denied = await apiRequest(transferPath, session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ new_owner_user_id: "user-alpha" }),
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const crossOrganizationTarget = await apiRequest(
    transferPath,
    "session-alpha-owner",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ new_owner_user_id: "user-beta" }),
    },
  );
  assert.equal(crossOrganizationTarget.status, 404);
  assert.deepEqual(crossOrganizationTarget.body, hiddenResourceProblem);

  const transferred = await apiRequest(transferPath, "session-alpha-owner", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ new_owner_user_id: "user-alpha" }),
  });
  assert.equal(transferred.status, 200);
  assert.deepEqual(transferred.body.data, {
    organization_id: "org-alpha",
    previous_owner_user_id: "user-alpha-owner",
    new_owner_user_id: "user-alpha",
  });
  const ownership = await bootstrapPool.query(
    `SELECT user_id, role
       FROM droneworks.memberships
      WHERE organization_id = 'org-alpha'
        AND user_id IN ('user-alpha-owner', 'user-alpha')
      ORDER BY user_id`,
  );
  assert.deepEqual(ownership.rows, [{
    user_id: "user-alpha",
    role: "owner",
  }, {
    user_id: "user-alpha-owner",
    role: "admin",
  }]);
  const ownerInvariant = await bootstrapPool.query(
    `SELECT count(*) FILTER (WHERE membership.role = 'owner')::integer AS owner_count,
            pg_get_indexdef(index.oid) AS index_definition
       FROM droneworks.memberships AS membership
       JOIN pg_class AS index ON index.relname = 'memberships_one_owner_idx'
      WHERE membership.organization_id = 'org-alpha'
      GROUP BY index.oid`,
  );
  assert.equal(ownerInvariant.rows[0].owner_count, 1);
  assert.match(
    ownerInvariant.rows[0].index_definition,
    /CREATE UNIQUE INDEX .* WHERE \(role = 'owner'::text\)/,
  );

  const deletionPath = "/api/v1/organizations/org-alpha/deletion-request";
  for (const session of [
    "session-alpha-owner",
    "session-alpha-pilot",
    "session-alpha-viewer",
    "session-beta-owner",
  ]) {
    const denied = await apiRequest(deletionPath, session, { method: "POST" });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const requested = await apiRequest(deletionPath, "session-alpha-admin", {
    method: "POST",
  });
  assert.equal(requested.status, 202);
  assert.deepEqual(requested.body.data, {
    id: "org-alpha",
    state: "pending_deletion",
    deletion_requested_at: "2026-07-15T12:00:00.000Z",
  });
  const replayedRequest = await apiRequest(deletionPath, "session-alpha-admin", {
    method: "POST",
  });
  assert.equal(replayedRequest.status, 202);
  assert.deepEqual(replayedRequest.body, requested.body);

  const formerOwnerCancel = await apiRequest(deletionPath, "session-alpha-owner", {
    method: "DELETE",
  });
  assert.equal(formerOwnerCancel.status, 404);
  assert.deepEqual(formerOwnerCancel.body, hiddenResourceProblem);
  const cancelled = await apiRequest(deletionPath, "session-alpha-admin", {
    method: "DELETE",
  });
  assert.equal(cancelled.status, 200);
  assert.deepEqual(cancelled.body.data, {
    id: "org-alpha",
    state: "active",
    deletion_requested_at: null,
  });

  const administrationEvents = await withOrganization(
    applicationPool,
    "org-alpha",
    async (repositories) => (await repositories.listAuditEvents()).filter(
      (event) => event.resource_type !== "flight",
    ),
  );
  const actionCounts = Object.groupBy(
    administrationEvents,
    (event) => event.action,
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(actionCounts).map(([action, events]) => [action, events.length]),
    ),
    {
      "membership.added": 1,
      "membership.removed": 2,
      "membership.role_updated": 1,
      "organization.deletion_cancelled": 1,
      "organization.deletion_requested": 1,
      "organization.ownership_transferred": 1,
      "organization.settings_updated": 2,
    },
  );
  assert.equal(administrationEvents.every(
    (event) => event.changed_fields.length > 0,
  ), true);
  const serializedAudit = JSON.stringify(administrationEvents);
  assert.equal(serializedAudit.includes("Alpha Operations"), false);
  assert.equal(serializedAudit.includes("Europe/London"), false);

  const beta = await bootstrapPool.query(
    `SELECT name,
            default_timezone,
            unit_preference,
            state,
            deletion_requested_at
       FROM droneworks.organizations
      WHERE id = 'org-beta'`,
  );
  assert.deepEqual(beta.rows, [{
    name: "Beta",
    default_timezone: "UTC",
    unit_preference: "imperial",
    state: "active",
    deletion_requested_at: null,
  }]);
  const contextless = await applicationPool.query(
    `SELECT current_setting('app.organization_id', true) AS organization_id,
            (SELECT count(*)::integer FROM droneworks.organizations) AS organization_count,
            (SELECT count(*)::integer FROM droneworks.memberships) AS membership_count,
            (SELECT count(*)::integer FROM droneworks.audit_events) AS audit_count`,
  );
  assert.deepEqual(contextless.rows[0], {
    organization_id: "",
    organization_count: 0,
    membership_count: 0,
    audit_count: 0,
  });
});

test("flight tags and batteries enforce member, pilot-own, and manager boundaries", async () => {
  const tagsPath = "/api/v1/organizations/org-alpha/tags";
  for (const session of [
    "session-alpha-owner",
    "session-alpha-admin",
    "session-alpha-pilot",
    "session-alpha-viewer",
  ]) {
    const listed = await apiRequest(tagsPath, session);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data.map((tag) => tag.id), [
      "tag-alpha-inspection",
      "tag-alpha-training",
    ]);
  }
  const crossOrganizationTags = await apiRequest(tagsPath, "session-beta-admin");
  assert.equal(crossOrganizationTags.status, 404);
  assert.deepEqual(crossOrganizationTags.body, hiddenResourceProblem);

  const pilotTagPath = `${API_PREFIX}/organizations/org-alpha/flights/flight-alpha/tags/tag-alpha-training`;
  const pilotAddedTag = await apiRequest(pilotTagPath, "session-alpha-pilot", {
    method: "PUT",
  });
  assert.equal(pilotAddedTag.status, 200);
  assert.deepEqual(pilotAddedTag.body.data, {
    canonical_flight_id: "flight-alpha",
    tag_id: "tag-alpha-training",
    origin: "user_override",
  });
  const replayedTag = await apiRequest(pilotTagPath, "session-alpha-pilot", {
    method: "PUT",
  });
  assert.deepEqual(replayedTag, pilotAddedTag);

  for (const denied of [{
    path: `${API_PREFIX}/organizations/org-alpha/flights/flight-alpha/tags/tag-alpha-training`,
    session: "session-alpha-viewer",
  }, {
    path: `${API_PREFIX}/organizations/org-alpha/flights/flight-manual-1/tags/tag-alpha-training`,
    session: "session-alpha-pilot",
  }, {
    path: `${API_PREFIX}/organizations/org-alpha/flights/flight-alpha/tags/tag-beta-inspection`,
    session: "session-alpha-admin",
  }, {
    path: `${API_PREFIX}/organizations/org-beta/flights/flight-alpha/tags/tag-alpha-training`,
    session: "session-beta-admin",
  }]) {
    const response = await apiRequest(denied.path, denied.session, { method: "PUT" });
    assert.equal(response.status, 404, `${denied.session} must not access ${denied.path}`);
    assert.deepEqual(response.body, hiddenResourceProblem);
  }
  const removedTag = await apiRequest(pilotTagPath, "session-alpha-pilot", {
    method: "DELETE",
  });
  assert.equal(removedTag.status, 204);
  const importedTagRemoval = await apiRequest(
    `${API_PREFIX}/organizations/org-alpha/flights/flight-alpha/tags/tag-alpha-inspection`,
    "session-alpha-admin",
    { method: "DELETE" },
  );
  assert.equal(importedTagRemoval.status, 404);
  assert.deepEqual(importedTagRemoval.body, hiddenResourceProblem);

  const batteriesPath = `${API_PREFIX}/organizations/org-alpha/batteries`;
  for (const session of [
    "session-alpha-owner",
    "session-alpha-admin",
    "session-alpha-pilot",
    "session-alpha-viewer",
  ]) {
    const listed = await apiRequest(batteriesPath, session);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data.map((battery) => battery.id), [
      "battery-alpha",
      "battery-alpha-spare",
    ]);
  }
  const invalidBattery = await apiRequest(
    `${batteriesPath}/battery-alpha-spare`,
    "session-alpha-owner",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lifecycle: "unknown", object_key: "denied" }),
    },
  );
  assert.equal(invalidBattery.status, 400);
  assert.deepEqual(invalidBattery.body.errors, [{
    field: "object_key",
    detail: "is not allowed",
  }, {
    field: "lifecycle",
    detail: "must be active or retired",
  }]);
  for (const session of [
    "session-alpha-pilot",
    "session-alpha-viewer",
    "session-beta-admin",
  ]) {
    const denied = await apiRequest(
      `${batteriesPath}/battery-alpha-spare`,
      session,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lifecycle: "retired" }),
      },
    );
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }
  const updatedBattery = await apiRequest(
    `${batteriesPath}/battery-alpha-spare`,
    "session-alpha-owner",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Alpha Spare Retired",
        serial_number: "SYNTH-ALPHA-SPARE",
        lifecycle: "retired",
      }),
    },
  );
  assert.equal(updatedBattery.status, 200);
  assert.deepEqual(updatedBattery.body.data, {
    id: "battery-alpha-spare",
    display_name: "Alpha Spare Retired",
    serial_number: "SYNTH-ALPHA-SPARE",
    lifecycle: "retired",
  });

  const batteryLinkPath = `${API_PREFIX}/organizations/org-alpha/flights/flight-alpha/batteries/battery-alpha-spare`;
  const addedBattery = await apiRequest(batteryLinkPath, "session-alpha-admin", {
    method: "PUT",
  });
  assert.equal(addedBattery.status, 200);
  assert.deepEqual(addedBattery.body.data, {
    canonical_flight_id: "flight-alpha",
    battery_id: "battery-alpha-spare",
    origin: "user_override",
  });
  const replayedBattery = await apiRequest(batteryLinkPath, "session-alpha-admin", {
    method: "PUT",
  });
  assert.deepEqual(replayedBattery, addedBattery);
  for (const denied of [{
    path: batteryLinkPath,
    session: "session-alpha-pilot",
  }, {
    path: batteryLinkPath,
    session: "session-alpha-viewer",
  }, {
    path: `${API_PREFIX}/organizations/org-alpha/flights/flight-alpha/batteries/battery-beta`,
    session: "session-alpha-admin",
  }]) {
    const response = await apiRequest(denied.path, denied.session, { method: "PUT" });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, hiddenResourceProblem);
  }
  const removedBattery = await apiRequest(batteryLinkPath, "session-alpha-owner", {
    method: "DELETE",
  });
  assert.equal(removedBattery.status, 204);
  const importedBatteryRemoval = await apiRequest(
    `${API_PREFIX}/organizations/org-alpha/flights/flight-alpha/batteries/battery-alpha`,
    "session-alpha-admin",
    { method: "DELETE" },
  );
  assert.equal(importedBatteryRemoval.status, 404);
  assert.deepEqual(importedBatteryRemoval.body, hiddenResourceProblem);

  const resourceEvents = await withOrganization(
    applicationPool,
    "org-alpha",
    async (repositories) => (await repositories.listAuditEvents()).filter(
      (event) => [
        "battery.updated",
        "flight.battery_added",
        "flight.battery_removed",
        "flight.tag_added",
        "flight.tag_removed",
      ].includes(event.action),
    ),
  );
  assert.deepEqual(resourceEvents.map((event) => event.action).sort(), [
    "battery.updated",
    "flight.battery_added",
    "flight.battery_removed",
    "flight.tag_added",
    "flight.tag_removed",
  ]);
  const serializedEvents = JSON.stringify(resourceEvents);
  assert.equal(serializedEvents.includes("Alpha Spare Retired"), false);
  assert.equal(serializedEvents.includes("SYNTH-ALPHA-SPARE"), false);
});

test("upload and import records are idempotent, uploader-scoped, and organization-isolated", async () => {
  const importsPath = `${API_PREFIX}/organizations/org-alpha/import-batches`;
  const files = [{
    client_file_id: "client-new-a",
    original_filename: "synthetic-a.txt",
  }, {
    client_file_id: "client-new-b",
    original_filename: "synthetic-b.txt",
  }];
  const missingKey = await apiRequest(importsPath, "session-alpha-pilot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files }),
  });
  assert.equal(missingKey.status, 400);
  assert.deepEqual(missingKey.body.errors, [{
    field: "Idempotency-Key",
    detail: "must be a non-empty opaque identifier",
  }]);
  const duplicateClientId = await apiRequest(importsPath, "session-alpha-pilot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "import-invalid",
    },
    body: JSON.stringify({ files: [files[0], files[0]] }),
  });
  assert.equal(duplicateClientId.status, 400);
  assert.deepEqual(duplicateClientId.body.errors, [{
    field: "files[1].client_file_id",
    detail: "must be unique within the batch",
  }]);
  for (const session of ["session-alpha-viewer", "session-beta-admin"]) {
    const denied = await apiRequest(importsPath, session, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `import-denied-${session}`,
      },
      body: JSON.stringify({ files }),
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, hiddenResourceProblem);
  }

  const created = await apiRequest(importsPath, "session-alpha-pilot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "import-pilot-1",
    },
    body: JSON.stringify({ files }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.id, "import-batch-1");
  assert.equal(created.body.data.uploaded_by_user_id, "user-alpha-pilot");
  assert.equal(created.body.data.state, "uploaded");
  assert.deepEqual(created.body.data.items.map((item) => ({
    id: item.id,
    client_file_id: item.client_file_id,
    state: item.state,
    raw_source_id: item.raw_source_id,
  })), [{
    id: "import-item-1",
    client_file_id: "client-new-a",
    state: "uploaded",
    raw_source_id: null,
  }, {
    id: "import-item-2",
    client_file_id: "client-new-b",
    state: "uploaded",
    raw_source_id: null,
  }]);
  const replayed = await apiRequest(importsPath, "session-alpha-pilot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "import-pilot-1",
    },
    body: JSON.stringify({ files }),
  });
  assert.deepEqual(replayed, created);
  const conflict = await apiRequest(importsPath, "session-alpha-pilot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "import-pilot-1",
    },
    body: JSON.stringify({ files: [files[0]] }),
  });
  assert.equal(conflict.status, 409);

  const pilotRead = await apiRequest(
    `${importsPath}/import-batch-1`,
    "session-alpha-pilot",
  );
  assert.equal(pilotRead.status, 200);
  assert.deepEqual(pilotRead.body, created.body);
  const managerRead = await apiRequest(
    `${importsPath}/import-batch-1`,
    "session-alpha-owner",
  );
  assert.equal(managerRead.status, 200);
  assert.deepEqual(managerRead.body, created.body);
  for (const denied of [{
    path: `${importsPath}/import-batch-1`,
    session: "session-alpha-viewer",
  }, {
    path: `${API_PREFIX}/organizations/org-beta/import-batches/import-batch-1`,
    session: "session-beta-admin",
  }, {
    path: `${API_PREFIX}/organizations/org-alpha/import-batches/import-batch-beta`,
    session: "session-alpha-owner",
  }]) {
    const response = await apiRequest(denied.path, denied.session);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, hiddenResourceProblem);
  }

  const managerFiles = [{
    client_file_id: "client-manager-a",
    original_filename: "synthetic-manager.txt",
  }];
  const managerCreated = await apiRequest(importsPath, "session-alpha-owner", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "import-manager-1",
    },
    body: JSON.stringify({ files: managerFiles }),
  });
  assert.equal(managerCreated.status, 201);
  assert.equal(managerCreated.body.data.id, "import-batch-2");
  const unrelatedPilot = await apiRequest(
    `${importsPath}/import-batch-2`,
    "session-alpha-pilot",
  );
  assert.equal(unrelatedPilot.status, 404);
  assert.deepEqual(unrelatedPilot.body, hiddenResourceProblem);

  const importEvents = await withOrganization(
    applicationPool,
    "org-alpha",
    async (repositories) => (await repositories.listAuditEvents()).filter(
      (event) => event.action === "import_batch.created",
    ),
  );
  assert.deepEqual(importEvents.map((event) => event.metadata), [{
    item_count: 2,
  }, {
    item_count: 1,
  }]);
  const serializedAudit = JSON.stringify(importEvents);
  assert.equal(serializedAudit.includes("synthetic-a.txt"), false);
  assert.equal(serializedAudit.includes("synthetic-manager.txt"), false);
});

test("remaining-resource RLS survives pooled reuse and composite ownership rejects cross-organization links", async () => {
  const alpha = await withOrganization(applicationPool, "org-alpha", async (repositories) => ({
    pid: await repositories.connectionId(),
    tags: await repositories.listTagsForMember("user-alpha"),
    batteries: await repositories.listBatteriesForMember("user-alpha"),
    batch: await repositories.findImportBatchForMember({
      userId: "user-alpha",
      batchId: "import-batch-alpha",
    }),
  }));
  assert.deepEqual(alpha.tags.map((tag) => tag.id), [
    "tag-alpha-inspection",
    "tag-alpha-training",
  ]);
  assert.deepEqual(alpha.batteries.map((battery) => battery.id), [
    "battery-alpha",
    "battery-alpha-spare",
  ]);
  assert.equal(alpha.batch.id, "import-batch-alpha");

  const contextless = await applicationPool.query(
    `SELECT pg_backend_pid() AS pid,
            current_setting('app.organization_id', true) AS organization_id,
            (SELECT count(*)::integer FROM droneworks.tags) AS tag_count,
            (SELECT count(*)::integer FROM droneworks.batteries) AS battery_count,
            (SELECT count(*)::integer FROM droneworks.flight_tags) AS flight_tag_count,
            (SELECT count(*)::integer FROM droneworks.flight_batteries) AS flight_battery_count,
            (SELECT count(*)::integer FROM droneworks.import_batches) AS import_batch_count,
            (SELECT count(*)::integer FROM droneworks.import_items) AS import_item_count`,
  );
  assert.deepEqual({
    ...contextless.rows[0],
    pid: Number(contextless.rows[0].pid),
  }, {
    pid: alpha.pid,
    organization_id: "",
    tag_count: 0,
    battery_count: 0,
    flight_tag_count: 0,
    flight_battery_count: 0,
    import_batch_count: 0,
    import_item_count: 0,
  });

  const beta = await withOrganization(applicationPool, "org-beta", async (repositories) => ({
    pid: await repositories.connectionId(),
    tags: await repositories.listTagsForMember("user-beta"),
    batteries: await repositories.listBatteriesForMember("user-beta"),
    batch: await repositories.findImportBatchForMember({
      userId: "user-beta",
      batchId: "import-batch-beta",
    }),
  }));
  assert.equal(beta.pid, alpha.pid);
  assert.deepEqual(beta.tags.map((tag) => tag.id), ["tag-beta-inspection"]);
  assert.deepEqual(beta.batteries.map((battery) => battery.id), ["battery-beta"]);
  assert.equal(beta.batch.id, "import-batch-beta");

  await assertOrganizationSqlRejects(
    "org-alpha",
    `INSERT INTO droneworks.flight_tags (
       organization_id, canonical_flight_id, tag_id, origin
     ) VALUES ('org-alpha', 'flight-alpha', 'tag-beta-inspection', 'user_override')`,
    (error) => error.code === "23503"
      && error.constraint === "flight_tags_organization_id_tag_id_fkey",
  );
  await assertOrganizationSqlRejects(
    "org-beta",
    `INSERT INTO droneworks.flight_batteries (
       organization_id, canonical_flight_id, battery_id, origin
     ) VALUES ('org-beta', 'flight-beta', 'battery-alpha', 'user_override')`,
    (error) => error.code === "23503"
      && error.constraint === "flight_batteries_organization_id_battery_id_fkey",
  );
  await assertOrganizationSqlRejects(
    "org-alpha",
    `INSERT INTO droneworks.import_items (
       organization_id,
       id,
       import_batch_id,
       client_file_id,
       original_filename,
       raw_source_id,
       state,
       created_at
     ) VALUES (
       'org-alpha',
       'import-item-cross-source',
       'import-batch-alpha',
       'client-cross-source',
       'synthetic-cross.txt',
       'raw-beta',
       'uploaded',
       '2026-07-16T00:00:00Z'
     )`,
    (error) => error.code === "23503"
      && error.constraint === "import_items_organization_id_raw_source_id_fkey",
  );
  await assertOrganizationSqlRejects(
    "org-beta",
    "INSERT INTO droneworks.tags (organization_id, id, name) VALUES ('org-alpha', 'tag-wrong-context', 'Denied')",
    (error) => error.code === "42501" && /row-level security policy/.test(error.message),
  );
});
