import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { createApiServer } from "../src/api.mjs";
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
  loadFlightForJob,
  withOrganization,
} from "../src/repositories.mjs";

const { Pool } = pg;

const applicationPool = new Pool({ max: 1 });
const bootstrapPool = new Pool({
  max: 1,
  user: process.env.DRONEWORKS_PG_BOOTSTRAP_USER,
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
let createdFlightSequence = 0;
const apiServer = createApiServer({
  pool: applicationPool,
  signer: apiSigner,
  now: () => new Date(fixedNow),
  createId: () => `flight-manual-${++createdFlightSequence}`,
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
  assert.equal(tables.rowCount, 14);
  for (const table of tables.rows) {
    assert.equal(table.owner, "droneworks_migrator");
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.relforcerowsecurity, true);
  }
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
