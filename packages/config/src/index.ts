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
