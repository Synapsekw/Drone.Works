import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { ClientBase } from 'pg';

const migrationId = '001_jobs_foundation';
const expectedSha256 =
  '92fd33582b7bf5a04063e4aaeaf2f55423c35416247a28b513ff0b6c392fffe3';
const migrationUrl = new URL(
  '../sql/jobs/001_jobs_foundation.sql',
  import.meta.url,
);

export interface JobsMigrationResult {
  readonly migrationId: string;
  readonly status: 'applied' | 'already_applied';
}

export class JobsMigrationIntegrityError extends Error {
  constructor() {
    super('The reviewed jobs migration does not match its checksum.');
    this.name = 'JobsMigrationIntegrityError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function applyReviewedJobsMigration(
  client: Pick<ClientBase, 'query'>,
  appliedAt = new Date(),
): Promise<JobsMigrationResult> {
  const sql = await readFile(migrationUrl, 'utf8');
  if (sha256(sql) !== expectedSha256) {
    throw new JobsMigrationIntegrityError();
  }

  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(
         'droneworks:reviewed-jobs-migrations', 0
       ))`,
    );
    const role = await client.query<{ readonly role: string }>(
      'SELECT current_user AS role',
    );
    if (role.rows[0]?.role !== 'droneworks_queue') {
      throw new Error('Jobs migrations require the queue schema owner.');
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS droneworks_jobs.reviewed_migration_runs (
        migration_id text PRIMARY KEY,
        sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL
      )
    `);
    const existing = await client.query<{ readonly sha256: string }>(
      `SELECT sha256
         FROM droneworks_jobs.reviewed_migration_runs
        WHERE migration_id = $1`,
      [migrationId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].sha256 !== expectedSha256) {
        throw new JobsMigrationIntegrityError();
      }
      await client.query('COMMIT');
      return { migrationId, status: 'already_applied' };
    }
    await client.query(sql);
    await client.query(
      `INSERT INTO droneworks_jobs.reviewed_migration_runs (
         migration_id, sha256, applied_at
       ) VALUES ($1, $2, $3)`,
      [migrationId, expectedSha256, appliedAt],
    );
    await client.query('COMMIT');
    return { migrationId, status: 'applied' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
