import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
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
  assert.equal(tables.rowCount, 7);
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

  await assert.rejects(
    applicationPool.query(
      "INSERT INTO droneworks.aircraft (organization_id, id, display_name) VALUES ('org-alpha', 'aircraft-missing-context', 'Denied')",
    ),
    (error) => error.code === "42501" && /row-level security policy/.test(error.message),
  );
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
