import { createHash, randomUUID } from 'node:crypto';

import pg from 'pg';
import { PgBoss, type JobWithMetadata } from 'pg-boss';

import type {
  ImportJobTarget,
  ImportProcessingRepository,
} from '@drone-works/database';

const { Pool } = pg;

export const processingQueueName = 'raw-source-processing-v1';
export const processingDeadLetterQueueName =
  'raw-source-processing-dead-letter-v1';
export const processingPayloadVersion = 1;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProcessingJobPayload {
  readonly importItemId: string;
  readonly organizationId: string;
  readonly schemaVersion: 1;
}

export interface ClaimedOutbox {
  readonly attempt_count: number;
  readonly created_at: Date;
  readonly id: string;
  readonly job_type: typeof processingQueueName;
  readonly organization_id: string;
  readonly payload_version: 1;
  readonly resource_id: string;
}

export interface OutboxMetrics {
  readonly cancelledCount: number;
  readonly claimedCount: number;
  readonly oldestPendingSeconds: number;
  readonly pendingCount: number;
  readonly retryCount: number;
}

export interface QueueMetrics {
  readonly activeCount: number;
  readonly deadLetterCount: number;
  readonly failedCount: number;
  readonly readyCount: number;
  readonly retryCount: number;
}

export interface JobsDatabaseConfiguration {
  readonly database: string;
  readonly host: string;
  readonly port: number;
}

export interface ProcessingQueueOptions {
  readonly expireInSeconds?: number;
  readonly retryDelaySeconds?: number;
  readonly retryLimit?: number;
  readonly supervise?: boolean;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new TypeError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function processingPayload(value: unknown): ProcessingJobPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The processing job payload must be an object.');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const expected = ['importItemId', 'organizationId', 'schemaVersion'];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      'The processing job payload contains an unexpected field.',
    );
  }
  if (input.schemaVersion !== processingPayloadVersion) {
    throw new TypeError('The processing job payload version is unsupported.');
  }
  return Object.freeze({
    importItemId: requireUuid(input.importItemId, 'importItemId'),
    organizationId: requireUuid(input.organizationId, 'organizationId'),
    schemaVersion: processingPayloadVersion,
  });
}

