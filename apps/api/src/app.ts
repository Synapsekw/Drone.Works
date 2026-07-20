import { randomUUID } from 'node:crypto';

import swagger from '@fastify/swagger';
import {
  type TypeBoxTypeProvider,
  TypeBoxValidatorCompiler,
} from '@fastify/type-provider-typebox';
import Fastify, {
  type FastifyError,
  type FastifyRequest,
  LogController,
  type RouteOptions,
} from 'fastify';
import { Type } from '@sinclair/typebox';

import {
  createOrganizationBodySchema,
  createInvitationBodySchema,
  acceptInvitationBodySchema,
  completeRawUploadBodySchema,
  declareImportBatchBodySchema,
  declareRawUploadBodySchema,
  healthQuerySchema,
  healthResponseSchema,
  idempotencyHeadersSchema,
  importPathSchema,
  importStatusSchema,
  importAttemptSchema,
  importBatchDeclarationItemSchema,
  importBatchDeclarationSchema,
  importBatchItemSchema,
  importBatchListQuerySchema,
  importBatchListSchema,
  importBatchPathSchema,
  importBatchSchema,
  importBatchSummarySchema,
  flightFactsSchema,
  flightListQuerySchema,
  flightListSchema,
  flightListTotalsSchema,
  flightPathSchema,
  flightSummarySchema,
  flightTelemetryRangeSchema,
  flightTelemetrySummarySchema,
  flightTrackPointSchema,
  flightTrackQuerySchema,
  flightTrackSchema,
  flightTrackStatisticsSchema,
  membershipListSchema,
  membershipPathSchema,
  membershipSchema,
  invitationPathSchema,
  invitationSchema,
  organizationPathSchema,
  organizationSelectionSchema,
  problemDetailSchema,
  problemErrorSchema,
  putMembershipBodySchema,
  rawUploadContentSchema,
  rawUploadDeclarationSchema,
  rawUploadPathSchema,
  rawUploadSchema,
} from '@drone-works/contracts/server';
import type { ServiceEnvironment } from '@drone-works/config';
import {
  FlightTelemetryUnavailableError,
  type FlightReadRepository,
  type ImportProcessingRepository,
  LastOwnerError,
  OrganizationAccessDeniedError,
  type RawUploadRepository,
} from '@drone-works/database';

import {
  assertIdentityConfiguration,
  generatedPersonaNames,
  GeneratedPersonaIdentitySource,
  IdentityRequiredError,
  UnavailableIdentitySource,
  type IdentitySource,
} from './identity.js';
import type { AuthEmailDelivery, VerifiedAuth } from './auth.js';
import { registerAuthRoutes } from './auth-routes.js';
import {
  registerFlightRoutes,
  type FlightRouteDependencies,
} from './flight-routes.js';
import {
  registerOrganizationRoutes,
  type OrganizationRouteDependencies,
} from './organization-routes.js';
import {
  registerImportRoutes,
  type ImportRouteDependencies,
} from './import-routes.js';
import type { ImmutableObjectStore } from './loopback-object-store.js';
import {
  registerRawUploadRoutes,
  type RawUploadRouteDependencies,
} from './raw-upload-routes.js';
import {
  registerInvitationRoutes,
  type InvitationRouteDependencies,
} from './invitation-routes.js';

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const documentedApiRoutes = new Set([
  'DELETE /api/v1/organizations/:organization_id/imports/:import_id',
  'DELETE /api/v1/organizations/:organization_id/memberships/:user_id',
  'GET /api/v1/health',
  'GET /api/v1/organizations/:organization_id/flights',
  'GET /api/v1/organizations/:organization_id/flights/:flight_id',
  'GET /api/v1/organizations/:organization_id/flights/:flight_id/track',
  'GET /api/v1/organizations/:organization_id/imports/:import_id',
  'POST /api/v1/organizations/:organization_id/imports/:import_id/retry',
  'GET /api/v1/organizations/:organization_id/import-batches',
  'GET /api/v1/organizations/:organization_id/import-batches/:batch_id',
  'POST /api/v1/organizations/:organization_id/import-batches',
  'GET /api/v1/organizations/:organization_id/memberships',
  'DELETE /api/v1/organizations/:organization_id/invitations/:invitation_id',
  'POST /api/v1/organizations',
  'POST /api/v1/organizations/:organization_id/invitations',
  'POST /api/v1/organizations/:organization_id/invitations/accept',
  'PUT /api/v1/organizations/:organization_id/memberships/:user_id',
  'PUT /api/v1/organizations/:organization_id/selection',
  'GET /api/v1/organizations/:organization_id/uploads/:upload_id',
  'POST /api/v1/organizations/:organization_id/uploads',
  'POST /api/v1/organizations/:organization_id/uploads/:upload_id/completion',
  'PUT /api/v1/organizations/:organization_id/uploads/:upload_id/content',
]);

