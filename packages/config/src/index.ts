import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const serviceEnvironmentSchema = Type.Object(
  {
    DRONE_WORKS_ENV: Type.Union([
      Type.Literal('local'),
      Type.Literal('test'),
      Type.Literal('staging'),
      Type.Literal('production'),
    ]),
    AUTH_ENABLED: Type.Boolean(),
    HOST: Type.String({ minLength: 1 }),
    LOCAL_IDENTITY_ENABLED: Type.Boolean(),
    PORT: Type.Integer({ minimum: 1, maximum: 65_535 }),
  },
  { additionalProperties: false },
);

export type ServiceEnvironment = Static<typeof serviceEnvironmentSchema>;

export function readServiceEnvironment(
  source: NodeJS.ProcessEnv,
): ServiceEnvironment {
  const localIdentityFlag =
    source.DRONE_WORKS_LOCAL_IDENTITY_ENABLED ?? 'false';
  const authFlag = source.DRONE_WORKS_AUTH_ENABLED ?? 'false';
  if (
    !['false', 'true'].includes(localIdentityFlag) ||
    !['false', 'true'].includes(authFlag)
  ) {
    throw new Error('Invalid service environment configuration.');
  }

  const candidate = {
    AUTH_ENABLED: authFlag === 'true',
    DRONE_WORKS_ENV: source.DRONE_WORKS_ENV ?? 'local',
    HOST: source.HOST ?? '127.0.0.1',
    LOCAL_IDENTITY_ENABLED: localIdentityFlag === 'true',
    PORT: Number(source.PORT ?? '0'),
  };

  if (!Value.Check(serviceEnvironmentSchema, candidate)) {
    throw new Error('Invalid service environment configuration.');
  }

  return candidate;
}

export type VerifiedAuthEnvironment =
  | { readonly ENABLED: false }
  | {
      readonly BASE_URL: string;
      readonly EMAIL_INTERNAL_URL: string;
      readonly ENABLED: true;
      readonly SECRET: string;
      readonly TRUSTED_ORIGINS: readonly string[];
    };

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.pathname !== '/') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function readVerifiedAuthEnvironment(
  source: NodeJS.ProcessEnv,
): VerifiedAuthEnvironment {
  if ((source.DRONE_WORKS_AUTH_ENABLED ?? 'false') === 'false') {
    return { ENABLED: false };
  }
  const baseUrl = origin(source.BETTER_AUTH_URL);
  const emailInternalUrl = origin(source.EMAIL_INTERNAL_URL);
  const secret = source.BETTER_AUTH_SECRET;
  const trustedOrigins = (source.DRONE_WORKS_AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((value) => origin(value.trim()))
    .filter((value): value is string => value !== null);
  if (
    !baseUrl ||
    !emailInternalUrl ||
    !secret ||
    secret.length < 32 ||
    trustedOrigins.length === 0 ||
    new Set(trustedOrigins).size !== trustedOrigins.length ||
    !trustedOrigins.includes(baseUrl)
  ) {
    throw new Error('Invalid verified authentication configuration.');
  }
  return {
    BASE_URL: baseUrl,
    EMAIL_INTERNAL_URL: emailInternalUrl,
    ENABLED: true,
    SECRET: secret,
    TRUSTED_ORIGINS: trustedOrigins,
  };
}

export const djiKeychainEnvironmentSchema = Type.Union([
  Type.Object(
    {
      ENABLED: Type.Literal(false),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ENABLED: Type.Literal(true),
      KMS_KEY_REFERENCE: Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: '^kms://[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,193}$',
      }),
      KMS_KEY_VERSION: Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$',
      }),
      NOTICE_VERSION: Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$',
      }),
      SECRET_REFERENCE: Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: '^secret://[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,190}$',
      }),
      TERMS_VERSION: Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$',
      }),
    },
    { additionalProperties: false },
  ),
]);

export type DjiKeychainEnvironment = Static<
  typeof djiKeychainEnvironmentSchema
>;

export function readDjiKeychainEnvironment(
  source: NodeJS.ProcessEnv,
): DjiKeychainEnvironment {
  const enabledFlag = source.DRONE_WORKS_DJI_PROVIDER_ENABLED ?? 'false';
  if (!['false', 'true'].includes(enabledFlag)) {
    throw new Error('Invalid DJI keychain provider configuration.');
  }
  if (enabledFlag === 'false') return { ENABLED: false };

  const candidate = {
    ENABLED: true as const,
    KMS_KEY_REFERENCE: source.DRONE_WORKS_DJI_KMS_KEY_REFERENCE,
    KMS_KEY_VERSION: source.DRONE_WORKS_DJI_KMS_KEY_VERSION,
    NOTICE_VERSION: source.DRONE_WORKS_DJI_NOTICE_VERSION,
    SECRET_REFERENCE: source.DRONE_WORKS_DJI_SECRET_REFERENCE,
    TERMS_VERSION: source.DRONE_WORKS_DJI_TERMS_VERSION,
  };
  if (!Value.Check(djiKeychainEnvironmentSchema, candidate)) {
    throw new Error('Invalid DJI keychain provider configuration.');
  }
  return candidate;
}

export const applicationDatabaseEnvironmentSchema = Type.Object(
  {
    PGDATABASE: Type.String({ minLength: 1 }),
    PGHOST: Type.String({ minLength: 1 }),
    PGPORT: Type.Integer({ minimum: 1, maximum: 65_535 }),
    PGUSER: Type.Literal('droneworks_app'),
  },
  { additionalProperties: false },
);

export type ApplicationDatabaseEnvironment = Static<
  typeof applicationDatabaseEnvironmentSchema
>;

export function readApplicationDatabaseEnvironment(
  source: NodeJS.ProcessEnv,
): ApplicationDatabaseEnvironment {
  const candidate = {
    PGDATABASE: source.PGDATABASE ?? 'droneworks',
    PGHOST: source.PGHOST ?? '127.0.0.1',
    PGPORT: Number(source.PGPORT ?? '5432'),
    PGUSER: source.PGUSER ?? 'droneworks_app',
  };

  if (!Value.Check(applicationDatabaseEnvironmentSchema, candidate)) {
    throw new Error('Invalid application database configuration.');
  }

  return candidate;
}

export const jobsDatabaseEnvironmentSchema = Type.Object(
  {
    PGDATABASE: Type.String({ minLength: 1 }),
    PGHOST: Type.String({ minLength: 1 }),
    PGPORT: Type.Integer({ minimum: 1, maximum: 65_535 }),
  },
  { additionalProperties: false },
);

export type JobsDatabaseEnvironment = Static<
  typeof jobsDatabaseEnvironmentSchema
>;

export function readJobsDatabaseEnvironment(
  source: NodeJS.ProcessEnv,
): JobsDatabaseEnvironment {
  const candidate = {
    PGDATABASE: source.PGDATABASE ?? 'droneworks',
    PGHOST: source.PGHOST ?? '127.0.0.1',
    PGPORT: Number(source.PGPORT ?? '5432'),
  };
  if (!Value.Check(jobsDatabaseEnvironmentSchema, candidate)) {
    throw new Error('Invalid jobs database configuration.');
  }
  return candidate;
}
