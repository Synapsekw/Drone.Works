import { createHash, randomUUID } from 'node:crypto';

import type {
  AppIdentity,
  OrganizationRole,
} from './organization-authorization.js';
import { OrganizationAccessDeniedError } from './organization-authorization.js';
import {
  withOrganizationTransaction,
  type OrganizationPool,
  type OrganizationTransaction,
} from './organization-transaction.js';

export interface DeclareRawUploadInput {
  readonly byteSize: number;
  readonly clientFileId: string;
  readonly contentSha256: string;
  readonly mediaType: string;
  readonly originalFilename: string;
}

export interface RawUploadDescriptor extends DeclareRawUploadInput {
  readonly objectKey: string;
  readonly organizationId: string;
  readonly uploadId: string;
}

export interface RawUploadRecord {
  readonly contentSha256: string;
  readonly objectVersionId: string | null;
  readonly rawSourceId: string | null;
  readonly state: 'declared' | 'completed';
  readonly uploadId: string;
}

export interface CompleteRawUploadInput {
  readonly objectVersionId: string;
}

interface MembershipRow {
  readonly role: OrganizationRole;
}

interface DeclarationBody {
  readonly byte_size: number;
  readonly client_file_id: string;
  readonly content_sha256: string;
  readonly media_type: string;
  readonly original_filename: string;
  readonly upload_id: string;
}

interface IdempotencyRow {
  readonly request_sha256: string;
  readonly response_body: DeclarationBody | CompletionBody;
}

interface CompletionBody {
  readonly content_sha256: string;
  readonly object_version_id: string;
  readonly raw_source_id: string;
  readonly state: 'completed';
  readonly upload_id: string;
}

interface UploadRow {
  readonly byte_size: number;
  readonly client_file_id: string;
  readonly content_sha256: string;
  readonly media_type: string;
  readonly original_filename: string;
  readonly raw_source_id: string | null;
  readonly uploaded_by_user_id: string;
}

interface CompletedUploadRow extends UploadRow {
  readonly object_revision_id: string | null;
}

export class IdempotencyConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('The idempotency key was already used for different input.');
    this.name = 'IdempotencyConflictError';
  }
}

export class RawUploadConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = 'The immutable upload conflicts with stored data.') {
    super(message);
    this.name = 'RawUploadConflictError';
  }
}

function requestDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function objectKey(organizationId: string, uploadId: string): string {
  return `organizations/${organizationId}/raw-sources/${uploadId}/revisions/${uploadId}`;
}

async function currentRole(
  transaction: OrganizationTransaction,
  userId: string,
): Promise<OrganizationRole> {
  const result = await transaction.query<MembershipRow>(
    `SELECT role
       FROM droneworks.memberships
      WHERE organization_id = $1
        AND user_id = $2`,
    [transaction.organizationId, userId],
  );
  const membership = result.rows[0];
  if (!membership) throw new OrganizationAccessDeniedError();
  return membership.role;
}

function canDeclare(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'pilot';
}

function canUseUpload(
  role: OrganizationRole,
  actorUserId: string,
  uploadedByUserId: string,
): boolean {
  return (
    role === 'owner' ||
    role === 'admin' ||
    (role === 'pilot' && actorUserId === uploadedByUserId)
  );
}

async function uploadRow(
  transaction: OrganizationTransaction,
  uploadId: string,
): Promise<CompletedUploadRow> {
  const result = await transaction.query<CompletedUploadRow>(
    `SELECT item.client_file_id,
            item.original_filename,
            item.raw_source_id,
            batch.uploaded_by_user_id,
            declaration.response_body->>'content_sha256' AS content_sha256,
            (declaration.response_body->>'byte_size')::integer AS byte_size,
            declaration.response_body->>'media_type' AS media_type,
            source.object_revision_id
       FROM droneworks.import_items AS item
       JOIN droneworks.import_batches AS batch
         ON (batch.organization_id, batch.id) =
            (item.organization_id, item.import_batch_id)
       JOIN droneworks.api_idempotency_requests AS declaration
         ON declaration.organization_id = item.organization_id
        AND declaration.operation = 'raw_upload.declare'
        AND declaration.response_body->>'upload_id' = item.id::text
       LEFT JOIN droneworks.raw_sources AS source
         ON (source.organization_id, source.id) =
            (item.organization_id, item.raw_source_id)
      WHERE item.organization_id = $1
        AND item.id = $2`,
    [transaction.organizationId, uploadId],
  );
  const row = result.rows[0];
  if (!row) throw new OrganizationAccessDeniedError();
  return row;
}

