import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { ClientBase } from 'pg';

const migrations = [
  {
    migrationId: '001_jobs_foundation',
    expectedSha256:
      '92fd33582b7bf5a04063e4aaeaf2f55423c35416247a28b513ff0b6c392fffe3',
    migrationUrl: new URL(
      '../sql/jobs/001_jobs_foundation.sql',
      import.meta.url,
    ),
  },
  {
    migrationId: '002_import_retry',
    expectedSha256:
      '830a9963dcba51c0c3fa3c79f3e3fbeebbe57408c0ea34dcbf15be3487836c6d',
    migrationUrl: new URL('../sql/jobs/002_import_retry.sql', import.meta.url),
  },
] as const;

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
  const reviewed = await Promise.all(
    migrations.map(async (migration) => ({
      ...migration,
      sql: await readFile(migration.migrationUrl, 'utf8'),
    })),
  );
  for (const migration of reviewed) {
    if (sha256(migration.sql) !== migration.expectedSha256) {
      throw new JobsMigrationIntegrityError();
    }
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
    let result: JobsMigrationResult | null = null;
    for (const migration of reviewed) {
      const existing = await client.query<{ readonly sha256: string }>(
        `SELECT sha256
           FROM droneworks_jobs.reviewed_migration_runs
          WHERE migration_id = $1`,
        [migration.migrationId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== migration.expectedSha256) {
          throw new JobsMigrationIntegrityError();
        }
        result = {
          migrationId: migration.migrationId,
          status: 'already_applied',
        };
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO droneworks_jobs.reviewed_migration_runs (
           migration_id, sha256, applied_at
         ) VALUES ($1, $2, $3)`,
        [migration.migrationId, migration.expectedSha256, appliedAt],
      );
      result = { migrationId: migration.migrationId, status: 'applied' };
    }
    await client.query('COMMIT');
    if (!result) throw new Error('No reviewed jobs migrations are configured.');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
