import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createApplicationPool,
  OrganizationAuthorizationRepository,
  withOrganizationTransaction,
} from '@drone-works/database';

import { buildApi } from '../dist/app.js';
import {
  createIdentitySource,
  generatedPersonas,
  GeneratedPersonaIdentitySource,
  IdentityConfigurationError,
  UnavailableIdentitySource,
} from '../dist/identity.js';

const alphaOrganizationId = '00000000-0000-4000-8000-0000000000a1';
const betaOrganizationId = '00000000-0000-4000-8000-0000000000b1';
const localEnvironment = {
  DRONE_WORKS_ENV: 'test',
  HOST: '127.0.0.1',
  LOCAL_IDENTITY_ENABLED: true,
  PORT: 1,
};
const hostedEnvironment = {
  DRONE_WORKS_ENV: 'staging',
  HOST: '127.0.0.1',
  LOCAL_IDENTITY_ENABLED: false,
  PORT: 1,
};

let app;
let identitySource;
let pool;
const tokens = new Map();
let createdOrganizationId;

async function token(persona) {
  const existing = tokens.get(persona);
  if (existing) return existing;
  const response = await app.inject({
    method: 'POST',
    url: '/_local/generated-personas/select',
    payload: { persona },
  });
  expect(response.statusCode).toBe(200);
  const issued = response.json().token;
  tokens.set(persona, issued);
  return issued;
}

async function request(persona, options) {
  return app.inject({
    ...options,
    headers: {
      'x-drone-works-local-persona-token': await token(persona),
      ...options.headers,
    },
  });
}