const defaultEnvironment: ServiceEnvironment = {
  AUTH_ENABLED: false,
  DRONE_WORKS_ENV: 'test',
  HOST: '127.0.0.1',
  LOCAL_IDENTITY_ENABLED: false,
  PORT: 1,
};

class OrganizationServiceUnavailableError extends Error {
  constructor() {
    super('Organization persistence is not configured.');
    this.name = 'OrganizationServiceUnavailableError';
  }
}

type OrganizationDependencies = OrganizationRouteDependencies['organizations'] &
  InvitationRouteDependencies['organizations'];

const unavailableOrganizations: OrganizationDependencies = {
  async acceptInvitation() {
    throw new OrganizationServiceUnavailableError();
  },
  async createInvitation() {
    throw new OrganizationServiceUnavailableError();
  },
  async createOrganization() {
    throw new OrganizationServiceUnavailableError();
  },
  async listMemberships() {
    throw new OrganizationServiceUnavailableError();
  },
  async putMembership() {
    throw new OrganizationServiceUnavailableError();
  },
  async removeMembership() {
    throw new OrganizationServiceUnavailableError();
  },
  async revokeInvitation() {
    throw new OrganizationServiceUnavailableError();
  },
  async selectOrganization() {
    throw new OrganizationServiceUnavailableError();
  },
};

const unavailableEmail: AuthEmailDelivery = {
  async send() {
    throw new OrganizationServiceUnavailableError();
  },
};

class RawUploadServiceUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Raw upload persistence is not configured.');
    this.name = 'RawUploadServiceUnavailableError';
  }
}

const unavailableUploads: RawUploadRouteDependencies['uploads'] = {
  async authorize() {
    throw new RawUploadServiceUnavailableError();
  },
  async complete() {
    throw new RawUploadServiceUnavailableError();
  },
  async declare() {
    throw new RawUploadServiceUnavailableError();
  },
  async get() {
    throw new RawUploadServiceUnavailableError();
  },
  async isVersionReferenced() {
    throw new RawUploadServiceUnavailableError();
  },
};

const unavailableImports: ImportRouteDependencies['imports'] = {
  async cancel() {
    throw new RawUploadServiceUnavailableError();
  },
  async declareBatch() {
    throw new RawUploadServiceUnavailableError();
  },
  async getBatch() {
    throw new RawUploadServiceUnavailableError();
  },
  async getStatus() {
    throw new RawUploadServiceUnavailableError();
  },
  async listBatches() {
    throw new RawUploadServiceUnavailableError();
  },
  async retry() {
    throw new RawUploadServiceUnavailableError();
  },
};

const unavailableFlights: FlightRouteDependencies['flights'] = {
  async listFlights() {
    throw new RawUploadServiceUnavailableError();
  },
  async getSummary() {
    throw new RawUploadServiceUnavailableError();
  },
  async getTrack() {
    throw new RawUploadServiceUnavailableError();
  },
};

const unavailableObjectStore: ImmutableObjectStore = {
  async deleteExact() {
    throw new RawUploadServiceUnavailableError();
  },
  async getExact() {
    throw new RawUploadServiceUnavailableError();
  },
  async headExact() {
    throw new RawUploadServiceUnavailableError();
  },
  async putIfAbsent() {
    throw new RawUploadServiceUnavailableError();
  },
};

function requestId(request: { headers: Record<string, unknown> }): string {
  const supplied = request.headers['x-correlation-id'];
  return typeof supplied === 'string' && correlationIdPattern.test(supplied)
    ? supplied
    : randomUUID();
}

function validationErrors(error: FastifyError) {
  if (!error.validation) {
    return undefined;
  }

  return error.validation.map((issue) => ({
    pointer: issue.instancePath || '/',
    message: issue.message ?? 'Invalid value.',
  }));
}

function problem(
  request: FastifyRequest,
  status: number,
  title: string,
  detail: string,
  errors?: Array<{ pointer: string; message: string }>,
) {
  return {
    type: `https://drone.works/problems/${status}`,
    title,
    status,
    detail,
    instance: request.url,
    correlation_id: request.id,
    ...(errors ? { errors } : {}),
  };
}

