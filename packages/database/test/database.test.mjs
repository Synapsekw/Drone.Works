import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  applyReviewedMigration,
  applyReviewedMigrations,
  IsolationContractError,
  loadReviewedMigrations,
  MigrationIntegrityError,
  OrganizationContextError,
  readCustomerIsolationContract,
  verifyIsolationContract,
  withOrganizationTransaction,
} from '../dist/index.js';
import { generatedOrganizations } from './generated-seed.mjs';

const { Client, Pool } = pg;
const alpha = generatedOrganizations.alpha;
const beta = generatedOrganizations.beta;
const customerTables = [
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
];
const connection = (user) => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user,
});
const appPool = new Pool({ ...connection(process.env.PGUSER), max: 1 });

afterAll(async () => {
  await appPool.end();
});

async function useClient(user, operation) {
  const client = new Client(connection(user));
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

describe('A04 PostgreSQL organization boundary', () => {
  it('creates only the reviewed least-privilege roles and ownership', async () => {
    await useClient(
      process.env.DRONEWORKS_PG_BOOTSTRAP_USER,
      async (client) => {
        const roles = await client.query(
          `SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
                rolcreaterole, rolreplication, rolbypassrls
           FROM pg_roles
          WHERE rolname = ANY($1)
          ORDER BY rolname`,
          [
            [
              'droneworks_app',
              'droneworks_dispatcher',
              'droneworks_migration_auditor',
              'droneworks_migration_runner',
              'droneworks_migrator',
              'droneworks_queue',
            ],
          ],
        );
        expect(roles.rows).toHaveLength(6);
        for (const role of roles.rows) {
          expect(role).toMatchObject({
            rolinherit: false,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
          });
          expect(role.rolcanlogin).toBe(
            !['droneworks_migration_auditor', 'droneworks_migrator'].includes(
              role.rolname,
            ),
          );
        }

        const memberships = await client.query(
          `SELECT member.rolname AS member, granted.rolname AS granted
           FROM pg_auth_members AS membership
           JOIN pg_roles AS member ON member.oid = membership.member
           JOIN pg_roles AS granted ON granted.oid = membership.roleid
          WHERE member.rolname LIKE 'droneworks_%'
             OR granted.rolname LIKE 'droneworks_%'
          ORDER BY member.rolname, granted.rolname`,
        );
        expect(memberships.rows).toEqual([
          {
            member: 'droneworks_migration_runner',
            granted: 'droneworks_migrator',
          },
        ]);

        const schemas = await client.query(
          `SELECT namespace.nspname, owner.rolname AS owner
           FROM pg_namespace AS namespace
           JOIN pg_roles AS owner ON owner.oid = namespace.nspowner
          WHERE namespace.nspname = ANY($1)
          ORDER BY namespace.nspname`,
          [['droneworks', 'droneworks_jobs', 'droneworks_ops']],
        );
        expect(schemas.rows).toEqual([
          { nspname: 'droneworks', owner: 'droneworks_migrator' },
          { nspname: 'droneworks_jobs', owner: 'droneworks_queue' },
          {
            nspname: 'droneworks_ops',
            owner: 'droneworks_migration_auditor',
          },
        ]);

        const contract = await readCustomerIsolationContract(client);
        expect(contract.map((table) => table.table_name)).toEqual(
          customerTables,
        );
        for (const table of contract) {
          expect(table).toMatchObject({
            owner_name: 'droneworks_migrator',
            row_security: true,
            force_row_security: true,
          });
          expect(table.policies).toHaveLength(1);
        }

        const ledgerOwner = await client.query(
          `SELECT owner.rolname AS owner
           FROM pg_class AS relation
           JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
           JOIN pg_roles AS owner ON owner.oid = relation.relowner
          WHERE namespace.nspname = 'droneworks_ops'
            AND relation.relname = 'migration_runs'`,
        );
        expect(ledgerOwner.rows[0]?.owner).toBe('droneworks_migration_auditor');
      },
    );
  });

  it('fails closed when organization context is absent or invalid', async () => {
    const contextless = await appPool.query(
      'SELECT count(*)::integer AS count FROM droneworks.organizations',
    );
    expect(contextless.rows[0]?.count).toBe(0);

    await expect(
      appPool.query(
        `INSERT INTO droneworks.organizations (
           id, name, default_timezone, unit_system, created_at
         ) VALUES (
           '00000000-0000-4000-8000-0000000000c1',
           'Generated Contextless',
           'UTC',
           'metric',
           now()
         )`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    let acquired = false;
    const neverAcquire = {
      async connect() {
        acquired = true;
        throw new Error('Connection must not be acquired.');
      },
    };
    await expect(
      withOrganizationTransaction(
        neverAcquire,
        'not-an-organization',
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(OrganizationContextError);
    expect(acquired).toBe(false);
  });

  it('isolates every customer table and clears one reused backend', async () => {
    let retainedTransaction;
    const alphaResult = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) => {
        retainedTransaction = transaction;
        const pid = await transaction.query(
          'SELECT pg_backend_pid()::integer AS pid',
        );
        for (const table of customerTables) {
          const count = await transaction.query(
            `SELECT count(*)::integer AS count FROM droneworks.${table}`,
          );
          expect(count.rows[0]?.count).toBe(1);
        }
        const exactBeta = await transaction.query(
          'SELECT id FROM droneworks.canonical_flights WHERE id = $1',
          [beta.flightId],
        );
        expect(exactBeta.rowCount).toBe(0);

        const joined = await transaction.query(
          `SELECT flight.id, pilot.display_name, aircraft.display_name AS aircraft
             FROM droneworks.canonical_flights AS flight
             JOIN droneworks.pilot_profiles AS pilot
               ON (pilot.organization_id, pilot.id) =
                  (flight.organization_id, flight.pilot_profile_id)
             JOIN droneworks.aircraft AS aircraft
               ON (aircraft.organization_id, aircraft.id) =
                  (flight.organization_id, flight.aircraft_id)`,
        );
        expect(joined.rows).toEqual([
          {
            id: alpha.flightId,
            display_name: 'Generated Pilot A',
            aircraft: 'Generated Aircraft A',
          },
        ]);
        const aggregate = await transaction.query(
          `SELECT aircraft_id, count(*)::integer AS flights
             FROM droneworks.canonical_flights
            GROUP BY aircraft_id`,
        );
        expect(aggregate.rows).toEqual([
          { aircraft_id: alpha.aircraftId, flights: 1 },
        ]);
        return pid.rows[0].pid;
      },
    );

    await expect(retainedTransaction.query('SELECT 1')).rejects.toThrow(
      'no longer active',
    );

    const contextlessClient = await appPool.connect();
    try {
      const cleared = await contextlessClient.query(
        `SELECT pg_backend_pid()::integer AS pid,
                current_setting('app.organization_id', true) AS organization_id,
                (SELECT count(*)::integer FROM droneworks.organizations) AS count`,
      );
      expect(cleared.rows[0]?.pid).toBe(alphaResult);
      expect([null, '']).toContain(cleared.rows[0]?.organization_id);
      expect(cleared.rows[0]?.count).toBe(0);
    } finally {
      contextlessClient.release();
    }

    const betaResult = await withOrganizationTransaction(
      appPool,
      beta.organizationId,
      async (transaction) => {
        const result = await transaction.query(
          `SELECT pg_backend_pid()::integer AS pid,
                  array_agg(id ORDER BY id) AS ids
             FROM droneworks.canonical_flights`,
        );
        return result.rows[0];
      },
    );
    expect(betaResult).toEqual({ pid: alphaResult, ids: [beta.flightId] });
  });

  it('rejects cross-organization writes and composite ownership', async () => {
    await expect(
      withOrganizationTransaction(
        appPool,
        alpha.organizationId,
        async (transaction) =>
          transaction.query(
            `INSERT INTO droneworks.organizations (
               id, name, default_timezone, unit_system, created_at
             ) VALUES ($1, 'Generated Wrong Context', 'UTC', 'metric', now())`,
            ['00000000-0000-4000-8000-0000000000c2'],
          ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withOrganizationTransaction(
        appPool,
        alpha.organizationId,
        async (transaction) =>
          transaction.query(
            `INSERT INTO droneworks.canonical_flights (
               organization_id, id, import_item_id, pilot_profile_id,
               aircraft_id, source_kind, state, takeoff_at, takeoff_timezone,
               duration_ms, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, 'imported', 'active', now(), 'UTC',
               1000, now(), now()
             )`,
            [
              alpha.organizationId,
              '00000000-0000-4000-8000-0000000000c3',
              alpha.itemId,
              beta.pilotId,
              alpha.aircraftId,
            ],
          ),
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const retained = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) =>
        transaction.query(
          `SELECT count(*)::integer AS count
             FROM droneworks.canonical_flights`,
        ),
    );
    expect(retained.rows[0]?.count).toBe(1);
  });

  it('keeps queue, dispatcher, app, and migration authorities separate', async () => {
    for (const user of [
      process.env.DRONEWORKS_PG_QUEUE_USER,
      process.env.DRONEWORKS_PG_DISPATCHER_USER,
    ]) {
      await useClient(user, async (client) => {
        await expect(
          client.query('SELECT * FROM droneworks.organizations'),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('SET ROLE droneworks_migrator'),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }

    await useClient(process.env.PGUSER, async (client) => {
      await expect(
        client.query('SET ROLE droneworks_migrator'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query('SELECT * FROM droneworks_ops.migration_runs'),
      ).rejects.toMatchObject({ code: '42501' });
    });

    await useClient(
      process.env.DRONEWORKS_PG_MIGRATION_USER,
      async (client) => {
        await expect(
          client.query('SELECT * FROM droneworks_ops.migration_runs'),
        ).rejects.toMatchObject({ code: '42501' });
        const ledger = await client.query(
          'SELECT * FROM droneworks_ops.find_migration($1)',
          [process.env.DRONEWORKS_PG_MIGRATION_ID],
        );
        expect(ledger.rows).toHaveLength(1);

        await client.query('SET ROLE droneworks_migrator');
        const ownerRead = await client.query(
          'SELECT count(*)::integer AS count FROM droneworks.organizations',
        );
        expect(ownerRead.rows[0]?.count).toBe(0);
        await client.query('RESET ROLE');
      },
    );

    await useClient(
      process.env.DRONEWORKS_PG_BOOTSTRAP_USER,
      async (client) => {
        const privileges = await client.query(
          `SELECT table_name, privilege_type
           FROM information_schema.role_table_grants
          WHERE table_schema = 'droneworks'
            AND grantee = 'droneworks_app'
          ORDER BY table_name, privilege_type`,
        );
        const deletes = privileges.rows
          .filter((row) => row.privilege_type === 'DELETE')
          .map((row) => row.table_name);
        expect(deletes).toEqual([
          'aircraft',
          'api_idempotency_requests',
          'canonical_flights',
          'import_batches',
          'import_items',
          'memberships',
          'organizations',
          'pilot_profiles',
        ]);
        expect(
          privileges.rows.some(
            (row) =>
              row.table_name === 'audit_events' &&
              row.privilege_type === 'UPDATE',
          ),
        ).toBe(false);
        expect(
          privileges.rows.some(
            (row) =>
              row.table_name === 'telemetry_objects' &&
              row.privilege_type === 'DELETE',
          ),
        ).toBe(false);
      },
    );
  });

  it('pins migration replay, checksum, ledger, and isolation digest', async () => {
    await useClient(
      process.env.DRONEWORKS_PG_MIGRATION_USER,
      async (client) => {
        const migrations = await loadReviewedMigrations();
        expect(migrations).toHaveLength(1);
        expect(migrations[0]).toMatchObject({
          id: process.env.DRONEWORKS_PG_MIGRATION_ID,
          sha256: process.env.DRONEWORKS_PG_MIGRATION_SHA256,
          isolationSha256: process.env.DRONEWORKS_PG_ISOLATION_SHA256,
        });

        const replay = await applyReviewedMigrations(
          client,
          new Date('2026-07-16T00:00:00.000Z'),
        );
        expect(replay).toEqual([
          {
            status: 'already_applied',
            migrationId: process.env.DRONEWORKS_PG_MIGRATION_ID,
            sha256: process.env.DRONEWORKS_PG_MIGRATION_SHA256,
            isolationSha256: process.env.DRONEWORKS_PG_ISOLATION_SHA256,
          },
        ]);

        await expect(
          applyReviewedMigration(client, {
            ...migrations[0],
            sql: `${migrations[0].sql}\n-- changed after review`,
          }),
        ).rejects.toBeInstanceOf(MigrationIntegrityError);
      },
    );

    await useClient(
      process.env.DRONEWORKS_PG_BOOTSTRAP_USER,
      async (client) => {
        const migrations = await loadReviewedMigrations();
        await client.query('BEGIN');
        try {
          await client.query(
            'ALTER TABLE droneworks.organizations NO FORCE ROW LEVEL SECURITY',
          );
          await expect(
            verifyIsolationContract(client, migrations[0]),
          ).rejects.toBeInstanceOf(IsolationContractError);
        } finally {
          await client.query('ROLLBACK');
        }
      },
    );
  });
});