beforeAll(async () => {
  pool = createApplicationPool({
    database: process.env.PGDATABASE,
    host: process.env.PGHOST,
    max: 1,
    port: Number(process.env.PGPORT),
    user: 'droneworks_app',
  });
  identitySource = createIdentitySource(localEnvironment);
  const built = await buildApi({
    environment: localEnvironment,
    identitySource,
    organizations: new OrganizationAuthorizationRepository(pool),
  });
  app = built.app;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.sequential('A05 identity seam and organization authorization', () => {
  it('requires the explicit local/test interlock and rejects arbitrary personas', async () => {
    expect(identitySource).toBeInstanceOf(GeneratedPersonaIdentitySource);
    const localRoutes = await buildApi({
      environment: localEnvironment,
      identitySource: new GeneratedPersonaIdentitySource(),
    });
    expect([...localRoutes.controlRouteInventory]).toEqual([
      'POST /_local/generated-personas/select',
    ]);
    expect(localRoutes.app.swagger().paths).not.toHaveProperty(
      '/_local/generated-personas/select',
    );
    await localRoutes.app.close();

    const arbitrary = await app.inject({
      method: 'POST',
      url: '/_local/generated-personas/select',
      payload: {
        persona: 'arbitrary-user',
        user_id: generatedPersonas.alpha_owner.userId,
        organization_id: alphaOrganizationId,
        role: 'owner',
      },
    });
    expect(arbitrary.statusCode).toBe(400);

    const forgedToken = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/selection`,
      headers: {
        'x-drone-works-local-persona-token':
          generatedPersonas.alpha_owner.userId,
      },
    });
    expect(forgedToken.statusCode).toBe(401);

    const hosted = await buildApi({
      environment: hostedEnvironment,
      identitySource: new UnavailableIdentitySource(),
    });
    expect([...hosted.controlRouteInventory]).toEqual([]);
    expect(Object.keys(hosted.app.swagger().paths)).not.toContain(
      '/_local/generated-personas/select',
    );
    await hosted.app.close();

    expect(() =>
      createIdentitySource({
        ...hostedEnvironment,
        DRONE_WORKS_ENV: 'production',
        LOCAL_IDENTITY_ENABLED: true,
      }),
    ).toThrow(IdentityConfigurationError);
    expect(
      createIdentitySource({
        ...localEnvironment,
        LOCAL_IDENTITY_ENABLED: false,
      }),
    ).toBeInstanceOf(UnavailableIdentitySource);
    expect(() =>
      createIdentitySource({
        ...hostedEnvironment,
        LOCAL_IDENTITY_ENABLED: true,
      }),
    ).toThrow(IdentityConfigurationError);
    await expect(
      buildApi({
        environment: hostedEnvironment,
        identitySource: new GeneratedPersonaIdentitySource(),
      }),
    ).rejects.toBeInstanceOf(IdentityConfigurationError);
    await expect(
      buildApi({
        environment: {
          ...localEnvironment,
          LOCAL_IDENTITY_ENABLED: false,
        },
        identitySource: new GeneratedPersonaIdentitySource(),
      }),
    ).rejects.toBeInstanceOf(IdentityConfigurationError);
  });

  it('keeps Alpha and Beta exact IDs indistinguishable through one pooled backend', async () => {
    const alpha = await request('alpha_owner', {
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/selection`,
    });
    expect(alpha.statusCode).toBe(200);
    expect(alpha.json()).toMatchObject({
      organization_id: alphaOrganizationId,
      role: 'owner',
    });

    const alphaToBeta = await request('alpha_owner', {
      method: 'PUT',
      url: `/api/v1/organizations/${betaOrganizationId}/selection`,
    });
    const betaToAlpha = await request('beta_owner', {
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/selection`,
    });
    expect(alphaToBeta.statusCode).toBe(404);
    expect(betaToAlpha.statusCode).toBe(404);
    expect(alphaToBeta.json()).toMatchObject({
      title: 'Not Found',
      status: 404,
      detail: 'The requested organization resource was not found.',
    });
    expect(betaToAlpha.json()).toMatchObject({
      title: 'Not Found',
      status: 404,
      detail: 'The requested organization resource was not found.',
    });

    const alphaPid = await withOrganizationTransaction(
      pool,
      alphaOrganizationId,
      async (transaction) =>
        (await transaction.query('SELECT pg_backend_pid()::integer AS pid'))
          .rows[0].pid,
    );
    const beta = await request('beta_owner', {
      method: 'PUT',
      url: `/api/v1/organizations/${betaOrganizationId}/selection`,
    });
    expect(beta.statusCode).toBe(200);
    const cleared = await pool.query(
      `SELECT pg_backend_pid()::integer AS pid,
              current_setting('app.organization_id', true) AS organization_id,
              (SELECT count(*)::integer FROM droneworks.organizations) AS count`,
    );
    expect(cleared.rows[0].pid).toBe(alphaPid);
    expect([null, '']).toContain(cleared.rows[0].organization_id);
    expect(cleared.rows[0].count).toBe(0);
  });

  it('creates a server-ID organization with owner membership, pilot link, and redacted audits', async () => {
    const response = await request('alpha_owner', {
      method: 'POST',
      url: '/api/v1/organizations',
      payload: {
        name: 'Generated Authorization Organization',
        default_timezone: 'Asia/Dubai',
        unit_system: 'metric',
      },
    });
    expect(response.statusCode).toBe(201);
    const created = response.json();
    createdOrganizationId = created.organization_id;
    expect(created).toMatchObject({
      role: 'owner',
      name: 'Generated Authorization Organization',
      default_timezone: 'Asia/Dubai',
      unit_system: 'metric',
    });
    expect(created.pilot_profile_id).toMatch(/^[0-9a-f-]{36}$/);

    await withOrganizationTransaction(
      pool,
      createdOrganizationId,
      async (transaction) => {
        const owner = await transaction.query(
          `SELECT membership.role, pilot.id AS pilot_id
             FROM droneworks.memberships AS membership
             JOIN droneworks.pilot_profiles AS pilot
               ON (pilot.organization_id, pilot.membership_user_id) =
                  (membership.organization_id, membership.user_id)
            WHERE membership.user_id = $1`,
          [generatedPersonas.alpha_owner.userId],
        );
        expect(owner.rows).toEqual([
          { role: 'owner', pilot_id: created.pilot_profile_id },
        ]);
        const audits = await transaction.query(
          `SELECT action, changed_fields, metadata
             FROM droneworks.audit_events
            ORDER BY occurred_at, action`,
        );
        expect(audits.rows).toHaveLength(3);
        for (const audit of audits.rows) expect(audit.metadata).toEqual({});
        expect(JSON.stringify(audits.rows)).not.toContain(
          'Generated Authorization Organization',
        );
        expect(JSON.stringify(audits.rows)).not.toContain(
          'Generated Alpha Owner',
        );
      },
    );
  });

  it('enforces the owner/admin/pilot/viewer role matrix from canonical membership', async () => {
    const roleTargets = [
      ['alpha_admin', 'admin'],
      ['alpha_pilot', 'pilot'],
      ['alpha_viewer', 'viewer'],
    ];
    for (const [persona, role] of roleTargets) {
      const response = await request('alpha_owner', {
        method: 'PUT',
        url: `/api/v1/organizations/${alphaOrganizationId}/memberships/${generatedPersonas[persona].userId}`,
        payload: { role },
      });
      expect(response.statusCode).toBe(200);
    }

    for (const persona of [
      'alpha_owner',
      'alpha_admin',
      'alpha_pilot',
      'alpha_viewer',
    ]) {
      const selection = await request(persona, {
        method: 'PUT',
        url: `/api/v1/organizations/${alphaOrganizationId}/selection`,
      });
      expect(selection.statusCode).toBe(200);
    }
    for (const [persona, expected] of [
      ['alpha_owner', 200],
      ['alpha_admin', 200],
      ['alpha_pilot', 404],
      ['alpha_viewer', 404],
    ]) {
      const memberships = await request(persona, {
        method: 'GET',
        url: `/api/v1/organizations/${alphaOrganizationId}/memberships`,
      });
      expect(memberships.statusCode).toBe(expected);
    }

    for (const persona of ['alpha_pilot', 'alpha_viewer']) {
      const denied = await request(persona, {
        method: 'PUT',
        url: `/api/v1/organizations/${alphaOrganizationId}/memberships/${generatedPersonas.alpha_removed_member.userId}`,
        payload: { role: 'viewer' },
      });
      expect(denied.statusCode).toBe(404);
    }
    const adminCreated = await request('alpha_admin', {
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/memberships/${generatedPersonas.alpha_removed_member.userId}`,
      payload: { role: 'viewer' },
    });
    expect(adminCreated.statusCode).toBe(200);
    const adminCannotCreateOwner = await request('alpha_admin', {
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/memberships/${generatedPersonas.alpha_second_owner.userId}`,
      payload: { role: 'owner' },
    });
    expect(adminCannotCreateOwner.statusCode).toBe(404);
    const arbitraryRole = await request('alpha_owner', {
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/memberships/${generatedPersonas.alpha_removed_member.userId}`,
      payload: { role: 'superuser' },
    });
    expect(arbitraryRole.statusCode).toBe(400);
  });

  it('blocks the next operation immediately after membership removal', async () => {
    const before = await request('alpha_removed_member', {
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/selection`,
    });
    expect(before.statusCode).toBe(200);
    const removal = await request('alpha_owner', {
      method: 'DELETE',
      url: `/api/v1/organizations/${alphaOrganizationId}/memberships/${generatedPersonas.alpha_removed_member.userId}`,
    });
    expect(removal.statusCode).toBe(204);
    const after = await request('alpha_removed_member', {
      method: 'PUT',
      url: `/api/v1/organizations/${alphaOrganizationId}/selection`,
    });
    expect(after.statusCode).toBe(404);
  });

  it('prevents last-owner removal or demotion and preserves the departing pilot', async () => {
    for (const operation of [
      {
        method: 'DELETE',
        url: `/api/v1/organizations/${createdOrganizationId}/memberships/${generatedPersonas.alpha_owner.userId}`,
      },
      {
        method: 'PUT',
        url: `/api/v1/organizations/${createdOrganizationId}/memberships/${generatedPersonas.alpha_owner.userId}`,
        payload: { role: 'admin' },
      },
    ]) {
      const response = await request('alpha_owner', operation);
      expect(response.statusCode).toBe(409);
    }

    const addOwner = await request('alpha_owner', {
      method: 'PUT',
      url: `/api/v1/organizations/${createdOrganizationId}/memberships/${generatedPersonas.alpha_second_owner.userId}`,
      payload: { role: 'owner' },
    });
    expect(addOwner.statusCode).toBe(200);
    const removeOriginal = await request('alpha_second_owner', {
      method: 'DELETE',
      url: `/api/v1/organizations/${createdOrganizationId}/memberships/${generatedPersonas.alpha_owner.userId}`,
    });
    expect(removeOriginal.statusCode).toBe(204);
    const originalDenied = await request('alpha_owner', {
      method: 'PUT',
      url: `/api/v1/organizations/${createdOrganizationId}/selection`,
    });
    expect(originalDenied.statusCode).toBe(404);
    const lastOwner = await request('alpha_second_owner', {
      method: 'DELETE',
      url: `/api/v1/organizations/${createdOrganizationId}/memberships/${generatedPersonas.alpha_second_owner.userId}`,
    });
    expect(lastOwner.statusCode).toBe(409);

    await withOrganizationTransaction(
      pool,
      createdOrganizationId,
      async (transaction) => {
        const retainedPilot = await transaction.query(
          `SELECT membership_user_id, active
             FROM droneworks.pilot_profiles
            WHERE id = $1`,
          [
            (
              await transaction.query(
                `SELECT resource_id
                   FROM droneworks.audit_events
                  WHERE action = 'pilot_profile.created'`,
              )
            ).rows[0].resource_id,
          ],
        );
        expect(retainedPilot.rows).toEqual([
          { membership_user_id: null, active: true },
        ]);
        const audits = await transaction.query(
          'SELECT metadata FROM droneworks.audit_events',
        );
        for (const audit of audits.rows) expect(audit.metadata).toEqual({});
      },
    );
  });
});
