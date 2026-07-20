import { describe, expect, it } from 'vitest';

import {
  readServiceEnvironment,
  readVerifiedAuthEnvironment,
} from '../dist/index.js';

describe('A13b verified authentication configuration interlock', () => {
  it('is disabled unless the explicit authentication flag is true', () => {
    expect(readVerifiedAuthEnvironment({})).toEqual({ ENABLED: false });
    expect(
      readVerifiedAuthEnvironment({
        BETTER_AUTH_SECRET: 'ignored-while-auth-is-disabled',
      }),
    ).toEqual({ ENABLED: false });
    expect(
      readServiceEnvironment({
        DRONE_WORKS_ENV: 'local',
        PORT: '3001',
      }),
    ).toMatchObject({ AUTH_ENABLED: false });
  });

  it('accepts a bounded base origin, local email service, secret, and allowlist', () => {
    expect(
      readVerifiedAuthEnvironment({
        BETTER_AUTH_SECRET: 'generated-auth-secret-with-32-characters',
        BETTER_AUTH_URL: 'https://app.example.test',
        DRONE_WORKS_AUTH_ENABLED: 'true',
        DRONE_WORKS_AUTH_TRUSTED_ORIGINS:
          'https://app.example.test,https://admin.example.test',
        EMAIL_INTERNAL_URL: 'http://127.0.0.1:4000',
      }),
    ).toEqual({
      BASE_URL: 'https://app.example.test',
      EMAIL_INTERNAL_URL: 'http://127.0.0.1:4000',
      ENABLED: true,
      SECRET: 'generated-auth-secret-with-32-characters',
      TRUSTED_ORIGINS: [
        'https://app.example.test',
        'https://admin.example.test',
      ],
    });
  });

  it.each([
    { BETTER_AUTH_URL: undefined },
    { BETTER_AUTH_SECRET: 'too-short' },
    { BETTER_AUTH_URL: 'file:///tmp/auth' },
    { BETTER_AUTH_URL: 'https://app.example.test/path' },
    {
      DRONE_WORKS_AUTH_TRUSTED_ORIGINS:
        'https://app.example.test,https://app.example.test',
    },
    {
      DRONE_WORKS_AUTH_TRUSTED_ORIGINS: 'https://another.example.test',
    },
  ])('rejects incomplete or unsafe enabled configuration %#', (override) => {
    expect(() =>
      readVerifiedAuthEnvironment({
        BETTER_AUTH_SECRET: 'generated-auth-secret-with-32-characters',
        BETTER_AUTH_URL: 'https://app.example.test',
        DRONE_WORKS_AUTH_ENABLED: 'true',
        DRONE_WORKS_AUTH_TRUSTED_ORIGINS: 'https://app.example.test',
        EMAIL_INTERNAL_URL: 'http://127.0.0.1:4000',
        ...override,
      }),
    ).toThrow('Invalid verified authentication configuration');
  });

  it('rejects a non-boolean authentication flag', () => {
    expect(() =>
      readServiceEnvironment({
        DRONE_WORKS_AUTH_ENABLED: 'yes',
        DRONE_WORKS_ENV: 'local',
        PORT: '3001',
      }),
    ).toThrow('Invalid service environment configuration');
  });
});
