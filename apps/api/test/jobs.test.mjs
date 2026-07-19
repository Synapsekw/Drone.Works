import { createHash } from 'node:crypto';

import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createApplicationPool,
  ImportProcessingRepository,
  OrganizationAuthorizationRepository,
  RawUploadRepository,
  withOrganizationTransaction,
} from '@drone-works/database';
import {
  DispatcherRepository,
  processingDeadLetterQueueName,
  processingQueueName,
  ProcessingQueue,
  stableQueueJobId,
} from '@drone-works/jobs';

import { buildApi } from '../dist/app.js';
import { createIdentitySource, generatedPersonas } from '../dist/identity.js';
import { LoopbackImmutableObjectStore } from '../dist/loopback-object-store.js';

const { Pool } = pg;
const alphaOrganizationId = '00000000-0000-4000-8000-0000000000a1';
const alphaFlightId = '00000000-0000-4000-8000-0000000000aa';
const betaOrganizationId = '00000000-0000-4000-8000-0000000000b1';
const environment = {
  DRONE_WORKS_ENV: 'test',
  HOST: '127.0.0.1',
  LOCAL_IDENTITY_ENABLED: true,
  PORT: 1,
};

let app;
let appPool;
let dispatcher;
let imports;
let queue;
let queueBoss;
let queuePool;
const tokens = new Map();
let dispatchedImportId;
let dispatchedJobId;

const databaseConfiguration = () => ({
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
});

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function token(persona) {
  const cached = tokens.get(persona);
  if (cached) return cached;
  const response = await app.inject({
    method: 'POST',
    url: '/_local/generated-personas/select',
    payload: { persona },
  });
  expect(response.statusCode).toBe(200);
  const issued = response.json().token;
  tokens.set(persona, issued);
  return issued;
}

async function request(persona, options) {
  return app.inject({
    ...options,
    headers: {
      'x-drone-works-local-persona-token': await token(persona),
      ...options.headers,
    },
  });
}

async function completeUpload(content, suffix, persona = 'alpha_owner') {
  const declaration = await request(persona, {
    method: 'POST',
    url: `/api/v1/organizations/${alphaOrganizationId}/uploads`,
    headers: { 'idempotency-key': `jobs-declare-${suffix}` },
    payload: {
      client_file_id: `jobs-${suffix}`,
      original_filename: `generated-${suffix}.bin`,
      content_sha256: sha256(content),
      byte_size: content.byteLength,
      media_type: 'application/octet-stream',
    },
  });
  expect(declaration.statusCode).toBe(201);
  const importId = declaration.json().upload_id;
  const stored = await request(persona, {
    method: 'PUT',
    url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${importId}/content`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: content,
  });
  expect(stored.statusCode).toBe(200);
  const completion = await request(persona, {
    method: 'POST',
    url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${importId}/completion`,
    headers: { 'idempotency-key': `jobs-complete-${suffix}` },
    payload: { object_version_id: stored.json().object_version_id },
  });
  return {
    completion,
    importId,
    objectVersionId: stored.json().object_version_id,
  };
}

beforeAll(async () => {
  appPool = createApplicationPool({
    ...databaseConfiguration(),
    max: 1,
    user: 'droneworks_app',
  });
  queuePool = new Pool({
    ...databaseConfiguration(),
    max: 1,
    user: 'droneworks_queue',
  });
  const identitySource = createIdentitySource(environment);
  const organizations = new OrganizationAuthorizationRepository(appPool);
  imports = new ImportProcessingRepository(appPool);
  app = (
    await buildApi({
      environment,
      identitySource,
      imports,
      objectStore: new LoopbackImmutableObjectStore(
        process.env.OBJECT_INTERNAL_URL,
      ),
      organizations,
      uploads: new RawUploadRepository(appPool),
    })
  ).app;
  await organizations.putMembership(
    generatedPersonas.alpha_owner,
    alphaOrganizationId,
    generatedPersonas.alpha_viewer.userId,
    'viewer',
  );
  dispatcher = new DispatcherRepository(databaseConfiguration());
  queue = await ProcessingQueue.start(databaseConfiguration(), {
    expireInSeconds: 1,
    retryDelaySeconds: 0,
    retryLimit: 1,
    supervise: false,
  });
  queueBoss = new PgBoss({
    createSchema: false,
    ...databaseConfiguration(),
    schema: 'droneworks_jobs',
    schedule: false,
    supervise: false,
    user: 'droneworks_queue',
  });
  await queueBoss.start();
});