export interface BuildApiOptions {
  readonly auth?: VerifiedAuth;
  readonly email?: AuthEmailDelivery;
  readonly environment?: ServiceEnvironment;
  readonly identitySource?: IdentitySource;
  readonly flights?: Pick<
    FlightReadRepository,
    'getSummary' | 'getTrack' | 'listFlights'
  >;
  readonly imports?: Pick<
    ImportProcessingRepository,
    | 'cancel'
    | 'declareBatch'
    | 'getBatch'
    | 'getStatus'
    | 'listBatches'
    | 'retry'
  >;
  readonly organizations?: OrganizationDependencies;
  readonly publicWebUrl?: string;
  readonly objectStore?: ImmutableObjectStore;
  readonly uploads?: Pick<
    RawUploadRepository,
    'authorize' | 'complete' | 'declare' | 'get' | 'isVersionReferenced'
  >;
}

export async function buildApi(options: BuildApiOptions = {}) {
  const environment = options.environment ?? defaultEnvironment;
  const identitySource =
    options.identitySource ?? new UnavailableIdentitySource();
  assertIdentityConfiguration(environment, identitySource);
  const authRouteInventory = new Set<string>();
  const routeInventory = new Set<string>();
  const controlRouteInventory = new Set<string>();
  const app = Fastify({
    bodyLimit: 33_554_432,
    exposeHeadRoutes: false,
    genReqId: requestId,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (route.url.startsWith('/api/v1/')) {
        routeInventory.add(`${method} ${route.url}`);
      }
      if (route.url.startsWith('/api/auth/')) {
        authRouteInventory.add(`${method} ${route.url}`);
      }
      if (route.url.startsWith('/_local/')) {
        controlRouteInventory.add(`${method} ${route.url}`);
      }
    }
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Drone.Works API',
        version: '1.0.0',
      },
      openapi: '3.1.0',
    },
  });

  app.addSchema(problemErrorSchema);
  app.addSchema(problemDetailSchema);
  app.addSchema(healthResponseSchema);
  app.addSchema(organizationPathSchema);
  app.addSchema(membershipPathSchema);
  app.addSchema(createOrganizationBodySchema);
  app.addSchema(organizationSelectionSchema);
  app.addSchema(putMembershipBodySchema);
  app.addSchema(membershipSchema);
  app.addSchema(membershipListSchema);
  app.addSchema(invitationPathSchema);
  app.addSchema(createInvitationBodySchema);
  app.addSchema(acceptInvitationBodySchema);
  app.addSchema(invitationSchema);
  app.addSchema(rawUploadPathSchema);
  app.addSchema(idempotencyHeadersSchema);
  app.addSchema(declareRawUploadBodySchema);
  app.addSchema(rawUploadDeclarationSchema);
  app.addSchema(rawUploadContentSchema);
  app.addSchema(completeRawUploadBodySchema);
  app.addSchema(rawUploadSchema);
  app.addSchema(importPathSchema);
  app.addSchema(importStatusSchema);
  app.addSchema(importBatchPathSchema);
  app.addSchema(importBatchListQuerySchema);
  app.addSchema(declareImportBatchBodySchema);
  app.addSchema(importBatchDeclarationItemSchema);
  app.addSchema(importBatchDeclarationSchema);
  app.addSchema(importAttemptSchema);
  app.addSchema(importBatchItemSchema);
  app.addSchema(importBatchSummarySchema);
  app.addSchema(importBatchSchema);
  app.addSchema(importBatchListSchema);
  app.addSchema(flightPathSchema);
  app.addSchema(flightFactsSchema);
  app.addSchema(flightTelemetrySummarySchema);
  app.addSchema(flightSummarySchema);
  app.addSchema(flightListQuerySchema);
  app.addSchema(flightListTotalsSchema);
  app.addSchema(flightListSchema);
  app.addSchema(flightTrackQuerySchema);
  app.addSchema(flightTrackPointSchema);
  app.addSchema(flightTelemetryRangeSchema);
  app.addSchema(flightTrackStatisticsSchema);
  app.addSchema(flightTrackSchema);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    return payload;
  });

  if (options.auth) registerAuthRoutes(app, options.auth);

  app.get(
    '/api/v1/health',
    {
      schema: {
        operationId: 'getApiHealth',
        querystring: healthQuerySchema,
        response: {
          200: {
            description: 'The API process is live.',
            headers: {
              'x-correlation-id': {
                description: 'Request correlation identifier.',
                type: 'string',
              },
            },
            content: {
              'application/json': { schema: healthResponseSchema },
            },
          },
          '4xx': {
            description: 'The request could not be accepted.',
            content: {
              'application/problem+json': { schema: problemDetailSchema },
            },
          },
          '5xx': {
            description: 'The request could not be completed.',
            content: {
              'application/problem+json': { schema: problemDetailSchema },
            },
          },
        },
        summary: 'Check API liveness',
        tags: ['system'],
      },
    },
    async () => ({ status: 'ok', service: 'api', version: 'v1' }) as const,
  );

  registerOrganizationRoutes(app, {
    identitySource,
    organizations: options.organizations ?? unavailableOrganizations,
  });
  registerInvitationRoutes(app, {
    email: options.email ?? unavailableEmail,
    identitySource,
    organizations: options.organizations ?? unavailableOrganizations,
    publicWebUrl: options.publicWebUrl ?? 'http://127.0.0.1',
  });
  registerRawUploadRoutes(app, {
    identitySource,
    objectStore: options.objectStore ?? unavailableObjectStore,
    uploads: options.uploads ?? unavailableUploads,
  });
  registerImportRoutes(app, {
    identitySource,
    imports: options.imports ?? unavailableImports,
  });
  registerFlightRoutes(app, {
    identitySource,
    flights: options.flights ?? unavailableFlights,
  });

  if (identitySource instanceof GeneratedPersonaIdentitySource) {
    const personaSchema = Type.Union(
      generatedPersonaNames.map((persona) => Type.Literal(persona)) as [
        ReturnType<typeof Type.Literal>,
        ...ReturnType<typeof Type.Literal>[],
      ],
    );
    app.post<{ Body: { persona: (typeof generatedPersonaNames)[number] } }>(
      '/_local/generated-personas/select',
      {
        schema: {
          hide: true,
          body: Type.Object(
            { persona: personaSchema },
            { additionalProperties: false },
          ),
          response: {
            200: Type.Object(
              {
                persona: personaSchema,
                token: Type.String({
                  pattern:
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
                }),
              },
              { additionalProperties: false },
            ),
          },
        },
      },
      async (request) => {
        const token = identitySource.issue(request.body.persona);
        if (!token) throw new IdentityRequiredError();
        return { persona: request.body.persona, token };
      },
    );
  }

  app.setNotFoundHandler(async (request, reply) => {
    const status = 404;
    return reply
      .code(status)
      .type('application/problem+json')
      .send(
        problem(
          request,
          status,
          'Not Found',
          'The requested route was not found.',
        ),
      );
  });

  app.setErrorHandler(async (error, request, reply) => {
    const fastifyError = error as FastifyError;
    const status =
      error instanceof IdentityRequiredError
        ? 401
        : error instanceof OrganizationAccessDeniedError
          ? 404
          : error instanceof LastOwnerError
            ? 409
            : fastifyError.validation
              ? 400
              : fastifyError.statusCode &&
                  fastifyError.statusCode >= 400 &&
                  fastifyError.statusCode <= 599
                ? fastifyError.statusCode
                : 500;
    const title =
      status === 400
        ? 'Invalid Request'
        : status === 401
          ? 'Identity Required'
          : status === 404
            ? 'Not Found'
            : status === 409
              ? 'Conflict'
              : status === 413
                ? 'Payload Too Large'
                : status === 415
                  ? 'Unsupported Media Type'
                  : status === 503
                    ? 'Service Unavailable'
                    : 'Internal Server Error';
    const detail = fastifyError.validation
      ? 'The request did not match the documented contract.'
      : status === 401
        ? 'A current identity is required.'
        : status === 404
          ? 'The requested organization resource was not found.'
          : error instanceof LastOwnerError
            ? 'The organization must retain at least one owner.'
            : status >= 400 && status < 500
              ? fastifyError.message
              : error instanceof FlightTelemetryUnavailableError
                ? 'The flight telemetry is temporarily unavailable.'
                : status === 503
                  ? 'The requested service is temporarily unavailable.'
                  : 'The request could not be completed.';

    return reply
      .code(status)
      .type('application/problem+json')
      .send(
        problem(request, status, title, detail, validationErrors(fastifyError)),
      );
  });

  await app.ready();
  return { app, authRouteInventory, controlRouteInventory, routeInventory };
}
