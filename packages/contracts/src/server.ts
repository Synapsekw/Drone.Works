import { Type, type Static } from '@sinclair/typebox';

const uuidStringSchema = Type.String({
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
});

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

export const organizationRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('pilot'),
  Type.Literal('viewer'),
]);

export const organizationPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
  },
  { $id: 'OrganizationPath', additionalProperties: false },
);

export const membershipPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    user_id: uuidStringSchema,
  },
  { $id: 'MembershipPath', additionalProperties: false },
);

export const createOrganizationBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    default_timezone: Type.String({ minLength: 1, maxLength: 100 }),
    unit_system: Type.Union([Type.Literal('metric'), Type.Literal('imperial')]),
  },
  { $id: 'CreateOrganizationBody', additionalProperties: false },
);

export const organizationSelectionSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    name: Type.String(),
    default_timezone: Type.String(),
    unit_system: Type.Union([Type.Literal('metric'), Type.Literal('imperial')]),
    role: organizationRoleSchema,
    pilot_profile_id: Type.Union([uuidStringSchema, Type.Null()]),
  },
  { $id: 'OrganizationSelection', additionalProperties: false },
);

export const putMembershipBodySchema = Type.Object(
  {
    role: organizationRoleSchema,
  },
  { $id: 'PutMembershipBody', additionalProperties: false },
);

export const membershipSchema = Type.Object(
  {
    user_id: uuidStringSchema,
    role: organizationRoleSchema,
    pilot_profile_id: Type.Union([uuidStringSchema, Type.Null()]),
  },
  { $id: 'Membership', additionalProperties: false },
);

export const membershipListSchema = Type.Object(
  {
    memberships: Type.Array(Type.Ref(membershipSchema)),
  },
  { $id: 'MembershipList', additionalProperties: false },
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
export type CreateOrganizationBody = Static<
  typeof createOrganizationBodySchema
>;
export type OrganizationPath = Static<typeof organizationPathSchema>;
export type MembershipPath = Static<typeof membershipPathSchema>;
export type PutMembershipBody = Static<typeof putMembershipBodySchema>;
