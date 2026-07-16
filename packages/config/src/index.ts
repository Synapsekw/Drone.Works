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
    PORT: Type.Integer({ minimum: 1, maximum: 65_535 }),
  },
  { additionalProperties: false },
);

export type ServiceEnvironment = Static<typeof serviceEnvironmentSchema>;

export function readServiceEnvironment(
  source: NodeJS.ProcessEnv,
): ServiceEnvironment {
  const candidate = {
    DRONE_WORKS_ENV: source.DRONE_WORKS_ENV ?? 'local',
    HOST: source.HOST ?? '127.0.0.1',
    PORT: Number(source.PORT ?? '0'),
  };

  if (!Value.Check(serviceEnvironmentSchema, candidate)) {
    throw new Error('Invalid service environment configuration.');
  }

  return candidate;
}