afterAll(async () => {
  await app?.close();
  await queueBoss?.stop({ graceful: true, timeout: 5_000 });
  await queue?.stop();
  await dispatcher?.close();
  await queuePool?.end();
  await appPool?.end();
});

describe.sequential('A07 atomic processing dispatch', () => {
  it('commits raw-source completion and one payload-free outbox reference atomically', async () => {
    const content = Buffer.from('atomic-jobs-success');
    const completed = await completeUpload(content, 'atomic-success');
    expect(completed.completion.statusCode).toBe(200);
    dispatchedImportId = completed.importId;

    const status = await request('alpha_owner', {
      method: 'GET',
      url: `/api/v1/organizations/${alphaOrganizationId}/imports/${completed.importId}`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      import_id: completed.importId,
      state: 'queued',
    });
    expect(JSON.stringify(status.json())).not.toContain('queue_job');

    const outbox = await queuePool.query(
      `SELECT organization_id, job_type, payload_version, resource_id, state
         FROM droneworks_jobs.outbox
        WHERE resource_id = $1`,
      [completed.importId],
    );
    expect(outbox.rows).toEqual([
      {
        organization_id: alphaOrganizationId,
        job_type: processingQueueName,
        payload_version: 1,
        resource_id: completed.importId,
        state: 'pending',
      },
    ]);
    expect(JSON.stringify(outbox.rows)).not.toContain('filename');
    expect(JSON.stringify(outbox.rows)).not.toContain('sha256');

    for (const persona of ['beta_owner', 'alpha_viewer']) {
      const denied = await request(persona, {
        method: 'GET',
        url: `/api/v1/organizations/${alphaOrganizationId}/imports/${completed.importId}`,
      });
      expect(denied.statusCode).toBe(404);
    }
  });

  it('rolls back domain and outbox state together and removes the unreferenced object', async () => {
    const content = Buffer.from('atomic-jobs-rollback');
    const failed = await completeUpload(content, 'atomic-rollback');
    expect(failed.completion.statusCode).toBe(500);
    const rows = await queuePool.query(
      'SELECT 1 FROM droneworks_jobs.outbox WHERE resource_id = $1',
      [failed.importId],
    );
    expect(rows.rowCount).toBe(0);
    await withOrganizationTransaction(
      appPool,
      alphaOrganizationId,
      async (transaction) => {
        const item = await transaction.query(
          `SELECT raw_source_id, state
             FROM droneworks.import_items
            WHERE id = $1`,
          [failed.importId],
        );
        expect(item.rows).toEqual([{ raw_source_id: null, state: 'uploaded' }]);
      },
    );
    const key = `organizations/${alphaOrganizationId}/raw-sources/${failed.importId}/revisions/${failed.importId}`;
    const head = await fetch(
      `${process.env.OBJECT_INTERNAL_URL}/objects/${encodeURIComponent(key)}?version_id=${failed.objectVersionId}`,
      { method: 'HEAD' },
    );
    expect(head.status).toBe(404);
  });

  it('deduplicates a post-send crash and rejects the stale dispatcher token', async () => {
    const observedAt = new Date();
    const first = await dispatcher.claim(observedAt, {
      leaseSeconds: 10,
      limit: 1,
    });
    expect(first.rows).toHaveLength(1);
    const leasedCancellation = await request('alpha_owner', {
      method: 'DELETE',
      url: `/api/v1/organizations/${alphaOrganizationId}/imports/${dispatchedImportId}`,
    });
    expect(leasedCancellation.statusCode).toBe(409);
    const firstJobId = await queue.sendClaim(first.rows[0]);
    const reclaimed = await dispatcher.claim(
      new Date(observedAt.valueOf() + 11_000),
      { leaseSeconds: 10, limit: 1 },
    );
    expect(reclaimed.rows[0].id).toBe(first.rows[0].id);
    expect(Number(reclaimed.rows[0].attempt_count)).toBe(2);
    const recoveredJobId = await queue.sendClaim(reclaimed.rows[0]);
    expect(recoveredJobId).toBe(firstJobId);
    expect(stableQueueJobId(alphaOrganizationId, first.rows[0].id)).toBe(
      firstJobId,
    );
    expect(
      await dispatcher.complete(
        reclaimed.rows[0],
        first.claimToken,
        firstJobId,
        new Date(),
      ),
    ).toBe(false);
    expect(
      await dispatcher.complete(
        reclaimed.rows[0],
        reclaimed.claimToken,
        recoveredJobId,
        new Date(),
      ),
    ).toBe(true);
    dispatchedJobId = recoveredJobId;
    expect((await queue.findJob(recoveredJobId)).data).toEqual({
      importItemId: dispatchedImportId,
      organizationId: alphaOrganizationId,
      schemaVersion: 1,
    });
  });

  it('retries safely, rejects malformed and Alpha/Beta-swapped payloads before handling', async () => {
    let attempts = 0;
    await expect(
      queue.processNext(imports, async ({ payload, target }) => {
        attempts += 1;
        expect(payload.organizationId).toBe(alphaOrganizationId);
        expect(target.importId).toBe(dispatchedImportId);
        throw new Error('generated transient worker failure');
      }),
    ).rejects.toThrow('generated transient worker failure');
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    const retried = await queue.processNext(imports, async () => {
      attempts += 1;
    });
    expect(retried).toEqual({
      jobId: dispatchedJobId,
      status: 'processed',
    });
    expect(attempts).toBe(2);

    const swappedId = await queueBoss.send(
      processingQueueName,
      {
        importItemId: dispatchedImportId,
        organizationId: betaOrganizationId,
        schemaVersion: 1,
      },
      { retryLimit: 0 },
    );
    let handlerCalls = 0;
    expect(
      await queue.processNext(imports, async () => {
        handlerCalls += 1;
      }),
    ).toEqual({ jobId: swappedId, status: 'not_found' });
    expect(handlerCalls).toBe(0);

    const malformedId = await queueBoss.send(
      processingQueueName,
      { importItemId: dispatchedImportId },
      { deadLetter: processingDeadLetterQueueName, retryLimit: 0 },
    );
    await expect(
      queue.processNext(imports, async () => undefined),
    ).rejects.toThrow('unexpected field');
    expect((await queue.findJob(malformedId)).state).toBe('failed');
  });

  it('recovers an abandoned lease and keeps cancelled API and queue work unclaimable', async () => {
    const abandonedId = await queueBoss.send(
      processingQueueName,
      {
        importItemId: dispatchedImportId,
        organizationId: alphaOrganizationId,
        schemaVersion: 1,
      },
      { expireInSeconds: 1, retryDelay: 0, retryLimit: 1 },
    );
    const [abandoned] = await queueBoss.fetch(processingQueueName, {
      includeMetadata: true,
    });
    expect(abandoned.id).toBe(abandonedId);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await queue.supervise();
    expect((await queue.findJob(abandonedId)).state).toBe('retry');
    await queue.cancel(abandonedId);
    expect((await queue.findJob(abandonedId)).state).toBe('cancelled');

    const pending = await completeUpload(
      Buffer.from('api-cancel-pending'),
      'api-cancel',
    );
    expect(pending.completion.statusCode).toBe(200);
    const cancelled = await request('alpha_owner', {
      method: 'DELETE',
      url: `/api/v1/organizations/${alphaOrganizationId}/imports/${pending.importId}`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().state).toBe('cancelled');
    const claim = await dispatcher.claim(new Date(), { limit: 100 });
    expect(claim.rows.map((row) => row.resource_id)).not.toContain(
      pending.importId,
    );
    const betaCancel = await request('beta_owner', {
      method: 'DELETE',
      url: `/api/v1/organizations/${alphaOrganizationId}/imports/${pending.importId}`,
    });
    expect(betaCancel.statusCode).toBe(404);
  });

  it('reloads every restartable processing stage and terminalizes failures once', async () => {
    const completed = await completeUpload(
      Buffer.from('restartable-worker-state'),
      'restartable-worker-state',
    );
    expect(completed.completion.statusCode).toBe(200);

    for (const stage of ['detecting', 'parsing', 'normalizing']) {
      expect(
        await imports.markStage(alphaOrganizationId, completed.importId, stage),
      ).toBe(true);
      expect(
        await imports.loadForJob(alphaOrganizationId, completed.importId),
      ).toMatchObject({
        importId: completed.importId,
        objectVersionId: completed.objectVersionId,
        state: stage,
      });
    }
    expect(
      await imports.fail(
        alphaOrganizationId,
        completed.importId,
        'invalid_source',
      ),
    ).toBe(true);
    expect(
      await imports.fail(
        alphaOrganizationId,
        completed.importId,
        'invalid_source',
      ),
    ).toBe(false);
    expect(
      await imports.loadForJob(alphaOrganizationId, completed.importId),
    ).toBeNull();
    const status = await request('alpha_owner', {
      method: 'GET',
      url: `/api/v1/organizations/${alphaOrganizationId}/imports/${completed.importId}`,
    });
    expect(status.json()).toMatchObject({
      failure_reason: 'corrupt',
      state: 'failed',
    });
  });

  it('returns payload-free aggregate metrics and clears reused organization context', async () => {
    const outboxMetrics = await dispatcher.metrics(new Date());
    const queueMetrics = await queue.metrics();
    expect(outboxMetrics.cancelledCount).toBeGreaterThanOrEqual(1);
    expect(outboxMetrics.retryCount).toBeGreaterThanOrEqual(1);
    expect(queueMetrics.deadLetterCount).toBeGreaterThanOrEqual(1);
    for (const metrics of [outboxMetrics, queueMetrics]) {
      const serialized = JSON.stringify(metrics);
      expect(serialized).not.toContain(alphaOrganizationId);
      expect(serialized).not.toContain(dispatchedImportId);
    }

    const alphaPid = await withOrganizationTransaction(
      appPool,
      alphaOrganizationId,
      async (transaction) =>
        (await transaction.query('SELECT pg_backend_pid()::integer AS pid'))
          .rows[0].pid,
    );
    await imports.loadForJob(betaOrganizationId, dispatchedImportId);
    const cleared = await appPool.query(
      `SELECT pg_backend_pid()::integer AS pid,
              current_setting('app.organization_id', true) AS organization_id,
              (SELECT count(*)::integer FROM droneworks.import_items) AS count`,
    );
    expect(cleared.rows[0].pid).toBe(alphaPid);
    expect([null, '']).toContain(cleared.rows[0].organization_id);
    expect(cleared.rows[0].count).toBe(0);
  });

  it('projects a result flight and redacted actionable failure categories', async () => {
    const completed = await completeUpload(
      Buffer.from('web-status-projection'),
      'web-status-projection',
    );
    await withOrganizationTransaction(
      appPool,
      alphaOrganizationId,
      async (transaction) => {
        await transaction.query(
          `UPDATE droneworks.import_items
              SET state = 'completed', result_flight_id = $3, updated_at = now()
            WHERE organization_id = $1 AND id = $2`,
          [alphaOrganizationId, completed.importId, alphaFlightId],
        );
      },
    );
    const result = await request('alpha_owner', {
      method: 'GET',
      url: `/api/v1/organizations/${alphaOrganizationId}/imports/${completed.importId}`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      failure_reason: null,
      import_id: completed.importId,
      result_flight_id: alphaFlightId,
      state: 'completed',
    });

    const failureCases = [
      ['unsupported_format', 'unsupported'],
      ['invalid_or_corrupt_prefix', 'corrupt'],
      ['truncated_source', 'truncated'],
      ['key_service_unavailable', 'key_unavailable'],
      ['parser_internal_error', 'processing_failed'],
    ];
    for (const [internalCode, publicReason] of failureCases) {
      await withOrganizationTransaction(
        appPool,
        alphaOrganizationId,
        async (transaction) => {
          await transaction.query(
            `UPDATE droneworks.import_items
                SET state = 'failed', failure_code = $3,
                    result_flight_id = NULL, updated_at = now()
              WHERE organization_id = $1 AND id = $2`,
            [alphaOrganizationId, completed.importId, internalCode],
          );
        },
      );
      const failed = await request('alpha_owner', {
        method: 'GET',
        url: `/api/v1/organizations/${alphaOrganizationId}/imports/${completed.importId}`,
      });
      expect(failed.statusCode).toBe(200);
      expect(failed.json()).toMatchObject({
        failure_reason: publicReason,
        result_flight_id: null,
        state: 'failed',
      });
      expect(JSON.stringify(failed.json())).not.toContain(internalCode);
    }

    const denied = await request('beta_owner', {
      method: 'GET',
      url: `/api/v1/organizations/${alphaOrganizationId}/imports/${completed.importId}`,
    });
    expect(denied.statusCode).toBe(404);
  });
});