async function writeAudit(
  transaction: OrganizationTransaction,
  actorUserId: string,
  action: string,
  resourceId: string,
): Promise<void> {
  await transaction.query(
    `INSERT INTO droneworks.audit_events (
       organization_id, id, actor_kind, actor_user_id, action,
       resource_type, resource_id, changed_fields, metadata, occurred_at
     ) VALUES ($1, $2, 'user', $3, $4, 'import_item', $5,
               ARRAY[]::text[], '{"item_count":1}'::jsonb, now())`,
    [transaction.organizationId, randomUUID(), actorUserId, action, resourceId],
  );
}

function descriptor(
  organizationId: string,
  uploadId: string,
  input: DeclareRawUploadInput,
): RawUploadDescriptor {
  return {
    ...input,
    objectKey: objectKey(organizationId, uploadId),
    organizationId,
    uploadId,
  };
}

export class RawUploadRepository {
  readonly #pool: OrganizationPool;

  constructor(pool: OrganizationPool) {
    this.#pool = pool;
  }

  async declare(
    identity: AppIdentity,
    organizationId: string,
    idempotencyKey: string,
    input: DeclareRawUploadInput,
  ): Promise<RawUploadDescriptor> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        if (!canDeclare(role)) throw new OrganizationAccessDeniedError();
        const digest = requestDigest(input);
        await transaction.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [
            `${transaction.organizationId}:${identity.userId}:raw_upload.declare:${idempotencyKey}`,
          ],
        );
        const existing = await transaction.query<IdempotencyRow>(
          `SELECT request_sha256, response_body
             FROM droneworks.api_idempotency_requests
            WHERE organization_id = $1
              AND user_id = $2
              AND operation = 'raw_upload.declare'
              AND idempotency_key = $3
            FOR UPDATE`,
          [transaction.organizationId, identity.userId, idempotencyKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].request_sha256 !== digest) {
            throw new IdempotencyConflictError();
          }
          const body = existing.rows[0].response_body as DeclarationBody;
          return descriptor(transaction.organizationId, body.upload_id, {
            byteSize: body.byte_size,
            clientFileId: body.client_file_id,
            contentSha256: body.content_sha256,
            mediaType: body.media_type,
            originalFilename: body.original_filename,
          });
        }

        const uploadId = randomUUID();
        const batchId = randomUUID();
        const responseBody: DeclarationBody = {
          byte_size: input.byteSize,
          client_file_id: input.clientFileId,
          content_sha256: input.contentSha256,
          media_type: input.mediaType,
          original_filename: input.originalFilename,
          upload_id: uploadId,
        };
        await transaction.query(
          `INSERT INTO droneworks.import_batches (
             organization_id, id, uploaded_by_user_id, state, created_at
           ) VALUES ($1, $2, $3, 'open', now())`,
          [transaction.organizationId, batchId, identity.userId],
        );
        await transaction.query(
          `INSERT INTO droneworks.import_items (
             organization_id, id, import_batch_id, client_file_id,
             original_filename, state, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 'uploaded', now(), now())`,
          [
            transaction.organizationId,
            uploadId,
            batchId,
            input.clientFileId,
            input.originalFilename,
          ],
        );
        await transaction.query(
          `INSERT INTO droneworks.api_idempotency_requests (
             organization_id, user_id, operation, idempotency_key,
             request_sha256, response_status, response_body, created_at,
             completed_at
           ) VALUES ($1, $2, 'raw_upload.declare', $3, $4, 201, $5, now(), now())`,
          [
            transaction.organizationId,
            identity.userId,
            idempotencyKey,
            digest,
            responseBody,
          ],
        );
        await writeAudit(
          transaction,
          identity.userId,
          'raw_upload.declared',
          uploadId,
        );
        return descriptor(transaction.organizationId, uploadId, input);
      },
    );
  }

  async authorize(
    identity: AppIdentity,
    organizationId: string,
    uploadId: string,
  ): Promise<RawUploadDescriptor> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        const row = await uploadRow(transaction, uploadId);
        if (!canUseUpload(role, identity.userId, row.uploaded_by_user_id)) {
          throw new OrganizationAccessDeniedError();
        }
        return descriptor(transaction.organizationId, uploadId, {
          byteSize: Number(row.byte_size),
          clientFileId: row.client_file_id,
          contentSha256: row.content_sha256,
          mediaType: row.media_type,
          originalFilename: row.original_filename,
        });
      },
    );
  }

  async get(
    identity: AppIdentity,
    organizationId: string,
    uploadId: string,
  ): Promise<RawUploadRecord> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        const row = await uploadRow(transaction, uploadId);
        if (!canUseUpload(role, identity.userId, row.uploaded_by_user_id)) {
          throw new OrganizationAccessDeniedError();
        }
        return {
          contentSha256: row.content_sha256,
          objectVersionId: row.object_revision_id,
          rawSourceId: row.raw_source_id,
          state: row.raw_source_id ? 'completed' : 'declared',
          uploadId,
        };
      },
    );
  }

  async complete(
    identity: AppIdentity,
    organizationId: string,
    uploadId: string,
    idempotencyKey: string,
    input: CompleteRawUploadInput,
  ): Promise<RawUploadRecord> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        const row = await uploadRow(transaction, uploadId);
        if (!canUseUpload(role, identity.userId, row.uploaded_by_user_id)) {
          throw new OrganizationAccessDeniedError();
        }
        const digest = requestDigest({ uploadId, ...input });
        await transaction.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [
            `${transaction.organizationId}:${identity.userId}:raw_upload.complete:${idempotencyKey}`,
          ],
        );
        const existing = await transaction.query<IdempotencyRow>(
          `SELECT request_sha256, response_body
             FROM droneworks.api_idempotency_requests
            WHERE organization_id = $1
              AND user_id = $2
              AND operation = 'raw_upload.complete'
              AND idempotency_key = $3
            FOR UPDATE`,
          [transaction.organizationId, identity.userId, idempotencyKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].request_sha256 !== digest) {
            throw new IdempotencyConflictError();
          }
          const body = existing.rows[0].response_body as CompletionBody;
          return {
            contentSha256: body.content_sha256,
            objectVersionId: body.object_version_id,
            rawSourceId: body.raw_source_id,
            state: body.state,
            uploadId: body.upload_id,
          };
        }
        if (row.raw_source_id) {
          if (row.object_revision_id !== input.objectVersionId) {
            throw new RawUploadConflictError();
          }
          return {
            contentSha256: row.content_sha256,
            objectVersionId: row.object_revision_id,
            rawSourceId: row.raw_source_id,
            state: 'completed',
            uploadId,
          };
        }

        const rawSourceId = uploadId;
        await transaction.query(
          `INSERT INTO droneworks.raw_sources (
             organization_id, id, object_revision_id, content_sha256,
             byte_size, media_type, state, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'retained', now())`,
          [
            transaction.organizationId,
            rawSourceId,
            input.objectVersionId,
            row.content_sha256,
            row.byte_size,
            row.media_type,
          ],
        );
        await transaction.query(
          `UPDATE droneworks.import_items
              SET raw_source_id = $3,
                  updated_at = now()
            WHERE organization_id = $1
              AND id = $2`,
          [transaction.organizationId, uploadId, rawSourceId],
        );
        const responseBody: CompletionBody = {
          content_sha256: row.content_sha256,
          object_version_id: input.objectVersionId,
          raw_source_id: rawSourceId,
          state: 'completed',
          upload_id: uploadId,
        };
        await transaction.query(
          `INSERT INTO droneworks.api_idempotency_requests (
             organization_id, user_id, operation, idempotency_key,
             request_sha256, response_status, response_body, created_at,
             completed_at
           ) VALUES ($1, $2, 'raw_upload.complete', $3, $4, 200, $5, now(), now())`,
          [
            transaction.organizationId,
            identity.userId,
            idempotencyKey,
            digest,
            responseBody,
          ],
        );
        await writeAudit(
          transaction,
          identity.userId,
          'raw_upload.completed',
          uploadId,
        );
        return {
          contentSha256: row.content_sha256,
          objectVersionId: input.objectVersionId,
          rawSourceId,
          state: 'completed',
          uploadId,
        };
      },
    );
  }

  async isVersionReferenced(
    organizationId: string,
    objectVersionId: string,
  ): Promise<boolean> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const result = await transaction.query(
          `SELECT 1
             FROM droneworks.raw_sources
            WHERE organization_id = $1
              AND object_revision_id = $2`,
          [transaction.organizationId, objectVersionId],
        );
        return result.rowCount === 1;
      },
    );
  }
}
