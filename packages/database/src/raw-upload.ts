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

export interface ImportBatchDeclaration {
  readonly batchId: string;
  readonly items: readonly RawUploadDescriptor[];
}

export interface ImportAttemptSummary {
  readonly attemptNumber: number;
  readonly failureReason: ImportStatus['failureReason'];
  readonly finishedAt: Date | null;
  readonly startedAt: Date | null;
  readonly state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
}

export type ImportOutcome =
  | 'supported_completion'
  | 'unsupported'
  | 'corrupt'
  | 'truncated'
  | 'key_unavailable'
  | 'processing_failed'
  | 'cancelled'
  | 'exact_duplicate'
  | 'probable_duplicate';

export type ImportDuplicateKind =
  'exact_file' | 'exact_normalized' | 'probable';

export interface ImportBatchItem {
  readonly attempts: readonly ImportAttemptSummary[];
  readonly duplicateKind: ImportDuplicateKind | null;
  readonly failureReason: ImportStatus['failureReason'];
  readonly importId: string;
  readonly originalFilename: string;
  readonly outcome: ImportOutcome | null;
  readonly progressPercent: number;
  readonly relatedFlightId: string | null;
  readonly resultFlightId: string | null;
  readonly retryEligible: boolean;
  readonly state: ImportState;
  readonly updatedAt: Date;
}

export interface ImportBatchSummary {
  readonly awaitingReview: number;
  readonly cancelled: number;
  readonly completed: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly processing: number;
  readonly total: number;
}

export interface ImportBatch {
  readonly batchId: string;
  readonly createdAt: Date;
  readonly items: readonly ImportBatchItem[];
  readonly state: 'processing' | 'completed';
  readonly summary: ImportBatchSummary;
}

export interface CompleteRawUploadInput {
  readonly djiKeychainAuthorization?: Readonly<{
    readonly noticeVersion: typeof djiKeychainNoticeVersion;
    readonly termsVersion: typeof djiKeychainTermsVersion;
  }>;
  readonly objectVersionId: string;
}

export const djiKeychainNoticeVersion = 'dji-keychain-notice-v1' as const;
export const djiKeychainTermsVersion =
  'dji-flight-record-api-review-2026-07-17' as const;

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
  readonly response_body:
    BatchDeclarationBody | DeclarationBody | CompletionBody;
}

interface BatchDeclarationBody {
  readonly batch_id: string;
  readonly items: readonly DeclarationBody[];
}

interface CompletionBody {
  readonly content_sha256: string;
  readonly object_version_id: string;
  readonly raw_source_id: string;
  readonly state: 'completed';
  readonly upload_id: string;
}

interface UploadRow {
  readonly duplicate_kind: ImportDuplicateKind | null;
  readonly byte_size: number;
  readonly client_file_id: string;
  readonly content_sha256: string;
  readonly media_type: string;
  readonly original_filename: string;
  readonly review_flight_id: string | null;
  readonly raw_source_id: string | null;
  readonly duplicate_of_flight_id: string | null;
  readonly failure_code: string | null;
  readonly result_flight_id: string | null;
  readonly state: ImportState;
  readonly updated_at: Date;
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

export class ImportCancellationConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super(
      'The import has already been dispatched and cannot be cancelled here.',
    );
    this.name = 'ImportCancellationConflictError';
  }
}

export const importStates = [
  'uploaded',
  'queued',
  'detecting',
  'parsing',
  'normalizing',
  'awaiting_review',
  'completed',
  'failed',
  'cancelled',
  'skipped_duplicate',
] as const;

export type ImportState = (typeof importStates)[number];

export interface ImportStatus {
  readonly failureReason:
    | 'unsupported'
    | 'corrupt'
    | 'truncated'
    | 'key_unavailable'
    | 'processing_failed'
    | null;
  readonly importId: string;
  readonly resultFlightId: string | null;
  readonly state: ImportState;
  readonly updatedAt: Date;
}