export function stableQueueJobId(
  organizationId: string,
  outboxId: string,
): string {
  const bytes = createHash('sha256')
    .update(
      `droneworks-outbox-v1\0${requireUuid(organizationId, 'organizationId')}\0${requireUuid(outboxId, 'outboxId')}`,
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireClaim(value: ClaimedOutbox): ClaimedOutbox {
  if (
    value.job_type !== processingQueueName ||
    Number(value.payload_version) !== processingPayloadVersion
  ) {
    throw new TypeError('The claimed outbox reference is not allowlisted.');
  }
  requireUuid(value.organization_id, 'organizationId');
  requireUuid(value.id, 'outboxId');
  requireUuid(value.resource_id, 'resourceId');
  return value;
}

export class DispatcherRepository {
  readonly #pool: pg.Pool;

  constructor(configuration: JobsDatabaseConfiguration) {
    this.#pool = new Pool({
      database: configuration.database,
      host: configuration.host,
      max: 2,
      port: configuration.port,
      user: 'droneworks_dispatcher',
    });
  }

  async claim(
    now: Date,
    options: { readonly leaseSeconds?: number; readonly limit?: number } = {},
  ): Promise<{
    readonly claimToken: string;
    readonly rows: readonly ClaimedOutbox[];
  }> {
    const claimToken = randomUUID();
    const result = await this.#pool.query<ClaimedOutbox>(
      `SELECT * FROM droneworks_jobs.claim_outbox($1, $2, $3, $4)`,
      [claimToken, now, options.leaseSeconds ?? 30, options.limit ?? 10],
    );
    return { claimToken, rows: result.rows };
  }

  async complete(
    claim: ClaimedOutbox,
    claimToken: string,
    queueJobId: string,
    dispatchedAt: Date,
  ): Promise<boolean> {
    const row = requireClaim(claim);
    const result = await this.#pool.query<{ readonly completed: boolean }>(
      `SELECT droneworks_jobs.complete_outbox($1, $2, $3, $4, $5)
         AS completed`,
      [
        row.organization_id,
        row.id,
        requireUuid(claimToken, 'claimToken'),
        requireUuid(queueJobId, 'queueJobId'),
        dispatchedAt,
      ],
    );
    return result.rows[0]?.completed ?? false;
  }

  async release(
    claim: ClaimedOutbox,
    claimToken: string,
    availableAt: Date,
  ): Promise<boolean> {
    const row = requireClaim(claim);
    const result = await this.#pool.query<{ readonly released: boolean }>(
      `SELECT droneworks_jobs.release_outbox($1, $2, $3, $4)
         AS released`,
      [
        row.organization_id,
        row.id,
        requireUuid(claimToken, 'claimToken'),
        availableAt,
      ],
    );
    return result.rows[0]?.released ?? false;
  }

  async metrics(now = new Date()): Promise<OutboxMetrics> {
    const result = await this.#pool.query<{
      readonly cancelled_count: string;
      readonly claimed_count: string;
      readonly oldest_pending_seconds: number;
      readonly pending_count: string;
      readonly retry_count: string;
    }>('SELECT * FROM droneworks_jobs.outbox_metrics($1)', [now]);
    const row = result.rows[0];
    return {
      cancelledCount: Number(row?.cancelled_count ?? 0),
      claimedCount: Number(row?.claimed_count ?? 0),
      oldestPendingSeconds: Number(row?.oldest_pending_seconds ?? 0),
      pendingCount: Number(row?.pending_count ?? 0),
      retryCount: Number(row?.retry_count ?? 0),
    };
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export class ProcessingQueue {
  readonly #boss: PgBoss;
  readonly #expireInSeconds: number;
  readonly #retryDelaySeconds: number;
  readonly #retryLimit: number;

  private constructor(boss: PgBoss, options: ProcessingQueueOptions) {
    this.#boss = boss;
    this.#expireInSeconds = options.expireInSeconds ?? 60;
    this.#retryDelaySeconds = options.retryDelaySeconds ?? 5;
    this.#retryLimit = options.retryLimit ?? 3;
  }

  static async start(
    configuration: JobsDatabaseConfiguration,
    options: ProcessingQueueOptions = {},
  ): Promise<ProcessingQueue> {
    const boss = new PgBoss({
      createSchema: false,
      database: configuration.database,
      host: configuration.host,
      port: configuration.port,
      schema: 'droneworks_jobs',
      schedule: false,
      supervise: options.supervise ?? true,
      user: 'droneworks_queue',
    });
    await boss.start();
    await boss.createQueue(processingDeadLetterQueueName);
    await boss.createQueue(processingQueueName, {
      deadLetter: processingDeadLetterQueueName,
      retryDelay: options.retryDelaySeconds ?? 5,
      retryLimit: options.retryLimit ?? 3,
    });
    return new ProcessingQueue(boss, options);
  }

  async sendClaim(claim: ClaimedOutbox): Promise<string> {
    const row = requireClaim(claim);
    const payload = processingPayload({
      importItemId: row.resource_id,
      organizationId: row.organization_id,
      schemaVersion: processingPayloadVersion,
    });
    const jobId = stableQueueJobId(row.organization_id, row.id);
    const sent = await this.#boss.send(processingQueueName, payload, {
      deadLetter: processingDeadLetterQueueName,
      expireInSeconds: this.#expireInSeconds,
      id: jobId,
      retryBackoff: true,
      retryDelay: this.#retryDelaySeconds,
      retryLimit: this.#retryLimit,
    });
    if (sent && sent !== jobId) {
      throw new Error('pg-boss returned an unexpected stable job ID.');
    }
    if (!sent) {
      const existing = await this.#boss.getJobById<ProcessingJobPayload>(
        processingQueueName,
        jobId,
      );
      const existingPayload = existing
        ? processingPayload(existing.data)
        : undefined;
      if (
        !existingPayload ||
        existingPayload.importItemId !== payload.importItemId ||
        existingPayload.organizationId !== payload.organizationId ||
        existingPayload.schemaVersion !== payload.schemaVersion
      ) {
        throw new Error('Queue deduplication retained different job data.');
      }
    }
    return jobId;
  }

  async processNext(
    imports: Pick<ImportProcessingRepository, 'loadForJob'>,
    handler: (input: {
      readonly jobId: string;
      readonly payload: ProcessingJobPayload;
      readonly target: ImportJobTarget;
    }) => Promise<unknown>,
  ): Promise<{
    readonly jobId: string;
    readonly status: 'not_found' | 'processed';
  } | null> {
    const [job] = await this.#boss.fetch<unknown>(processingQueueName, {
      includeMetadata: true,
    });
    if (!job) return null;
    try {
      const payload = processingPayload(job.data);
      const target = await imports.loadForJob(
        payload.organizationId,
        payload.importItemId,
      );
      if (!target) {
        await this.#boss.complete(processingQueueName, job.id, {
          status: 'not_found',
        });
        return { jobId: job.id, status: 'not_found' };
      }
      await handler({ jobId: job.id, payload, target });
      await this.#boss.complete(processingQueueName, job.id, {
        status: 'processed',
      });
      return { jobId: job.id, status: 'processed' };
    } catch (error) {
      await this.#boss.fail(processingQueueName, job.id, {
        error: error instanceof Error ? error.name : 'JobError',
      });
      throw error;
    }
  }

  async cancel(jobId: string): Promise<void> {
    await this.#boss.cancel(processingQueueName, requireUuid(jobId, 'jobId'));
  }

  async supervise(): Promise<void> {
    await this.#boss.supervise(processingQueueName);
  }

  async findJob(
    jobId: string,
  ): Promise<JobWithMetadata<ProcessingJobPayload> | null> {
    return this.#boss.getJobById(
      processingQueueName,
      requireUuid(jobId, 'jobId'),
    );
  }

  async metrics(): Promise<QueueMetrics> {
    const [queueStats, deadLetterStats, jobs] = await Promise.all([
      this.#boss.getQueueStats(processingQueueName, { force: true }),
      this.#boss.getQueueStats(processingDeadLetterQueueName, { force: true }),
      this.#boss.findJobs(processingQueueName),
    ]);
    const queue = queueStats[0];
    const deadLetter = deadLetterStats[0];
    return {
      activeCount: queue?.activeCount ?? 0,
      deadLetterCount: deadLetter?.totalCount ?? 0,
      failedCount: queue?.failedCount ?? 0,
      readyCount: queue?.readyCount ?? 0,
      retryCount: jobs.filter((job) => job.state === 'retry').length,
    };
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true, timeout: 5_000 });
  }
}

export async function dispatchOnce(
  dispatcher: DispatcherRepository,
  queue: ProcessingQueue,
  now = new Date(),
): Promise<number> {
  const claimed = await dispatcher.claim(now);
  let completed = 0;
  for (const row of claimed.rows) {
    try {
      const queueJobId = await queue.sendClaim(row);
      if (await dispatcher.complete(row, claimed.claimToken, queueJobId, now)) {
        completed += 1;
      }
    } catch (error) {
      await dispatcher.release(
        row,
        claimed.claimToken,
        new Date(now.valueOf() + 5_000),
      );
      throw error;
    }
  }
  return completed;
}
