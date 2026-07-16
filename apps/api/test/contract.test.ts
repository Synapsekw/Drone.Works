import { afterEach, describe, expect, it } from 'vitest';

import { buildApi, documentedApiRoutes } from '../src/app.js';

const applications: Array<Awaited<ReturnType<typeof buildApi>>['app']> = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('versioned API contract', () => {
  it('serves the documented v1 health response and correlation ID', async () => {
    const built = await buildApi();
    applications.push(built.app);

    const response = await built.app.inject({
      headers: { 'x-correlation-id': 'contract-test-1' },
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'api',
      version: 'v1',
    });
    expect(response.headers['x-correlation-id']).toBe('contract-test-1');
  });

  it('rejects unknown query fields with RFC 9457 problem details', async () => {
    const built = await buildApi();
    applications.push(built.app);

    const response = await built.app.inject({
      method: 'GET',
      url: '/api/v1/health?unexpected=true',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.json()).toMatchObject({
      type: 'https://drone.works/problems/400',
      title: 'Invalid Request',
      status: 400,
      detail: 'The request did not match the documented contract.',
      instance: '/api/v1/health?unexpected=true',
    });
  });

  it('uses one safe not-found response for undocumented routes', async () => {
    const built = await buildApi();
    applications.push(built.app);

    const response = await built.app.inject({
      method: 'GET',
      url: '/api/v1/unknown',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.json()).toMatchObject({
      title: 'Not Found',
      status: 404,
    });
  });

  it('keeps implementation and documented route inventories equal', async () => {
    const built = await buildApi();
    applications.push(built.app);

    expect([...built.routeInventory].sort()).toEqual(
      [...documentedApiRoutes].sort(),
    );
    expect(Object.keys(built.app.swagger().paths ?? {})).toEqual([
      '/api/v1/health',
    ]);
  });
});
