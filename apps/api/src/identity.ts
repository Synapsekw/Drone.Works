import { randomUUID } from 'node:crypto';

import type { ServiceEnvironment } from '@drone-works/config';
import type { AppIdentity } from '@drone-works/database';

export interface IdentitySource {
  readonly kind: 'generated-persona' | 'unavailable';
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

export class IdentityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityConfigurationError';
  }
}

export function createIdentitySource(
  environment: ServiceEnvironment,
): IdentitySource {
  if (!environment.LOCAL_IDENTITY_ENABLED) {
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
}

export class IdentityRequiredError extends Error {
  constructor() {
    super('A current identity is required.');
    this.name = 'IdentityRequiredError';
  }
}
