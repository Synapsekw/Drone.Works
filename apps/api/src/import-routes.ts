import type { FastifyInstance } from 'fastify';

import {
  declareImportBatchBodySchema,
  idempotencyHeadersSchema,
  importBatchDeclarationSchema,
  importBatchListQuerySchema,
  importBatchListSchema,
  importBatchPathSchema,
  importBatchSchema,
  importPathSchema,
  importStatusSchema,
  problemDetailSchema,
  type DeclareImportBatchBody,
  type ImportBatchListQuery,
  type ImportBatchPath,
  type ImportPath,
  type OrganizationPath,
  organizationPathSchema,
} from '@drone-works/contracts/server';
import type {
  ImportBatch,
  ImportProcessingRepository,
  ImportStatus,
} from '@drone-works/database';

import type { IdentitySource } from './identity.js';
import { requireIdentity } from './organization-routes.js';

const problemResponses = {
  '4xx': {
    description: 'The import was denied or could not be changed.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
  '5xx': {
    description: 'The import operation could not be completed.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
} as const;

function statusResponse(status: ImportStatus) {
  return {
    failure_reason: status.failureReason,
    import_id: status.importId,
    result_flight_id: status.resultFlightId,
    state: status.state,
    updated_at: status.updatedAt.toISOString(),
  };
}

function sanitizeFilename(value: string): string {
  const leaf = value.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const sanitized = [...leaf]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (sanitized || 'upload.bin').slice(0, 500);
}

function idempotencyKey(headers: Record<string, unknown>): string {
  const value = headers['idempotency-key'];
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error('An idempotency key is required.') as Error & {
      statusCode: number;
    };
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function batchResponse(batch: ImportBatch) {
  return {
    batch_id: batch.batchId,
    state: batch.state,
    created_at: batch.createdAt.toISOString(),
    summary: {
      total: batch.summary.total,
      processing: batch.summary.processing,
      completed: batch.summary.completed,
      awaiting_review: batch.summary.awaitingReview,
      duplicates: batch.summary.duplicates,
      failed: batch.summary.failed,
      cancelled: batch.summary.cancelled,
    },
    items: batch.items.map((item) => ({
      import_id: item.importId,
      original_filename: item.originalFilename,
      state: item.state,
      progress_percent: item.progressPercent,
      outcome: item.outcome,
      failure_reason: item.failureReason,
      duplicate_kind: item.duplicateKind,
      result_flight_id: item.resultFlightId,
      related_flight_id: item.relatedFlightId,
      retry_eligible: item.retryEligible,
      attempts: item.attempts.map((attempt) => ({
        attempt_number: attempt.attemptNumber,
        state: attempt.state,
        failure_reason: attempt.failureReason,
        started_at: attempt.startedAt?.toISOString() ?? null,
        finished_at: attempt.finishedAt?.toISOString() ?? null,
      })),
      updated_at: item.updatedAt.toISOString(),
    })),
  };
}

export interface ImportRouteDependencies {
  readonly identitySource: IdentitySource;
  readonly imports: Pick<
    ImportProcessingRepository,
    | 'cancel'
    | 'declareBatch'
    | 'getBatch'
    | 'getStatus'
    | 'listBatches'
    | 'retry'
  >;
}

export function registerImportRoutes(
  app: FastifyInstance,
  dependencies: ImportRouteDependencies,
): void {
  app.post<{
    Body: DeclareImportBatchBody;
    Headers: { 'idempotency-key': string };
    Params: OrganizationPath;
  }>(
    '/api/v1/organizations/:organization_id/import-batches',
    {
      schema: {
        operationId: 'declareImportBatch',
        body: declareImportBatchBodySchema,
        headers: idempotencyHeadersSchema,
        params: organizationPathSchema,
        response: {
          201: {
            description: 'One organization-owned batch and item per file.',
            content: {
              'application/json': { schema: importBatchDeclarationSchema },
            },
          },
          ...problemResponses,
        },
        summary: 'Declare a multi-file import batch',
        tags: ['imports'],
      },
    },
    async (request, reply) => {
      const clientFileIds = request.body.files.map((file) =>
        file.client_file_id.trim(),
      );
      if (
        clientFileIds.some((value) => !value) ||
        new Set(clientFileIds).size !== clientFileIds.length
      ) {
        const error = new Error(
          'Each batch file needs a unique non-empty client identifier.',
        ) as Error & { statusCode: number };
        error.statusCode = 400;
        throw error;
      }
      const declared = await dependencies.imports.declareBatch(
        await requireIdentity(dependencies.identitySource, request),
        request.params.organization_id,
        idempotencyKey(request.headers),
        request.body.files.map((file, index) => ({
          byteSize: file.byte_size,
          clientFileId: clientFileIds[index] ?? file.client_file_id,
          contentSha256: file.content_sha256,
          mediaType: file.media_type,
          originalFilename: sanitizeFilename(file.original_filename),
        })),
      );
      return reply.code(201).send({
        batch_id: declared.batchId,
        items: declared.items.map((item) => ({
          import_id: item.uploadId,
          client_file_id: item.clientFileId,
          original_filename: item.originalFilename,
          content_sha256: item.contentSha256,
          state: 'uploaded' as const,
        })),
      });
    },
  );

  app.get<{
    Params: OrganizationPath;
    Querystring: ImportBatchListQuery;
  }>(
    '/api/v1/organizations/:organization_id/import-batches',
    {
      schema: {
        operationId: 'listImportBatches',
        params: organizationPathSchema,
        querystring: importBatchListQuerySchema,
        response: {
          200: {
            description: 'Recent authorized batches and complete item truth.',
            content: { 'application/json': { schema: importBatchListSchema } },
          },
          ...problemResponses,
        },
        summary: 'List recent import batches',
        tags: ['imports'],
      },
    },
    async (request) => ({
      batches: (
        await dependencies.imports.listBatches(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          request.query.limit ?? 10,
        )
      ).map(batchResponse),
    }),
  );

  app.get<{ Params: ImportBatchPath }>(
    '/api/v1/organizations/:organization_id/import-batches/:batch_id',
    {
      schema: {
        operationId: 'getImportBatch',
        params: importBatchPathSchema,
        response: {
          200: {
            description: 'One authorized batch with attempts and outcomes.',
            content: { 'application/json': { schema: importBatchSchema } },
          },
          ...problemResponses,
        },
        summary: 'Get import batch truth',
        tags: ['imports'],
      },
    },
    async (request) =>
      batchResponse(
        await dependencies.imports.getBatch(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          request.params.batch_id,
        ),
      ),
  );

  app.get<{ Params: ImportPath }>(
    '/api/v1/organizations/:organization_id/imports/:import_id',
    {
      schema: {
        operationId: 'getImportStatus',
        params: importPathSchema,
        response: {
          200: {
            description: 'The current organization-owned import state.',
            content: { 'application/json': { schema: importStatusSchema } },
          },
          ...problemResponses,
        },
        summary: 'Get import processing status',
        tags: ['imports'],
      },
    },
    async (request) =>
      statusResponse(
        await dependencies.imports.getStatus(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          request.params.import_id,
        ),
      ),
  );

  app.post<{ Params: ImportPath }>(
    '/api/v1/organizations/:organization_id/imports/:import_id/retry',
    {
      schema: {
        operationId: 'retryImport',
        params: importPathSchema,
        response: {
          200: {
            description: 'A new attempt was queued under the retained item.',
            content: { 'application/json': { schema: importStatusSchema } },
          },
          ...problemResponses,
        },
        summary: 'Retry an eligible failed import',
        tags: ['imports'],
      },
    },
    async (request) =>
      statusResponse(
        await dependencies.imports.retry(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          request.params.import_id,
        ),
      ),
  );

  app.delete<{ Params: ImportPath }>(
    '/api/v1/organizations/:organization_id/imports/:import_id',
    {
      schema: {
        operationId: 'cancelImport',
        params: importPathSchema,
        response: {
          200: {
            description: 'The pending import was cancelled.',
            content: { 'application/json': { schema: importStatusSchema } },
          },
          ...problemResponses,
        },
        summary: 'Cancel pending import processing',
        tags: ['imports'],
      },
    },
    async (request) =>
      statusResponse(
        await dependencies.imports.cancel(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          request.params.import_id,
        ),
      ),
  );
}
