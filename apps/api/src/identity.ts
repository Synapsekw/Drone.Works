import { randomUUID } from 'node:crypto';

import type { ServiceEnvironment } from '@drone-works/config';
import type { AppIdentity } from '@drone-works/database';

import type { VerifiedAuth } from './auth.js';

export interface IdentitySource {
  readonly kind: 'generated-persona' | 'unavailable' | 'verified-session';
  resolve(headers: Record<string, unknown>): Promise<AppIdentity | null>;
}

export const generatedPersonas = Object.freeze({
  alpha_owner: Object.freeze({
    displayName: 'Generated Alpha Owner',
    userId: '00000000-0000-4000-8000-0000000000a2',
  }),
  beta_owner: Object.freeze({
    displayName: 'Generated Beta Owner',
    userId: '00000000-0000-4000-8000-0000000000b2',
  }),
  alpha_admin: Object.freeze({
    displayName: 'Generated Alpha Admin',
    userId: '10000000-0000-4000-8000-000000000001',
  }),
  alpha_pilot: Object.freeze({
    displayName: 'Generated Alpha Pilot',
    userId: '10000000-0000-4000-8000-000000000002',
  }),
  alpha_viewer: Object.freeze({
    displayName: 'Generated Alpha Viewer',
    userId: '10000000-0000-4000-8000-000000000003',
  }),
  alpha_second_owner: Object.freeze({
    displayName: 'Generated Alpha Second Owner',
    userId: '10000000-0000-4000-8000-000000000004',
  }),
  alpha_removed_member: Object.freeze({
    displayName: 'Generated Removed Member',
    userId: '10000000-0000-4000-8000-000000000005',
  }),
});

export type GeneratedPersonaName = keyof typeof generatedPersonas;
export const generatedPersonaNames = Object.freeze(
  Object.keys(generatedPersonas) as GeneratedPersonaName[],
);

function headerValue(headers: Record<string, unknown>, name: string) {
  const value = headers[name];
  return typeof value === 'string' ? value : null;
}

export class GeneratedPersonaIdentitySource implements IdentitySource {
  readonly kind = 'generated-persona' as const;
  readonly #tokens = new Map<string, AppIdentity>();

  issue(persona: GeneratedPersonaName): string | null {
    const identity = generatedPersonas[persona];
    if (!identity) return null;
    const token = randomUUID();
    this.#tokens.set(token, identity);
    return token;
  }

  async resolve(headers: Record<string, unknown>): Promise<AppIdentity | null> {
    const token = headerValue(headers, 'x-drone-works-local-persona-token');
    return token ? (this.#tokens.get(token) ?? null) : null;
  }
}

export class UnavailableIdentitySource implements IdentitySource {
  readonly kind = 'unavailable' as const;

  async resolve(): Promise<null> {
    return null;
  }
}

function standardHeaders(values: Record<string, unknown>): Headers {
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

export class VerifiedSessionIdentitySource implements IdentitySource {
  readonly kind = 'verified-session' as const;
  readonly #auth: VerifiedAuth;

  constructor(auth: VerifiedAuth) {
    this.#auth = auth;
  }

  async resolve(headers: Record<string, unknown>): Promise<AppIdentity | null> {
    const current = await this.#auth.api.getSession({
      headers: standardHeaders(headers),
    });
    if (!current?.user.emailVerified) return null;
    return {
      displayName: current.user.name,
      sessionId: current.session.id,
      userId: current.user.id,
      verifiedEmail: current.user.email.trim().toLowerCase(),
    };
  }
}

export class IdentityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityConfigurationError';
  }
}

export function createIdentitySource(
  environment: ServiceEnvironment,
  auth?: VerifiedAuth,
): IdentitySource {
  if (environment.LOCAL_IDENTITY_ENABLED && environment.AUTH_ENABLED) {
    throw new IdentityConfigurationError(
      'Generated and verified identity cannot be enabled together.',
    );
  }
  if (!environment.LOCAL_IDENTITY_ENABLED) {
    if (environment.AUTH_ENABLED && auth) {
      return new VerifiedSessionIdentitySource(auth);
    }
    if (environment.AUTH_ENABLED) {
      throw new IdentityConfigurationError(
        'Verified authentication requires its configured provider.',
      );
    }
    return new UnavailableIdentitySource();
  }
  if (!['local', 'test'].includes(environment.DRONE_WORKS_ENV)) {
    throw new IdentityConfigurationError(
      'Generated persona identity is forbidden outside local and test.',
    );
  }
  return new GeneratedPersonaIdentitySource();
}

export function assertIdentityConfiguration(
  environment: ServiceEnvironment,
  identitySource: IdentitySource,
): void {
  const localOrTest = ['local', 'test'].includes(environment.DRONE_WORKS_ENV);
  if (environment.LOCAL_IDENTITY_ENABLED && environment.AUTH_ENABLED) {
    throw new IdentityConfigurationError(
      'Generated and verified identity cannot be enabled together.',
    );
  }
  if (
    identitySource.kind === 'generated-persona' &&
    (!localOrTest || !environment.LOCAL_IDENTITY_ENABLED)
  ) {
    throw new IdentityConfigurationError(
      'Generated persona identity requires local/test and the explicit enable flag.',
    );
  }
  if (
    environment.LOCAL_IDENTITY_ENABLED &&
    identitySource.kind !== 'generated-persona'
  ) {
    throw new IdentityConfigurationError(
      'The local identity flag requires the generated persona adapter.',
    );
  }
  if (environment.AUTH_ENABLED && identitySource.kind !== 'verified-session') {
    throw new IdentityConfigurationError(
      'The verified authentication flag requires the session adapter.',
    );
  }
  if (
    identitySource.kind === 'verified-session' &&
    (!environment.AUTH_ENABLED || environment.LOCAL_IDENTITY_ENABLED)
  ) {
    throw new IdentityConfigurationError(
      'Verified sessions require the exclusive authentication flag.',
    );
  }
  if (
    ['staging', 'production'].includes(environment.DRONE_WORKS_ENV) &&
    identitySource.kind !== 'verified-session'
  ) {
    throw new IdentityConfigurationError(
      'Hosted startup requires verified sessions.',
    );
  }
}

export class IdentityRequiredError extends Error {
  constructor() {
    super('A current identity is required.');
    this.name = 'IdentityRequiredError';
  }
}
