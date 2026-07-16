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
  healthQuerySchema,
  healthResponseSchema,
  membershipListSchema,
  membershipPathSchema,
  membershipSchema,
  organizationPathSchema,
  organizationSelectionSchema,
  problemDetailSchema,
  problemErrorSchema,
  putMembershipBodySchema,
} from '@drone-works/contracts/server';
import type { ServiceEnvironment } from '@drone-works/config';
import {
  LastOwnerError,
  OrganizationAccessDeniedError,
} from '@drone-works/database';

import {
  assertIdentityConfiguration,
  generatedPersonaNames,
  GeneratedPersonaIdentitySource,
  IdentityRequiredError,
  UnavailableIdentitySource,
  type IdentitySource,
} from './identity.js';
import {
  registerOrganizationRoutes,
  type OrganizationRouteDependencies,
} from './organization-routes.js';

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const documentedApiRoutes = new Set([
  'DELETE /api/v1/organizations/:organization_id/memberships/:user_id',
  'GET /api/v1/health',
  'GET /api/v1/organizations/:organization_id/memberships',
  'POST /api/v1/organizations',
  'PUT /api/v1/organizations/:organization_id/memberships/:user_id',
  'PUT /api/v1/organizations/:organization_id/selection',
]);

const defaultEnvironment: ServiceEnvironment = {
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

const unavailableOrganizations: OrganizationRouteDependencies['organizations'] =
  {
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
    async selectOrganization() {
      throw new OrganizationServiceUnavailableError();
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
  readonly environment?: ServiceEnvironment;
  readonly identitySource?: IdentitySource;
  readonly organizations?: OrganizationRouteDependencies['organizations'];
}

export async function buildApi(options: BuildApiOptions = {}) {
  const environment = options.environment ?? defaultEnvironment;
  const identitySource =
    options.identitySource ?? new UnavailableIdentitySource();
  assertIdentityConfiguration(environment, identitySource);
  const routeInventory = new Set<string>();
  const controlRouteInventory = new Set<string>();
  const app = Fastify({
    bodyLimit: 1_048_576,
    exposeHeadRoutes: false,
    genReqId: requestId,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (route.url.startsWith('/api/')) {
        routeInventory.add(`${method} ${route.url}`);
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

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    return payload;
  });

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
              : 'Internal Server Error';
    const detail =
      status === 400
        ? 'The request did not match the documented contract.'
        : status === 401
          ? 'A current identity is required.'
          : status === 404
            ? 'The requested organization resource was not found.'
            : status === 409
              ? 'The organization must retain at least one owner.'
              : 'The request could not be completed.';

    return reply
      .code(status)
      .type('application/problem+json')
      .send(
        problem(request, status, title, detail, validationErrors(fastifyError)),
      );
  });

  await app.ready();
  return { app, controlRouteInventory, routeInventory };
}
