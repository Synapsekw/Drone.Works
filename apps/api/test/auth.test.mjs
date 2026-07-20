import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createApplicationPool,
  OrganizationAuthorizationRepository,
} from '@drone-works/database';

import { buildApi } from '../dist/app.js';
import { betterAuthVersion, createVerifiedAuth } from '../dist/auth.js';
import {
  createIdentitySource,
  VerifiedSessionIdentitySource,
} from '../dist/identity.js';

const { Pool } = pg;
const baseUrl = 'http://127.0.0.1:3000';
const authEnvironment = {
  AUTH_ENABLED: true,
  DRONE_WORKS_ENV: 'test',
  HOST: '127.0.0.1',
  LOCAL_IDENTITY_ENABLED: false,
  PORT: 1,
};
const password = 'Generated-A13b-password-42';

let app;
let appPool;
let auth;
let authPool;
let identitySource;
let ownerCookie;
let ownerOrganizationId;
let ownerUserId;
let invitedCookie;
let invitedUserId;
const messages = [];

function cookie(response) {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(';', 1)[0] ?? null;
}

async function authRequest(
  method,
  path,
  payload,
  currentCookie,
  origin = baseUrl,
) {
  return app.inject({
    method,
    url: path,
    ...(payload === undefined ? {} : { payload }),
    headers: {
      accept: 'application/json',
      origin,
      ...(currentCookie ? { cookie: currentCookie } : {}),
    },
  });
}

async function verifyLatest(recipient) {
  const message = [...messages]
    .reverse()
    .find(
      (candidate) =>
        candidate.kind === 'verification' && candidate.recipient === recipient,
    );
  expect(message).toBeTruthy();
  const url = new URL(message.url);
  const response = await authRequest('GET', `${url.pathname}${url.search}`);
  expect([200, 302]).toContain(response.statusCode);
}

async function registerVerified(email, name) {
  const signup = await authRequest('POST', '/api/auth/sign-up/email', {
    email,
    name,
    password,
  });
  expect(signup.statusCode).toBe(200);
  expect(cookie(signup)).toBeNull();
  await verifyLatest(email);
  const signin = await authRequest('POST', '/api/auth/sign-in/email', {
    email,
    password,
  });
  expect(signin.statusCode).toBe(200);
  const sessionCookie = cookie(signin);
  expect(sessionCookie).toMatch(/^droneworks\.session_token=/);
  const session = await authRequest(
    'GET',
    '/api/auth/get-session',
    undefined,
    sessionCookie,
  );
  expect(session.statusCode).toBe(200);
  expect(session.json().user).toMatchObject({ email, emailVerified: true });
  return { cookie: sessionCookie, userId: session.json().user.id };
}

async function domain(currentCookie, options) {
  return app.inject({
    ...options,
    headers: {
      accept: 'application/json',
      cookie: currentCookie,
      origin: baseUrl,
      ...options.headers,
    },
  });
}

beforeAll(async () => {
  appPool = createApplicationPool({
    database: process.env.PGDATABASE,
    host: process.env.PGHOST,
    max: 1,
    port: Number(process.env.PGPORT),
    user: 'droneworks_app',
  });
  authPool = new Pool({
    database: process.env.PGDATABASE,
    host: process.env.PGHOST,
    max: 2,
    options: '-c search_path=droneworks_auth,pg_catalog',
    port: Number(process.env.PGPORT),
    user: 'droneworks_auth',
  });
  const organizations = new OrganizationAuthorizationRepository(appPool);
  const email = {
    async send(message) {
      messages.push(message);
    },
  };
  auth = createVerifiedAuth({
    baseUrl,
    beforeDeleteUser: (userId) => organizations.prepareAuthUserDeletion(userId),
    email,
    pool: authPool,
    secret: 'generated-a13b-auth-secret-for-tests-only',
    secureCookies: false,
    trustedOrigins: [baseUrl],
  });
  identitySource = createIdentitySource(authEnvironment, auth);
  const built = await buildApi({
    auth,
    email,
    environment: authEnvironment,
    identitySource,
    organizations,
    publicWebUrl: baseUrl,
  });
  app = built.app;
});

