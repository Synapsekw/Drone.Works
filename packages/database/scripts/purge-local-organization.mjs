import pg from 'pg';

const { Pool } = pg;
const organizationId = process.argv[2];
const objectBaseUrl = process.env.OBJECT_INTERNAL_URL;
if (
  !organizationId ||
  !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(organizationId) ||
  !objectBaseUrl
) {
  throw new Error('A generated organization and object service are required.');
}
const baseUrl = new URL(objectBaseUrl);
if (
  baseUrl.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname)
) {
  throw new Error('Local purge requires a loopback object service.');
}

const pool = new Pool({
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  max: 1,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
});

function objectUrl(key, versionId) {
  const url = new URL(`/objects/${encodeURIComponent(key)}`, baseUrl);
  url.searchParams.set('version_id', versionId);
  return url;
}

try {
  const raw = await pool.query(
    `SELECT id, object_revision_id
       FROM droneworks.raw_sources
      WHERE organization_id = $1`,
    [organizationId],
  );
  const telemetry = await pool.query(
    `SELECT flight_revision_id, object_revision_id
       FROM droneworks.telemetry_objects
      WHERE organization_id = $1`,
    [organizationId],
  );
  const objects = [
    ...raw.rows.map((row) => ({
      key: `organizations/${organizationId}/raw-sources/${row.id}/revisions/${row.id}`,
      versionId: row.object_revision_id,
    })),
    ...telemetry.rows.map((row) => ({
      key: `organizations/${organizationId}/flight-revisions/${row.flight_revision_id}/telemetry-v1`,
      versionId: row.object_revision_id,
    })),
  ];
  for (const object of objects) {
    const response = await fetch(objectUrl(object.key, object.versionId), {
      method: 'DELETE',
    });
    if (![204, 404].includes(response.status)) {
      throw new Error('An exact generated object could not be purged.');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE droneworks.import_items
          SET result_flight_id = NULL,
              duplicate_of_flight_id = NULL
        WHERE organization_id = $1`,
      [organizationId],
    );
    for (const table of [
      'keychain_cache_entries',
      'keychain_authorizations',
      'telemetry_objects',
      'flight_revisions',
      'canonical_flights',
      'aircraft_identifiers',
      'import_attempts',
      'import_items',
      'import_batches',
      'raw_sources',
      'api_idempotency_requests',
      'audit_events',
      'outbox_events',
      'aircraft',
      'pilot_profiles',
      'memberships',
    ]) {
      await client.query(
        `DELETE FROM droneworks.${table} WHERE organization_id = $1`,
        [organizationId],
      );
    }
    await client.query('DELETE FROM droneworks.organizations WHERE id = $1', [
      organizationId,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const tables = await pool.query(
    `SELECT table_name
       FROM information_schema.columns
      WHERE table_schema = 'droneworks'
        AND column_name = 'organization_id'
      ORDER BY table_name`,
  );
  let remainingRows = 0;
  for (const { table_name: table } of tables.rows) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected table name.');
    const result = await pool.query(
      `SELECT count(*)::integer AS count FROM droneworks.${table} WHERE organization_id = $1`,
      [organizationId],
    );
    remainingRows += result.rows[0].count;
  }
  for (const object of objects) {
    const response = await fetch(objectUrl(object.key, object.versionId), {
      method: 'HEAD',
    });
    if (response.status !== 404) {
      throw new Error('A generated object remained after purge.');
    }
  }
  if (remainingRows !== 0) {
    throw new Error('Generated organization rows remained after purge.');
  }
  process.stdout.write(
    `${JSON.stringify({ database_rows: remainingRows, object_versions: objects.length, status: 'absent' })}\n`,
  );
} finally {
  await pool.end();
}
