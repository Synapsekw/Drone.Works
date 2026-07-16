import { Type, type Static } from '@sinclair/typebox';

export const healthQuerySchema = Type.Object(
  {},
  { $id: 'HealthQuery', additionalProperties: false },
);

export const healthResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    service: Type.Literal('api'),
    version: Type.Literal('v1'),
  },
  { $id: 'HealthResponse', additionalProperties: false },
);

export const problemErrorSchema = Type.Object(
  {
    pointer: Type.String(),
    message: Type.String(),
  },
  { $id: 'ProblemError', additionalProperties: false },
);

export const problemDetailSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.String(),
    instance: Type.String(),
    correlation_id: Type.String(),
    errors: Type.Optional(Type.Array(Type.Ref(problemErrorSchema))),
  },
  { $id: 'ProblemDetail', additionalProperties: false },
);

export type HealthResponse = Static<typeof healthResponseSchema>;
export type ProblemDetail = Static<typeof problemDetailSchema>;
