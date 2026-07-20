import type { FastifyInstance } from 'fastify';

import type { VerifiedAuth } from './auth.js';

function requestHeaders(values: Record<string, unknown>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string') headers.append(name, value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') headers.append(name, item);
      }
    }
  }
  return headers;
}

function requestBody(value: unknown): BodyInit | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Uint8Array.from(value).buffer;
  return JSON.stringify(value);
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: VerifiedAuth,
): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, auth.options.baseURL);
      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : requestBody(request.body);
      const response = await auth.handler(
        new Request(url, {
          ...(body === undefined ? {} : { body }),
          headers: requestHeaders(request.headers),
          method: request.method,
        }),
      );
      reply.code(response.status);
      const setCookies = response.headers.getSetCookie();
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') reply.header(name, value);
      });
      if (setCookies.length) reply.header('set-cookie', setCookies);
      if (!response.body) return reply.send();
      return reply.send(await response.text());
    },
  });
}
