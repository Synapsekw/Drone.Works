import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import {
  DownloadAuthorizationError,
  MAX_DOWNLOAD_TTL_MS,
  deriveObjectKey,
  issueAuthorizedDownload,
} from "../src/downloads.mjs";
import {
  loadFlightForJob,
  withOrganization,
} from "../src/repositories.mjs";

const { Pool } = pg;

const applicationPool = new Pool({ max: 1 });
const bootstrapPool = new Pool({
  max: 1,
  user: process.env.DRONEWORKS_PG_BOOTSTRAP_USER,
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

after(async () => {
  await Promise.all([
    applicationPool.end(),
    bootstrapPool.end(),
  ]);
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
  assert.equal(tables.rowCount, 9);
  for (const table of tables.rows) {
    assert.equal(table.owner, "droneworks_migrator");
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.relforcerowsecurity, true);
  }
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
  }]);
  assert.deepEqual(alpha.totals, { flightCount: 1, durationMs: 3600000 });
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
  assert.deepEqual(alpha.rows.map((row) => row.organization_id), ["org-alpha"]);
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
      durationMs: 1000,
    })),
    (error) => error.code === "42501" && /row-level security policy/.test(error.message),
  );

  await assert.rejects(
    withOrganization(applicationPool, "org-beta", (repositories) => repositories.insertFlight({
      organizationId: "org-beta",
      flightId: "flight-cross-asset",
      pilotProfileId: "pilot-beta",
      aircraftId: "aircraft-alpha",
      durationMs: 1000,
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
    ["flight-alpha", "flight-beta"],
  );
});
