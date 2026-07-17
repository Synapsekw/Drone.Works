import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createApplicationPool,
  OrganizationAuthorizationRepository,
  RawUploadRepository,
  withOrganizationTransaction,
} from '@drone-works/database';

import { buildApi } from '../dist/app.js';
import { createIdentitySource, generatedPersonas } from '../dist/identity.js';
import { LoopbackImmutableObjectStore } from '../dist/loopback-object-store.js';

const alphaOrganizationId = '00000000-0000-4000-8000-0000000000a1';
const betaOrganizationId = '00000000-0000-4000-8000-0000000000b1';
const environment = {
  DRONE_WORKS_ENV: 'test',
  HOST: '127.0.0.1',
  LOCAL_IDENTITY_ENABLED: true,
  PORT: 1,
};

let app;
let pool;
const tokens = new Map();

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

async function declare(persona, content, suffix, overrides = {}) {
  return request(persona, {
    method: 'POST',
    url: `/api/v1/organizations/${alphaOrganizationId}/uploads`,
    headers: { 'idempotency-key': `declare-${suffix}` },
    payload: {
      client_file_id: `client-${suffix}`,
      original_filename: `../generated-${suffix}.bin`,
      content_sha256: sha256(content),
      byte_size: content.byteLength,
      media_type: 'application/octet-stream',
      ...overrides,
    },
  });
}

