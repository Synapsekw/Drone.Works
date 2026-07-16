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

import {
  healthQuerySchema,
  healthResponseSchema,
  problemDetailSchema,
  problemErrorSchema,
} from '@drone-works/contracts/server';

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const documentedApiRoutes = new Set(['GET /api/v1/health']);

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

export async function buildApi() {
  const routeInventory = new Set<string>();
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
    const status = fastifyError.validation
      ? 400
      : fastifyError.statusCode &&
          fastifyError.statusCode >= 400 &&
          fastifyError.statusCode <= 599
        ? fastifyError.statusCode
        : 500;
    const title = status === 400 ? 'Invalid Request' : 'Internal Server Error';
    const detail =
      status === 400
        ? 'The request did not match the documented contract.'
        : 'The request could not be completed.';

    return reply
      .code(status)
      .type('application/problem+json')
      .send(
        problem(request, status, title, detail, validationErrors(fastifyError)),
      );
  });

  await app.ready();
  return { app, routeInventory };
}
