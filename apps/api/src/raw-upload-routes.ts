import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';

import {
  completeRawUploadBodySchema,
  declareRawUploadBodySchema,
  idempotencyHeadersSchema,
  organizationPathSchema,
  problemDetailSchema,
  rawUploadContentSchema,
  rawUploadDeclarationSchema,
  rawUploadPathSchema,
  rawUploadSchema,
  type CompleteRawUploadBody,
  type DeclareRawUploadBody,
  type OrganizationPath,
  type RawUploadPath,
} from '@drone-works/contracts/server';
import type {
  AppIdentity,
  RawUploadDescriptor,
  RawUploadRecord,
  RawUploadRepository,
} from '@drone-works/database';
import {
  djiKeychainNoticeVersion,
  djiKeychainTermsVersion,
} from '@drone-works/database';

import type { IdentitySource } from './identity.js';
import type { ImmutableObjectStore } from './loopback-object-store.js';
import { ObjectStoreVerificationError } from './loopback-object-store.js';
import { requireIdentity } from './organization-routes.js';

const problemResponses = {
  '4xx': {
    description: 'The upload was denied or could not be accepted.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
  '5xx': {
    description: 'The upload could not be completed.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
} as const;

class RawUploadRequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'RawUploadRequestError';
    this.statusCode = statusCode;
  }
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

function uploadResponse(record: RawUploadRecord) {
  return {
    upload_id: record.uploadId,
    raw_source_id: record.rawSourceId,
    object_version_id: record.objectVersionId,
    state: record.state,
    content_sha256: record.contentSha256,
  };
}

async function currentIdentity(
  identitySource: IdentitySource,
  request: Parameters<typeof requireIdentity>[1],
): Promise<AppIdentity> {
  return requireIdentity(identitySource, request);
}

export interface RawUploadRouteDependencies {
  readonly identitySource: IdentitySource;
  readonly objectStore: ImmutableObjectStore;
  readonly uploads: Pick<
    RawUploadRepository,
    'authorize' | 'complete' | 'declare' | 'get' | 'isVersionReferenced'
  >;
}

function idempotencyKey(headers: Record<string, unknown>): string {
  const value = headers['idempotency-key'];
  if (typeof value !== 'string') {
    throw new RawUploadRequestError(400, 'An idempotency key is required.');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new RawUploadRequestError(400, 'An idempotency key is required.');
  }
  return trimmed;
}

function declarationResponse(descriptor: RawUploadDescriptor) {
  return {
    upload_id: descriptor.uploadId,
    state: 'declared' as const,
    content_sha256: descriptor.contentSha256,
  };
}

export function registerRawUploadRoutes(
  app: FastifyInstance,
  dependencies: RawUploadRouteDependencies,
): void {
  app.post<{
    Body: DeclareRawUploadBody;
    Headers: { 'idempotency-key': string };
    Params: OrganizationPath;
  }>(
    '/api/v1/organizations/:organization_id/uploads',
    {
      schema: {
        operationId: 'declareRawUpload',
        body: declareRawUploadBodySchema,
        headers: idempotencyHeadersSchema,
        params: organizationPathSchema,
        response: {
          201: {
            description: 'The raw upload was declared with server-owned IDs.',
            content: {
              'application/json': { schema: rawUploadDeclarationSchema },
            },
          },
          ...problemResponses,
        },
        summary: 'Declare an immutable raw upload',
        tags: ['uploads'],
      },
    },
    async (request, reply) => {
      const body = request.body;
      const clientFileId = body.client_file_id.trim();
      if (!clientFileId) {
        throw new RawUploadRequestError(
          400,
          'A non-empty client file identifier is required.',
        );
      }
      const declared = await dependencies.uploads.declare(
        await currentIdentity(dependencies.identitySource, request),
        request.params.organization_id,
        idempotencyKey(request.headers),
        {
          byteSize: body.byte_size,
          clientFileId,
          contentSha256: body.content_sha256,
          mediaType: body.media_type,
          originalFilename: sanitizeFilename(body.original_filename),
        },
      );
      return reply.code(201).send(declarationResponse(declared));
    },
  );

  app.put<{
    Body: Buffer;
    Params: RawUploadPath;
  }>(
    '/api/v1/organizations/:organization_id/uploads/:upload_id/content',
    {
      schema: {
        operationId: 'putRawUploadContent',
        body: Type.Any({ contentMediaType: 'application/octet-stream' }),
        consumes: ['application/octet-stream'],
        params: rawUploadPathSchema,
        response: {
          200: {
            description: 'The exact immutable object version was stored.',
            content: {
              'application/json': { schema: rawUploadContentSchema },
            },
          },
          ...problemResponses,
        },
        summary: 'Store declared raw bytes',
        tags: ['uploads'],
      },
    },
    async (request) => {
      const identity = await currentIdentity(
        dependencies.identitySource,
        request,
      );
      const declared = await dependencies.uploads.authorize(
        identity,
        request.params.organization_id,
        request.params.upload_id,
      );
      if (!Buffer.isBuffer(request.body)) {
        throw new RawUploadRequestError(
          415,
          'Raw content must use application/octet-stream.',
        );
      }
      if (request.body.byteLength !== declared.byteSize) {
        throw new ObjectStoreVerificationError();
      }
      const stored = await dependencies.objectStore.putIfAbsent(
        declared.objectKey,
        request.body,
        declared.mediaType,
        declared.contentSha256,
      );
      return {
        upload_id: declared.uploadId,
        object_version_id: stored.versionId,
        content_sha256: stored.contentSha256,
      };
    },
  );

  app.post<{
    Body: CompleteRawUploadBody;
    Headers: { 'idempotency-key': string };
    Params: RawUploadPath;
  }>(
    '/api/v1/organizations/:organization_id/uploads/:upload_id/completion',
    {
      schema: {
        operationId: 'completeRawUpload',
        body: completeRawUploadBodySchema,
        headers: idempotencyHeadersSchema,
        params: rawUploadPathSchema,
        response: {
          200: {
            description: 'The exact object version was linked as a raw source.',
            content: { 'application/json': { schema: rawUploadSchema } },
          },
          ...problemResponses,
        },
        summary: 'Complete an immutable raw upload',
        tags: ['uploads'],
      },
    },
    async (request) => {
      const identity = await currentIdentity(
        dependencies.identitySource,
        request,
      );
      const declared = await dependencies.uploads.authorize(
        identity,
        request.params.organization_id,
        request.params.upload_id,
      );
      const exact = await dependencies.objectStore.headExact(
        declared.objectKey,
        request.body.object_version_id,
      );
      if (
        !exact ||
        exact.contentSha256 !== declared.contentSha256 ||
        exact.byteSize !== declared.byteSize ||
        exact.mediaType !== declared.mediaType
      ) {
        throw new ObjectStoreVerificationError();
      }
      try {
        const completed = await dependencies.uploads.complete(
          identity,
          request.params.organization_id,
          request.params.upload_id,
          idempotencyKey(request.headers),
          {
            objectVersionId: exact.versionId,
            ...(request.body.dji_encrypted_processing === 'approved'
              ? {
                  djiKeychainAuthorization: {
                    noticeVersion: djiKeychainNoticeVersion,
                    termsVersion: djiKeychainTermsVersion,
                  },
                }
              : {}),
          },
        );
        if (completed.objectVersionId !== exact.versionId) {
          await dependencies.objectStore.deleteExact(
            declared.objectKey,
            exact.versionId,
          );
        }
        return uploadResponse(completed);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (!statusCode || statusCode >= 500) {
          const referenced = await dependencies.uploads.isVersionReferenced(
            request.params.organization_id,
            exact.versionId,
          );
          if (!referenced) {
            await dependencies.objectStore.deleteExact(
              declared.objectKey,
              exact.versionId,
            );
          }
        }
        throw error;
      }
    },
  );

  app.get<{ Params: RawUploadPath }>(
    '/api/v1/organizations/:organization_id/uploads/:upload_id',
    {
      schema: {
        operationId: 'getRawUpload',
        params: rawUploadPathSchema,
        response: {
          200: {
            description: 'The current organization-owned upload state.',
            content: { 'application/json': { schema: rawUploadSchema } },
          },
          ...problemResponses,
        },
        summary: 'Get a raw upload',
        tags: ['uploads'],
      },
    },
    async (request) =>
      uploadResponse(
        await dependencies.uploads.get(
          await currentIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          request.params.upload_id,
        ),
      ),
  );
}
