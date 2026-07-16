import type { FastifyInstance } from 'fastify';

import {
  importPathSchema,
  importStatusSchema,
  problemDetailSchema,
  type ImportPath,
} from '@drone-works/contracts/server';
import type {
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
    import_id: status.importId,
    state: status.state,
    updated_at: status.updatedAt.toISOString(),
  };
}

export interface ImportRouteDependencies {
  readonly identitySource: IdentitySource;
  readonly imports: Pick<ImportProcessingRepository, 'cancel' | 'getStatus'>;
}

export function registerImportRoutes(
  app: FastifyInstance,
  dependencies: ImportRouteDependencies,
): void {
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