async function putContent(persona, uploadId, content) {
  return request(persona, {
    method: 'PUT',
    url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${uploadId}/content`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: content,
  });
}

beforeAll(async () => {
  pool = createApplicationPool({
    database: process.env.PGDATABASE,
    host: process.env.PGHOST,
    max: 1,
    port: Number(process.env.PGPORT),
    user: 'droneworks_app',
  });
  const identitySource = createIdentitySource(environment);
  const organizations = new OrganizationAuthorizationRepository(pool);
  const uploads = new RawUploadRepository(pool);
  app = (
    await buildApi({
      environment,
      identitySource,
      objectStore: new LoopbackImmutableObjectStore(
        process.env.OBJECT_INTERNAL_URL,
      ),
      organizations,
      uploads,
    })
  ).app;
  for (const [persona, role] of [
    ['alpha_admin', 'admin'],
    ['alpha_pilot', 'pilot'],
    ['alpha_viewer', 'viewer'],
  ]) {
    await organizations.putMembership(
      generatedPersonas.alpha_owner,
      alphaOrganizationId,
      generatedPersonas[persona].userId,
      role,
    );
  }
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.sequential('A06 immutable raw upload', () => {
  it('enforces declaration validation, role rules, idempotency, and redacted metadata', async () => {
    const content = Buffer.from('role-matrix-upload');
    for (const persona of ['alpha_owner', 'alpha_admin', 'alpha_pilot']) {
      const response = await declare(persona, content, `role-${persona}`);
      expect(response.statusCode).toBe(201);
      expect(response.json()).not.toHaveProperty('object_key');
      expect(response.json()).not.toHaveProperty('upload_url');
    }
    expect(
      (await declare('alpha_viewer', content, 'role-viewer')).statusCode,
    ).toBe(404);

    const first = await declare('alpha_owner', content, 'idempotent');
    const retry = await declare('alpha_owner', content, 'idempotent');
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    const conflict = await declare(
      'alpha_owner',
      Buffer.from('different-input'),
      'idempotent',
    );
    expect(conflict.statusCode).toBe(409);

    for (const overrides of [
      { object_key: 'browser/owned/key' },
      { media_type: 'text/csv' },
      { byte_size: 33_554_433 },
      { client_file_id: '   ' },
    ]) {
      expect(
        (await declare('alpha_owner', content, crypto.randomUUID(), overrides))
          .statusCode,
      ).toBe(400);
    }

    await withOrganizationTransaction(
      pool,
      alphaOrganizationId,
      async (transaction) => {
        const stored = await transaction.query(
          `SELECT original_filename
             FROM droneworks.import_items
            WHERE id = $1`,
          [first.json().upload_id],
        );
        expect(stored.rows[0].original_filename).toBe(
          'generated-idempotent.bin',
        );
        const audits = await transaction.query(
          `SELECT metadata
             FROM droneworks.audit_events
            WHERE action LIKE 'raw_upload.%'`,
        );
        expect(audits.rows.length).toBeGreaterThan(0);
        for (const audit of audits.rows) {
          expect(audit.metadata).toEqual({ item_count: 1 });
        }
        expect(JSON.stringify(audits.rows)).not.toContain('generated-');
        const outbox = await transaction.query(
          'SELECT count(*)::integer AS count FROM droneworks.outbox_events',
        );
        expect(outbox.rows[0].count).toBe(1);
      },
    );
  });

  it('stores checksum-bound content once and returns the same exact version on retry', async () => {
    const content = Buffer.from('immutable-content');
    const declaration = await declare('alpha_owner', content, 'immutable');
    const uploadId = declaration.json().upload_id;
    const first = await putContent('alpha_owner', uploadId, content);
    const retry = await putContent('alpha_owner', uploadId, content);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(first.json()).not.toHaveProperty('object_key');

    const wrongChecksum = await declare(
      'alpha_owner',
      content,
      'wrong-checksum',
      { content_sha256: '0'.repeat(64) },
    );
    expect(
      (await putContent('alpha_owner', wrongChecksum.json().upload_id, content))
        .statusCode,
    ).toBe(409);
  });

  it('refuses different bytes at an already occupied server-derived key', async () => {
    const expected = Buffer.from('expected-content');
    const declaration = await declare('alpha_owner', expected, 'collision');
    const uploadId = declaration.json().upload_id;
    const key = `organizations/${alphaOrganizationId}/raw-sources/${uploadId}/revisions/${uploadId}`;
    const other = Buffer.from('other-content---');
    const seeded = await fetch(
      `${process.env.OBJECT_INTERNAL_URL}/objects/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-content-sha256': sha256(other),
        },
        body: other,
      },
    );
    expect(seeded.status).toBe(201);
    expect(
      (await putContent('alpha_owner', uploadId, expected)).statusCode,
    ).toBe(409);
  });

  it('completes only the verified exact version and denies Beta exact IDs', async () => {
    const content = Buffer.from('complete-raw-upload');
    const declaration = await declare('alpha_owner', content, 'complete');
    const uploadId = declaration.json().upload_id;
    const stored = await putContent('alpha_owner', uploadId, content);
    const completionOptions = {
      method: 'POST',
      url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${uploadId}/completion`,
      headers: { 'idempotency-key': 'complete-exact' },
      payload: { object_version_id: stored.json().object_version_id },
    };
    const completed = await request('alpha_owner', completionOptions);
    const retry = await request('alpha_owner', completionOptions);
    expect(completed.statusCode).toBe(200);
    expect(retry.json()).toEqual(completed.json());
    expect(completed.json()).toMatchObject({
      upload_id: uploadId,
      raw_source_id: uploadId,
      state: 'completed',
      content_sha256: sha256(content),
    });

    for (const path of [
      `/api/v1/organizations/${alphaOrganizationId}/uploads/${uploadId}`,
      `/api/v1/organizations/${alphaOrganizationId}/uploads/${uploadId}/content`,
      `/api/v1/organizations/${alphaOrganizationId}/uploads/${uploadId}/completion`,
    ]) {
      const denied = await request('beta_owner', {
        method: path.endsWith('/content')
          ? 'PUT'
          : path.endsWith('/completion')
            ? 'POST'
            : 'GET',
        url: path,
        headers: path.endsWith('/content')
          ? { 'content-type': 'application/octet-stream' }
          : { 'idempotency-key': 'beta-denied' },
        payload: path.endsWith('/content')
          ? content
          : path.endsWith('/completion')
            ? { object_version_id: stored.json().object_version_id }
            : undefined,
      });
      expect(denied.statusCode).toBe(404);
    }

    const betaOrganization = await request('beta_owner', {
      method: 'GET',
      url: `/api/v1/organizations/${betaOrganizationId}/uploads/${uploadId}`,
    });
    expect(betaOrganization.statusCode).toBe(404);
  });

  it('reuses one retained raw source for an exact file re-upload and deletes the redundant object', async () => {
    const content = Buffer.from('exact-file-reupload');
    const firstDeclaration = await declare(
      'alpha_owner',
      content,
      'exact-file-first',
    );
    const firstUploadId = firstDeclaration.json().upload_id;
    const firstStored = await putContent('alpha_owner', firstUploadId, content);
    const firstCompleted = await request('alpha_owner', {
      method: 'POST',
      url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${firstUploadId}/completion`,
      headers: { 'idempotency-key': 'exact-file-first-complete' },
      payload: { object_version_id: firstStored.json().object_version_id },
    });
    expect(firstCompleted.statusCode).toBe(200);

    const secondDeclaration = await declare(
      'alpha_owner',
      content,
      'exact-file-second',
    );
    const secondUploadId = secondDeclaration.json().upload_id;
    const secondStored = await putContent(
      'alpha_owner',
      secondUploadId,
      content,
    );
    const secondCompleted = await request('alpha_owner', {
      method: 'POST',
      url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${secondUploadId}/completion`,
      headers: { 'idempotency-key': 'exact-file-second-complete' },
      payload: { object_version_id: secondStored.json().object_version_id },
    });
    expect(secondCompleted.statusCode).toBe(200);
    expect(secondCompleted.json()).toMatchObject({
      object_version_id: firstStored.json().object_version_id,
      raw_source_id: firstUploadId,
      upload_id: secondUploadId,
    });

    const secondKey = `organizations/${alphaOrganizationId}/raw-sources/${secondUploadId}/revisions/${secondUploadId}`;
    const redundantObject = await fetch(
      `${process.env.OBJECT_INTERNAL_URL}/objects/${encodeURIComponent(secondKey)}?version_id=${secondStored.json().object_version_id}`,
      { method: 'HEAD' },
    );
    expect(redundantObject.status).toBe(404);
    await withOrganizationTransaction(
      pool,
      alphaOrganizationId,
      async (transaction) => {
        const sources = await transaction.query(
          `SELECT count(*)::integer AS count
             FROM droneworks.raw_sources
            WHERE content_sha256 = $1`,
          [sha256(content)],
        );
        expect(sources.rows[0].count).toBe(1);
        const items = await transaction.query(
          `SELECT id, raw_source_id
             FROM droneworks.import_items
            WHERE id = ANY($1::uuid[])
            ORDER BY id`,
          [[firstUploadId, secondUploadId]],
        );
        expect(items.rows.map((row) => row.raw_source_id)).toEqual([
          firstUploadId,
          firstUploadId,
        ]);
      },
    );
  });

  it('deletes the exact unreferenced object when database completion rolls back', async () => {
    const content = Buffer.from('rollback-raw-upload');
    const declaration = await declare('alpha_owner', content, 'rollback');
    const uploadId = declaration.json().upload_id;
    const stored = await putContent('alpha_owner', uploadId, content);
    const failed = await request('alpha_owner', {
      method: 'POST',
      url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${uploadId}/completion`,
      headers: { 'idempotency-key': 'complete-rollback' },
      payload: { object_version_id: stored.json().object_version_id },
    });
    expect(failed.statusCode).toBe(500);
    const key = `organizations/${alphaOrganizationId}/raw-sources/${uploadId}/revisions/${uploadId}`;
    const head = await fetch(
      `${process.env.OBJECT_INTERNAL_URL}/objects/${encodeURIComponent(key)}?version_id=${stored.json().object_version_id}`,
      { method: 'HEAD' },
    );
    expect(head.status).toBe(404);
    const status = await request('alpha_owner', {
      method: 'GET',
      url: `/api/v1/organizations/${alphaOrganizationId}/uploads/${uploadId}`,
    });
    expect(status.json()).toMatchObject({
      raw_source_id: null,
      object_version_id: null,
      state: 'declared',
    });
  });

  it('rechecks membership and clears the one pooled connection between organizations', async () => {
    const content = Buffer.from('removed-membership');
    const declaration = await declare('alpha_pilot', content, 'removed');
    expect(declaration.statusCode).toBe(201);
    const organizations = new OrganizationAuthorizationRepository(pool);
    await organizations.removeMembership(
      generatedPersonas.alpha_owner,
      alphaOrganizationId,
      generatedPersonas.alpha_pilot.userId,
    );
    expect(
      (await putContent('alpha_pilot', declaration.json().upload_id, content))
        .statusCode,
    ).toBe(404);

    const alphaPid = await withOrganizationTransaction(
      pool,
      alphaOrganizationId,
      async (transaction) =>
        (await transaction.query('SELECT pg_backend_pid()::integer AS pid'))
          .rows[0].pid,
    );
    await withOrganizationTransaction(
      pool,
      betaOrganizationId,
      async (transaction) =>
        transaction.query('SELECT count(*) FROM droneworks.import_items'),
    );
    const cleared = await pool.query(
      `SELECT pg_backend_pid()::integer AS pid,
              current_setting('app.organization_id', true) AS organization_id,
              (SELECT count(*)::integer FROM droneworks.import_items) AS count`,
    );
    expect(cleared.rows[0].pid).toBe(alphaPid);
    expect([null, '']).toContain(cleared.rows[0].organization_id);
    expect(cleared.rows[0].count).toBe(0);
  });
});