export interface ImportJobTarget {
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly importId: string;
  readonly mediaType: string;
  readonly objectKey: string;
  readonly objectVersionId: string;
  readonly rawSourceId: string;
  readonly state: 'queued' | 'detecting' | 'parsing' | 'normalizing';
}

export const importWorkerFailureCodes = [
  'unsupported_format',
  'unsupported_version',
  'boundary_violation',
  'invalid_source',
  'invalid_worker_output',
  'parser_memory_limit',
  'parser_cleanup_failed',
  'parser_output_limit',
  'parser_panic',
  'parser_runtime_error',
  'parser_wall_time_limit',
  'private_input_invalid',
  'private_input_limit',
  'source_identity_mismatch',
  'source_input_limit',
  'source_unavailable',
  'truncated_source',
  'invalid_keychain_request',
  'invalid_keychain_response',
  'key_rejected',
  'key_service_not_authorized',
  'key_service_rate_limited',
  'key_service_unavailable',
  'keychain_use_not_authorized',
] as const;

export type ImportWorkerFailureCode = (typeof importWorkerFailureCodes)[number];

function stableUuid(namespace: string, ...values: string[]): string {
  const bytes = createHash('sha256')
    .update([namespace, ...values].join('\0'))
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function importOutboxId(organizationId: string, importId: string): string {
  return stableUuid('droneworks-import-outbox-v1', organizationId, importId);
}

function importRetryOutboxId(
  organizationId: string,
  importId: string,
  attemptNumber: number,
): string {
  return stableUuid(
    'droneworks-import-retry-outbox-v1',
    organizationId,
    importId,
    String(attemptNumber),
  );
}

function requestDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function rawSourceObjectKey(
  organizationId: string,
  uploadId: string,
): string {
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
            item.duplicate_kind,
            item.failure_code,
            item.result_flight_id,
            item.duplicate_of_flight_id,
            item.review_flight_id,
            item.state,
            item.updated_at,
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

interface BatchRow {
  readonly batch_id: string;
  readonly created_at: Date;
  readonly import_id: string;
  readonly original_filename: string;
  readonly duplicate_kind: ImportDuplicateKind | null;
  readonly failure_code: string | null;
  readonly result_flight_id: string | null;
  readonly duplicate_of_flight_id: string | null;
  readonly review_flight_id: string | null;
  readonly state: ImportState;
  readonly updated_at: Date;
}

interface AttemptRow {
  readonly attempt_number: number;
  readonly failure_code: string | null;
  readonly finished_at: Date | null;
  readonly import_item_id: string;
  readonly started_at: Date | null;
  readonly state: ImportAttemptSummary['state'];
}

function publicFailureReason(
  state: ImportState,
  failureCode: string | null,
): ImportStatus['failureReason'] {
  if (state !== 'failed') return null;
  if (
    failureCode === 'unsupported_format' ||
    failureCode === 'unsupported_version'
  ) {
    return 'unsupported';
  }
  if (failureCode === 'truncated_source') return 'truncated';
  if (
    failureCode === 'invalid_source' ||
    failureCode === 'invalid_or_corrupt_prefix' ||
    failureCode === 'source_identity_mismatch'
  ) {
    return 'corrupt';
  }
  if (
    failureCode?.includes('key') ||
    failureCode?.includes('provider') ||
    failureCode === 'external_processing_not_authorized'
  ) {
    return 'key_unavailable';
  }
  return 'processing_failed';
}

function progressPercent(state: ImportState): number {
  const progress: Record<ImportState, number> = {
    uploaded: 10,
    queued: 25,
    detecting: 40,
    parsing: 60,
    normalizing: 80,
    awaiting_review: 100,
    completed: 100,
    failed: 100,
    cancelled: 100,
    skipped_duplicate: 100,
  };
  return progress[state];
}

function publicOutcome(row: BatchRow): ImportOutcome | null {
  if (row.state === 'completed') return 'supported_completion';
  if (row.state === 'cancelled') return 'cancelled';
  if (row.state === 'skipped_duplicate') return 'exact_duplicate';
  if (row.state === 'awaiting_review' && row.duplicate_kind === 'probable') {
    return 'probable_duplicate';
  }
  if (row.state === 'failed') {
    return publicFailureReason(row.state, row.failure_code);
  }
  return null;
}

function retryEligible(row: BatchRow): boolean {
  const reason = publicFailureReason(row.state, row.failure_code);
  return reason === 'key_unavailable' || reason === 'processing_failed';
}

function assembleBatch(
  batchId: string,
  createdAt: Date,
  rows: readonly BatchRow[],
  attempts: readonly AttemptRow[],
): ImportBatch {
  const attemptsByItem = new Map<string, ImportAttemptSummary[]>();
  for (const attempt of attempts) {
    const itemAttempts = attemptsByItem.get(attempt.import_item_id) ?? [];
    itemAttempts.push({
      attemptNumber: attempt.attempt_number,
      failureReason: publicFailureReason(
        attempt.state === 'failed' ? 'failed' : 'completed',
        attempt.failure_code,
      ),
      finishedAt: attempt.finished_at,
      startedAt: attempt.started_at,
      state: attempt.state,
    });
    attemptsByItem.set(attempt.import_item_id, itemAttempts);
  }
  const items = rows.map<ImportBatchItem>((row) => ({
    attempts: attemptsByItem.get(row.import_id) ?? [],
    duplicateKind: row.duplicate_kind,
    failureReason: publicFailureReason(row.state, row.failure_code),
    importId: row.import_id,
    originalFilename: row.original_filename,
    outcome: publicOutcome(row),
    progressPercent: progressPercent(row.state),
    relatedFlightId: row.review_flight_id,
    resultFlightId: row.result_flight_id ?? row.duplicate_of_flight_id ?? null,
    retryEligible: retryEligible(row),
    state: row.state,
    updatedAt: row.updated_at,
  }));
  const summary: ImportBatchSummary = {
    awaitingReview: items.filter(
      (item) =>
        item.state === 'awaiting_review' &&
        item.outcome !== 'probable_duplicate',
    ).length,
    cancelled: items.filter((item) => item.outcome === 'cancelled').length,
    completed: items.filter((item) => item.outcome === 'supported_completion')
      .length,
    duplicates: items.filter(
      (item) =>
        item.outcome === 'exact_duplicate' ||
        item.outcome === 'probable_duplicate',
    ).length,
    failed: items.filter((item) => item.state === 'failed').length,
    processing: items.filter((item) => item.outcome === null).length,
    total: items.length,
  };
  return {
    batchId,
    createdAt,
    items,
    state: summary.processing === 0 ? 'completed' : 'processing',
    summary,
  };
}

async function loadBatches(
  transaction: OrganizationTransaction,
  identity: AppIdentity,
  role: OrganizationRole,
  batchId: string | null,
  limit: number,
): Promise<readonly ImportBatch[]> {
  const rows = await transaction.query<BatchRow>(
    `WITH visible_batches AS (
       SELECT id, created_at
         FROM droneworks.import_batches
        WHERE organization_id = $1
          AND ($2::boolean OR uploaded_by_user_id = $3)
          AND ($4::uuid IS NULL OR id = $4)
        ORDER BY created_at DESC, id DESC
        LIMIT $5
     )
     SELECT batch.id AS batch_id, batch.created_at,
            item.id AS import_id, item.original_filename,
            item.duplicate_kind, item.failure_code,
            item.result_flight_id, item.duplicate_of_flight_id,
            item.review_flight_id, item.state, item.updated_at
       FROM visible_batches AS batch
       JOIN droneworks.import_items AS item
         ON (item.organization_id, item.import_batch_id) = ($1, batch.id)
      ORDER BY batch.created_at DESC, batch.id DESC,
               item.created_at, item.id`,
    [
      transaction.organizationId,
      role === 'owner' || role === 'admin',
      identity.userId,
      batchId,
      limit,
    ],
  );
  if (batchId && rows.rows.length === 0) {
    throw new OrganizationAccessDeniedError();
  }
  const itemIds = rows.rows.map((row) => row.import_id);
  const attempts = itemIds.length
    ? await transaction.query<AttemptRow>(
        `SELECT import_item_id, attempt_number, state, failure_code,
                started_at, finished_at
           FROM droneworks.import_attempts
          WHERE organization_id = $1
            AND import_item_id = ANY($2::uuid[])
          ORDER BY import_item_id, attempt_number`,
        [transaction.organizationId, itemIds],
      )
    : { rows: [] as AttemptRow[] };
  const grouped = new Map<string, { createdAt: Date; rows: BatchRow[] }>();
  for (const row of rows.rows) {
    const group = grouped.get(row.batch_id) ?? {
      createdAt: row.created_at,
      rows: [],
    };
    group.rows.push(row);
    grouped.set(row.batch_id, group);
  }
  return [...grouped.entries()].map(([id, group]) =>
    assembleBatch(id, group.createdAt, group.rows, attempts.rows),
  );
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

async function recordDjiKeychainAuthorization(
  transaction: OrganizationTransaction,
  identity: AppIdentity,
  rawSourceId: string,
  authorization: CompleteRawUploadInput['djiKeychainAuthorization'],
): Promise<void> {
  if (!authorization) return;
  if (
    authorization.noticeVersion !== djiKeychainNoticeVersion ||
    authorization.termsVersion !== djiKeychainTermsVersion
  ) {
    throw new OrganizationAccessDeniedError();
  }
  await transaction.query(
    `INSERT INTO droneworks.keychain_authorizations (
       organization_id, raw_source_id, keychain_use_authorized,
       external_service_processing_authorized, notice_version,
       terms_version, approved_by_user_id, approved_at, revoked_at
     ) VALUES ($1, $2, true, true, $3, $4, $5, now(), NULL)
     ON CONFLICT (organization_id, raw_source_id) DO UPDATE SET
       keychain_use_authorized = true,
       external_service_processing_authorized = true,
       notice_version = EXCLUDED.notice_version,
       terms_version = EXCLUDED.terms_version,
       approved_by_user_id = EXCLUDED.approved_by_user_id,
       approved_at = EXCLUDED.approved_at,
       revoked_at = NULL`,
    [
      transaction.organizationId,
      rawSourceId,
      authorization.noticeVersion,
      authorization.termsVersion,
      identity.userId,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.audit_events (
       organization_id, id, actor_kind, actor_user_id, action,
       resource_type, resource_id, changed_fields, metadata, occurred_at
     ) VALUES ($1, $2, 'user', $3, 'keychain.authorization_recorded',
               'raw_source', $4, $5, '{"provider":"dji"}'::jsonb, now())`,
    [
      transaction.organizationId,
      randomUUID(),
      identity.userId,
      rawSourceId,
      [
        'external_service_processing_authorized',
        'keychain_use_authorized',
        'notice_version',
        'terms_version',
      ],
    ],
  );
}

function descriptor(
  organizationId: string,
  uploadId: string,
  input: DeclareRawUploadInput,
): RawUploadDescriptor {
  return {
    ...input,
    objectKey: rawSourceObjectKey(organizationId, uploadId),
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
          await recordDjiKeychainAuthorization(
            transaction,
            identity,
            row.raw_source_id,
            input.djiKeychainAuthorization,
          );
          return {
            contentSha256: row.content_sha256,
            objectVersionId: row.object_revision_id,
            rawSourceId: row.raw_source_id,
            state: 'completed',
            uploadId,
          };
        }

        const retained = await transaction.query<{
          readonly id: string;
          readonly object_revision_id: string;
        }>(
          `SELECT id, object_revision_id
             FROM droneworks.raw_sources
            WHERE organization_id = $1
              AND content_sha256 = $2
            FOR UPDATE`,
          [transaction.organizationId, row.content_sha256],
        );
        const rawSourceId = retained.rows[0]?.id ?? uploadId;
        const retainedObjectVersionId =
          retained.rows[0]?.object_revision_id ?? input.objectVersionId;
        if (!retained.rows[0]) {
          await transaction.query(
            `INSERT INTO droneworks.raw_sources (
               organization_id, id, object_revision_id, content_sha256,
               byte_size, media_type, state, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'retained', now())`,
            [
              transaction.organizationId,
              rawSourceId,
              retainedObjectVersionId,
              row.content_sha256,
              row.byte_size,
              row.media_type,
            ],
          );
        }
        await recordDjiKeychainAuthorization(
          transaction,
          identity,
          rawSourceId,
          input.djiKeychainAuthorization,
        );
        await transaction.query(
          `UPDATE droneworks.import_items
              SET raw_source_id = $3,
                  state = 'queued',
                  updated_at = now()
            WHERE organization_id = $1
              AND id = $2`,
          [transaction.organizationId, uploadId, rawSourceId],
        );
        await transaction.query(
          `SELECT droneworks_jobs.enqueue_import($1, $2, now())`,
          [importOutboxId(transaction.organizationId, uploadId), uploadId],
        );
        const responseBody: CompletionBody = {
          content_sha256: row.content_sha256,
          object_version_id: retainedObjectVersionId,
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
          objectVersionId: retainedObjectVersionId,
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

export class ImportProcessingRepository {
  readonly #pool: OrganizationPool;

  constructor(pool: OrganizationPool) {
    this.#pool = pool;
  }

  async declareBatch(
    identity: AppIdentity,
    organizationId: string,
    idempotencyKey: string,
    files: readonly DeclareRawUploadInput[],
  ): Promise<ImportBatchDeclaration> {
    if (files.length < 1 || files.length > 20) {
      throw new TypeError('A batch must contain between 1 and 20 files.');
    }
    if (new Set(files.map((file) => file.clientFileId)).size !== files.length) {
      throw new TypeError('Client file identifiers must be unique in a batch.');
    }
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        if (!canDeclare(role)) throw new OrganizationAccessDeniedError();
        const digest = requestDigest(files);
        await transaction.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [
            `${transaction.organizationId}:${identity.userId}:import_batch.declare:${idempotencyKey}`,
          ],
        );
        const existing = await transaction.query<IdempotencyRow>(
          `SELECT request_sha256, response_body
             FROM droneworks.api_idempotency_requests
            WHERE organization_id = $1
              AND user_id = $2
              AND operation = 'import_batch.declare'
              AND idempotency_key = $3
            FOR UPDATE`,
          [transaction.organizationId, identity.userId, idempotencyKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].request_sha256 !== digest) {
            throw new IdempotencyConflictError();
          }
          const body = existing.rows[0].response_body as BatchDeclarationBody;
          return {
            batchId: body.batch_id,
            items: body.items.map((item) =>
              descriptor(transaction.organizationId, item.upload_id, {
                byteSize: item.byte_size,
                clientFileId: item.client_file_id,
                contentSha256: item.content_sha256,
                mediaType: item.media_type,
                originalFilename: item.original_filename,
              }),
            ),
          };
        }

        const batchId = randomUUID();
        await transaction.query(
          `INSERT INTO droneworks.import_batches (
             organization_id, id, uploaded_by_user_id, state, created_at
           ) VALUES ($1, $2, $3, 'open', now())`,
          [transaction.organizationId, batchId, identity.userId],
        );
        const items: RawUploadDescriptor[] = [];
        const responseItems: DeclarationBody[] = [];
        for (const [index, file] of files.entries()) {
          const uploadId = randomUUID();
          const response: DeclarationBody = {
            byte_size: file.byteSize,
            client_file_id: file.clientFileId,
            content_sha256: file.contentSha256,
            media_type: file.mediaType,
            original_filename: file.originalFilename,
            upload_id: uploadId,
          };
          await transaction.query(
            `INSERT INTO droneworks.import_items (
               organization_id, id, import_batch_id, client_file_id,
               original_filename, state, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, 'uploaded', now(), now())`,
            [
              transaction.organizationId,
              uploadId,
              batchId,
              file.clientFileId,
              file.originalFilename,
            ],
          );
          await transaction.query(
            `INSERT INTO droneworks.api_idempotency_requests (
               organization_id, user_id, operation, idempotency_key,
               request_sha256, response_status, response_body, created_at,
               completed_at
             ) VALUES ($1, $2, 'raw_upload.declare', $3, $4, 201, $5,
                       now(), now())`,
            [
              transaction.organizationId,
              identity.userId,
              `batch-${requestDigest([idempotencyKey, index])}`,
              requestDigest(file),
              response,
            ],
          );
          items.push(descriptor(transaction.organizationId, uploadId, file));
          responseItems.push(response);
        }
        await transaction.query(
          `INSERT INTO droneworks.api_idempotency_requests (
             organization_id, user_id, operation, idempotency_key,
             request_sha256, response_status, response_body, created_at,
             completed_at
           ) VALUES ($1, $2, 'import_batch.declare', $3, $4, 201, $5,
                     now(), now())`,
          [
            transaction.organizationId,
            identity.userId,
            idempotencyKey,
            digest,
            { batch_id: batchId, items: responseItems },
          ],
        );
        await transaction.query(
          `INSERT INTO droneworks.audit_events (
             organization_id, id, actor_kind, actor_user_id, action,
             resource_type, resource_id, changed_fields, metadata, occurred_at
           ) VALUES ($1, $2, 'user', $3, 'import_batch.declared',
                     'import_batch', $4, ARRAY['items'],
                     jsonb_build_object('item_count', $5::integer), now())`,
          [
            transaction.organizationId,
            randomUUID(),
            identity.userId,
            batchId,
            files.length,
          ],
        );
        return { batchId, items };
      },
    );
  }

  async getBatch(
    identity: AppIdentity,
    organizationId: string,
    batchId: string,
  ): Promise<ImportBatch> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        const batches = await loadBatches(
          transaction,
          identity,
          role,
          batchId,
          1,
        );
        const batch = batches[0];
        if (!batch) throw new OrganizationAccessDeniedError();
        return batch;
      },
    );
  }

  async listBatches(
    identity: AppIdentity,
    organizationId: string,
    limit = 10,
  ): Promise<readonly ImportBatch[]> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        if (role === 'viewer') throw new OrganizationAccessDeniedError();
        return loadBatches(
          transaction,
          identity,
          role,
          null,
          Math.max(1, Math.min(limit, 20)),
        );
      },
    );
  }

  async retry(
    identity: AppIdentity,
    organizationId: string,
    importId: string,
  ): Promise<ImportStatus> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        const item = await transaction.query<
          BatchRow & { readonly uploaded_by_user_id: string }
        >(
          `SELECT batch.id AS batch_id, batch.created_at,
                  batch.uploaded_by_user_id, item.id AS import_id,
                  item.original_filename, item.duplicate_kind,
                  item.failure_code, item.result_flight_id,
                  item.duplicate_of_flight_id, item.review_flight_id,
                  item.state, item.updated_at
             FROM droneworks.import_items AS item
             JOIN droneworks.import_batches AS batch
               ON (batch.organization_id, batch.id) =
                  (item.organization_id, item.import_batch_id)
            WHERE item.organization_id = $1 AND item.id = $2`,
          [transaction.organizationId, importId],
        );
        const row = item.rows[0];
        if (
          !row ||
          !canUseUpload(role, identity.userId, row.uploaded_by_user_id)
        ) {
          throw new OrganizationAccessDeniedError();
        }
        if (!retryEligible(row)) {
          throw new RawUploadConflictError(
            'This failed import is not eligible for retry.',
          );
        }
        await transaction.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${transaction.organizationId}:import-retry:${importId}`],
        );
        const attempt = await transaction.query<{
          readonly attempt: number;
        }>(
          `SELECT coalesce(max(attempt_number), 0)::integer + 1 AS attempt
             FROM droneworks.import_attempts
            WHERE organization_id = $1 AND import_item_id = $2`,
          [transaction.organizationId, importId],
        );
        const attemptNumber = attempt.rows[0]?.attempt ?? 1;
        const outbox = await transaction.query<{ readonly outbox_id: string }>(
          `SELECT droneworks_jobs.retry_import($1, $2, now()) AS outbox_id`,
          [
            importRetryOutboxId(
              transaction.organizationId,
              importId,
              attemptNumber,
            ),
            importId,
          ],
        );
        if (!outbox.rows[0]?.outbox_id) {
          throw new RawUploadConflictError(
            'The previous processing dispatch is not ready for retry.',
          );
        }
        const updated = await transaction.query<{ readonly updated_at: Date }>(
          `UPDATE droneworks.import_items
              SET state = 'queued', failure_code = NULL, updated_at = now()
            WHERE organization_id = $1 AND id = $2 AND state = 'failed'
          RETURNING updated_at`,
          [transaction.organizationId, importId],
        );
        if (!updated.rows[0]) {
          throw new RawUploadConflictError();
        }
        await transaction.query(
          `INSERT INTO droneworks.audit_events (
             organization_id, id, actor_kind, actor_user_id, action,
             resource_type, resource_id, changed_fields, metadata, occurred_at
           ) VALUES ($1, $2, 'user', $3, 'import.retry_requested',
                     'import_item', $4, ARRAY['state', 'attempt_number'],
                     jsonb_build_object('attempt_number', $5::integer), now())`,
          [
            transaction.organizationId,
            randomUUID(),
            identity.userId,
            importId,
            attemptNumber,
          ],
        );
        return {
          failureReason: null,
          importId,
          resultFlightId: null,
          state: 'queued',
          updatedAt: updated.rows[0].updated_at,
        };
      },
    );
  }

  async getStatus(
    identity: AppIdentity,
    organizationId: string,
    importId: string,
  ): Promise<ImportStatus> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        const row = await uploadRow(transaction, importId);
        if (!canUseUpload(role, identity.userId, row.uploaded_by_user_id)) {
          throw new OrganizationAccessDeniedError();
        }
        return {
          failureReason: publicFailureReason(row.state, row.failure_code),
          importId,
          resultFlightId:
            row.result_flight_id ?? row.duplicate_of_flight_id ?? null,
          state: row.state,
          updatedAt: row.updated_at,
        };
      },
    );
  }

  async cancel(
    identity: AppIdentity,
    organizationId: string,
    importId: string,
  ): Promise<ImportStatus> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const role = await currentRole(transaction, identity.userId);
        const row = await uploadRow(transaction, importId);
        if (!canUseUpload(role, identity.userId, row.uploaded_by_user_id)) {
          throw new OrganizationAccessDeniedError();
        }
        if (row.state === 'cancelled') {
          return {
            failureReason: null,
            importId,
            resultFlightId: null,
            state: row.state,
            updatedAt: row.updated_at,
          };
        }
        if (row.state !== 'uploaded' && row.state !== 'queued') {
          throw new ImportCancellationConflictError();
        }
        if (row.state === 'queued') {
          const cancelled = await transaction.query<{
            readonly cancelled: boolean;
          }>(`SELECT droneworks_jobs.cancel_import($1) AS cancelled`, [
            importId,
          ]);
          if (!cancelled.rows[0]?.cancelled) {
            throw new ImportCancellationConflictError();
          }
        }
        const updated = await transaction.query<{
          readonly updated_at: Date;
        }>(
          `UPDATE droneworks.import_items
              SET state = 'cancelled',
                  updated_at = now()
            WHERE organization_id = $1
              AND id = $2
          RETURNING updated_at`,
          [transaction.organizationId, importId],
        );
        await writeAudit(
          transaction,
          identity.userId,
          'raw_upload.cancelled',
          importId,
        );
        return {
          failureReason: null,
          importId,
          resultFlightId: null,
          state: 'cancelled',
          updatedAt: updated.rows[0]?.updated_at ?? new Date(),
        };
      },
    );
  }

  async loadForJob(
    organizationId: string,
    importId: string,
  ): Promise<ImportJobTarget | null> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const result = await transaction.query<{
          readonly byte_size: string;
          readonly content_sha256: string;
          readonly media_type: string;
          readonly object_revision_id: string;
          readonly raw_source_id: string;
          readonly state: ImportState;
        }>(
          `SELECT item.raw_source_id, item.state,
                  source.object_revision_id, source.content_sha256,
                  source.byte_size, source.media_type
             FROM droneworks.import_items AS item
             JOIN droneworks.raw_sources AS source
               ON (source.organization_id, source.id) =
                  (item.organization_id, item.raw_source_id)
            WHERE item.organization_id = $1
              AND item.id = $2
              AND source.state = 'retained'`,
          [transaction.organizationId, importId],
        );
        const row = result.rows[0];
        if (
          !row ||
          !['queued', 'detecting', 'parsing', 'normalizing'].includes(row.state)
        ) {
          return null;
        }
        return {
          byteSize: Number(row.byte_size),
          contentSha256: row.content_sha256,
          importId,
          mediaType: row.media_type,
          objectKey: rawSourceObjectKey(
            transaction.organizationId,
            row.raw_source_id,
          ),
          objectVersionId: row.object_revision_id,
          rawSourceId: row.raw_source_id,
          state: row.state as ImportJobTarget['state'],
        };
      },
    );
  }

  async markStage(
    organizationId: string,
    importId: string,
    stage: 'detecting' | 'parsing' | 'normalizing',
  ): Promise<boolean> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const result = await transaction.query(
          `UPDATE droneworks.import_items
              SET state = $3, updated_at = now()
            WHERE organization_id = $1
              AND id = $2
              AND state = ANY($4::text[])`,
          [
            transaction.organizationId,
            importId,
            stage,
            ['queued', 'detecting', 'parsing', 'normalizing'],
          ],
        );
        return result.rowCount === 1;
      },
    );
  }

  async fail(
    organizationId: string,
    importId: string,
    failureCode: ImportWorkerFailureCode,
  ): Promise<boolean> {
    if (!importWorkerFailureCodes.includes(failureCode)) {
      throw new TypeError('The import failure code is not allowlisted.');
    }
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        await transaction.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${transaction.organizationId}:import-failure:${importId}`],
        );
        const item = await transaction.query<{ readonly state: ImportState }>(
          `SELECT state FROM droneworks.import_items
            WHERE organization_id = $1 AND id = $2`,
          [transaction.organizationId, importId],
        );
        const state = item.rows[0]?.state;
        if (
          !state ||
          [
            'awaiting_review',
            'completed',
            'failed',
            'cancelled',
            'skipped_duplicate',
          ].includes(state)
        ) {
          return false;
        }
        const attempt = await transaction.query<{ readonly attempt: number }>(
          `SELECT coalesce(max(attempt_number), 0)::integer + 1 AS attempt
             FROM droneworks.import_attempts
            WHERE organization_id = $1 AND import_item_id = $2`,
          [transaction.organizationId, importId],
        );
        const attemptNumber = attempt.rows[0]?.attempt ?? 1;
        await transaction.query(
          `INSERT INTO droneworks.import_attempts (
             organization_id, id, import_item_id, attempt_number, state,
             parser_revision, failure_code, started_at, finished_at
           ) VALUES ($1, $2, $3, $4, 'failed',
                     'dji-log-parser@0.5.7', $5, now(), now())`,
          [
            transaction.organizationId,
            stableUuid(
              'droneworks-failed-import-attempt-v1',
              transaction.organizationId,
              importId,
              String(attemptNumber),
            ),
            importId,
            attemptNumber,
            failureCode,
          ],
        );
        await transaction.query(
          `UPDATE droneworks.import_items
              SET state = 'failed', failure_code = $3, updated_at = now()
            WHERE organization_id = $1 AND id = $2`,
          [transaction.organizationId, importId, failureCode],
        );
        await transaction.query(
          `INSERT INTO droneworks.audit_events (
             organization_id, id, actor_kind, action, resource_type,
             resource_id, changed_fields, metadata, occurred_at
           ) VALUES ($1, $2, 'system', 'import.processing_failed',
                     'import_item', $3, ARRAY['state'],
                     '{"schema_version":1}'::jsonb, now())`,
          [transaction.organizationId, randomUUID(), importId],
        );
        return true;
      },
    );
  }
}
