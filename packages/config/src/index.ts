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
  if (!['false', 'true'].includes(localIdentityFlag)) {
    throw new Error('Invalid service environment configuration.');
  }

  const candidate = {
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