afterAll(async () => {
  await app?.close();
  await authPool?.end();
  await appPool?.end();
});

describe.sequential(
  'A13b verified sessions and app-owned authorization',
  () => {
    it('pins the provider, reviewed schema, hosted routes, and secure controls', async () => {
      expect(identitySource).toBeInstanceOf(VerifiedSessionIdentitySource);
      expect(betterAuthVersion).toBe('1.6.23');
      expect(auth.options.advanced).toMatchObject({
        disableCSRFCheck: false,
        disableOriginCheck: false,
        trustedProxyHeaders: false,
      });
      expect(auth.options.rateLimit).toMatchObject({ enabled: true });
      const secureAuth = createVerifiedAuth({
        baseUrl: 'https://auth.example.test',
        beforeDeleteUser: async () => undefined,
        email: { send: async () => undefined },
        pool: authPool,
        secret: 'generated-a13b-secure-auth-secret-test',
        secureCookies: true,
        trustedOrigins: ['https://auth.example.test'],
      });
      expect(secureAuth.options.advanced).toMatchObject({
        defaultCookieAttributes: {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
        },
        useSecureCookies: true,
      });
      const migrations = await getMigrations(auth.options);
      expect(migrations.toBeCreated).toEqual([]);
      expect(migrations.toBeAdded).toEqual([]);

      const hosted = await buildApi({
        auth,
        email: { send: async () => undefined },
        environment: { ...authEnvironment, DRONE_WORKS_ENV: 'staging' },
        identitySource: createIdentitySource(
          { ...authEnvironment, DRONE_WORKS_ENV: 'staging' },
          auth,
        ),
      });
      expect([...hosted.controlRouteInventory]).toEqual([]);
      expect([...hosted.authRouteInventory]).toEqual([
        'GET /api/auth/*',
        'POST /api/auth/*',
      ]);
      expect(hosted.app.swagger().paths).not.toHaveProperty(
        '/_local/generated-personas/select',
      );
      await hosted.app.close();
    });

    it('registers, verifies, signs in, and creates an owned organization', async () => {
      const owner = await registerVerified(
        'owner-a13b@example.test',
        'Owner A13b',
      );
      ownerCookie = owner.cookie;
      ownerUserId = owner.userId;
      const created = await domain(ownerCookie, {
        method: 'POST',
        url: '/api/v1/organizations',
        payload: {
          default_timezone: 'Asia/Dubai',
          name: 'Verified Alpha',
          unit_system: 'metric',
        },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ role: 'owner' });
      ownerOrganizationId = created.json().organization_id;
    });

    it('rejects unverified, cross-origin, open-redirect, and forged claim access', async () => {
      const unverified = await authRequest('POST', '/api/auth/sign-up/email', {
        email: 'unverified-a13b@example.test',
        name: 'Unverified A13b',
        password,
      });
      expect(unverified.statusCode).toBe(200);
      const deniedSignin = await authRequest(
        'POST',
        '/api/auth/sign-in/email',
        {
          email: 'unverified-a13b@example.test',
          password,
        },
      );
      expect(deniedSignin.statusCode).toBe(403);

      const crossOrigin = await authRequest(
        'POST',
        '/api/auth/sign-up/email',
        {
          email: 'cross-origin-a13b@example.test',
          name: 'Cross Origin',
          password,
        },
        undefined,
        'https://untrusted.example',
      );
      expect(crossOrigin.statusCode).toBe(403);
      const redirect = await authRequest(
        'POST',
        '/api/auth/send-verification-email',
        {
          callbackURL: 'https://untrusted.example/landing',
          email: 'unverified-a13b@example.test',
        },
      );
      expect(redirect.statusCode).toBe(403);

      const selected = await domain(ownerCookie, {
        method: 'PUT',
        url: `/api/v1/organizations/${ownerOrganizationId}/selection`,
        headers: {
          'x-provider-active-organization': 'forged-beta',
          'x-provider-role': 'viewer',
        },
      });
      expect(selected.statusCode).toBe(200);
      expect(selected.json().role).toBe('owner');
    });

    it('uses verified-email single-use invitations and immediate membership revocation', async () => {
      const invited = await registerVerified(
        'invited-a13b@example.test',
        'Invited A13b',
      );
      invitedCookie = invited.cookie;
      invitedUserId = invited.userId;
      const invitation = await domain(ownerCookie, {
        method: 'POST',
        url: `/api/v1/organizations/${ownerOrganizationId}/invitations`,
        payload: { email: 'Invited-A13b@Example.Test', role: 'viewer' },
      });
      expect(invitation.statusCode).toBe(201);
      expect(invitation.json()).toMatchObject({ role: 'viewer' });
      const message = [...messages]
        .reverse()
        .find((candidate) => candidate.kind === 'invitation');
      const invitationUrl = new URL(message.url);
      const wrongEmail = await domain(ownerCookie, {
        method: 'POST',
        url: `/api/v1/organizations/${ownerOrganizationId}/invitations/accept`,
        payload: { token: invitationUrl.searchParams.get('invitation_token') },
      });
      expect(wrongEmail.statusCode).toBe(404);
      const accepted = await domain(invitedCookie, {
        method: 'POST',
        url: `/api/v1/organizations/${ownerOrganizationId}/invitations/accept`,
        payload: { token: invitationUrl.searchParams.get('invitation_token') },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({
        role: 'viewer',
        user_id: invitedUserId,
      });
      const replay = await domain(invitedCookie, {
        method: 'POST',
        url: `/api/v1/organizations/${ownerOrganizationId}/invitations/accept`,
        payload: { token: invitationUrl.searchParams.get('invitation_token') },
      });
      expect(replay.statusCode).toBe(404);

      const claimMismatch = await domain(invitedCookie, {
        method: 'PUT',
        url: `/api/v1/organizations/${ownerOrganizationId}/selection`,
        headers: {
          'x-provider-active-organization': ownerOrganizationId,
          'x-provider-role': 'owner',
        },
      });
      expect(claimMismatch.statusCode).toBe(200);
      expect(claimMismatch.json().role).toBe('viewer');

      const removed = await domain(ownerCookie, {
        method: 'DELETE',
        url: `/api/v1/organizations/${ownerOrganizationId}/memberships/${invitedUserId}`,
      });
      expect(removed.statusCode).toBe(204);
      const denied = await domain(invitedCookie, {
        method: 'PUT',
        url: `/api/v1/organizations/${ownerOrganizationId}/selection`,
      });
      expect(denied.statusCode).toBe(404);
      const sessionStillExists = await authRequest(
        'GET',
        '/api/auth/get-session',
        undefined,
        invitedCookie,
      );
      expect(sessionStillExists.statusCode).toBe(200);
    });

    it('recovers a password and revokes existing sessions', async () => {
      const request = await authRequest(
        'POST',
        '/api/auth/request-password-reset',
        { email: 'invited-a13b@example.test', redirectTo: baseUrl },
      );
      expect(request.statusCode).toBe(200);
      const message = [...messages]
        .reverse()
        .find((candidate) => candidate.kind === 'password-reset');
      const resetUrl = new URL(message.url);
      const resetToken = resetUrl.pathname.split('/').at(-1);
      const reset = await authRequest('POST', '/api/auth/reset-password', {
        newPassword: 'Generated-A13b-reset-password-84',
        token: resetToken,
      });
      expect(reset.statusCode).toBe(200);
      const revoked = await authRequest(
        'GET',
        '/api/auth/get-session',
        undefined,
        invitedCookie,
      );
      expect(revoked.json()).toBeNull();
    });

    it('blocks final-owner deletion, then removes auth and domain access safely', async () => {
      const blocked = await authRequest(
        'POST',
        '/api/auth/delete-user',
        { password },
        ownerCookie,
      );
      expect(blocked.statusCode).toBe(200);
      const blockedMessage = [...messages]
        .reverse()
        .find(
          (candidate) =>
            candidate.kind === 'account-deletion' &&
            candidate.recipient === 'owner-a13b@example.test',
        );
      const blockedUrl = new URL(blockedMessage.url);
      const blockedCallback = await authRequest(
        'GET',
        `${blockedUrl.pathname}${blockedUrl.search}`,
        undefined,
        ownerCookie,
      );
      expect(blockedCallback.statusCode, blockedCallback.body).toBe(409);

      const second = await registerVerified(
        'second-owner-a13b@example.test',
        'Second Owner A13b',
      );
      const invitation = await domain(ownerCookie, {
        method: 'POST',
        url: `/api/v1/organizations/${ownerOrganizationId}/invitations`,
        payload: { email: 'second-owner-a13b@example.test', role: 'admin' },
      });
      expect(invitation.statusCode).toBe(201);
      const message = [...messages]
        .reverse()
        .find(
          (candidate) =>
            candidate.kind === 'invitation' &&
            candidate.recipient === 'second-owner-a13b@example.test',
        );
      const invitationUrl = new URL(message.url);
      const accepted = await domain(second.cookie, {
        method: 'POST',
        url: `/api/v1/organizations/${ownerOrganizationId}/invitations/accept`,
        payload: { token: invitationUrl.searchParams.get('invitation_token') },
      });
      expect(accepted.statusCode).toBe(200);
      const promoted = await domain(ownerCookie, {
        method: 'PUT',
        url: `/api/v1/organizations/${ownerOrganizationId}/memberships/${second.userId}`,
        payload: { role: 'owner' },
      });
      expect(promoted.statusCode).toBe(200);

      const deleted = await authRequest(
        'POST',
        '/api/auth/delete-user',
        { password },
        ownerCookie,
      );
      expect(deleted.statusCode).toBe(200);
      const deleteMessage = [...messages]
        .reverse()
        .find(
          (candidate) =>
            candidate.kind === 'account-deletion' &&
            candidate.recipient === 'owner-a13b@example.test',
        );
      const deleteUrl = new URL(deleteMessage.url);
      const deleteCallback = await authRequest(
        'GET',
        `${deleteUrl.pathname}${deleteUrl.search}`,
        undefined,
        ownerCookie,
      );
      expect([200, 302]).toContain(deleteCallback.statusCode);
      const formerSession = await authRequest(
        'GET',
        '/api/auth/get-session',
        undefined,
        ownerCookie,
      );
      expect(formerSession.json()).toBeNull();
      const membership = await domain(second.cookie, {
        method: 'GET',
        url: `/api/v1/organizations/${ownerOrganizationId}/memberships`,
      });
      expect(membership.statusCode).toBe(200);
      expect(membership.json().memberships).not.toContainEqual(
        expect.objectContaining({ user_id: ownerUserId }),
      );
    });

    it('enforces sign-in rate limits and keeps auth audits payload-free', async () => {
      const statuses = [];
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const response = await authRequest('POST', '/api/auth/sign-in/email', {
          email: 'rate-limit-a13b@example.test',
          password: 'Generated-invalid-password',
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toContain(429);
      const audits = await authPool.query(
        `SELECT action, resource_type, resource_id, changed_fields
         FROM auth_audit_events
        ORDER BY occurred_at, id`,
      );
      expect(audits.rows.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(audits.rows);
      expect(serialized).not.toContain('@example.test');
      expect(serialized).not.toContain(password);
      expect(serialized).not.toContain('session_token');
    });
  },
);
