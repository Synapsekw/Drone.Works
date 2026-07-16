import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  createOrganizationBodySchema,
  membershipListSchema,
  membershipPathSchema,
  membershipSchema,
  organizationPathSchema,
  organizationSelectionSchema,
  problemDetailSchema,
  putMembershipBodySchema,
  type CreateOrganizationBody,
  type MembershipPath,
  type OrganizationPath,
  type PutMembershipBody,
} from '@drone-works/contracts/server';
import type {
  AppIdentity,
  Membership,
  OrganizationRole,
  OrganizationSelection,
} from '@drone-works/database';

import { IdentityRequiredError, type IdentitySource } from './identity.js';

function selectionResponse(selection: OrganizationSelection) {
  return {
    organization_id: selection.organizationId,
    name: selection.name,
    default_timezone: selection.defaultTimezone,
    unit_system: selection.unitSystem,
    role: selection.role,
    pilot_profile_id: selection.pilotProfileId,
  };
}

function membershipResponse(membership: Membership) {
  return {
    user_id: membership.userId,
    role: membership.role,
    pilot_profile_id: membership.pilotProfileId,
  };
}

export async function requireIdentity(
  identitySource: IdentitySource,
  request: FastifyRequest,
): Promise<AppIdentity> {
  const identity = await identitySource.resolve(request.headers);
  if (!identity) throw new IdentityRequiredError();
  return identity;
}

const problemResponses = {
  '4xx': {
    description: 'The request was denied or could not be accepted.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
  '5xx': {
    description: 'The request could not be completed.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
} as const;

export interface OrganizationRouteDependencies {
  readonly identitySource: IdentitySource;
  readonly organizations: {
    createOrganization(
      identity: AppIdentity,
      input: {
        readonly defaultTimezone: string;
        readonly name: string;
        readonly unitSystem: 'metric' | 'imperial';
      },
    ): Promise<OrganizationSelection>;
    listMemberships(
      identity: AppIdentity,
      organizationId: string,
    ): Promise<readonly Membership[]>;
    putMembership(
      identity: AppIdentity,
      organizationId: string,
      targetUserId: string,
      role: OrganizationRole,
    ): Promise<Membership>;
    removeMembership(
      identity: AppIdentity,
      organizationId: string,
      targetUserId: string,
    ): Promise<void>;
    selectOrganization(
      identity: AppIdentity,
      organizationId: string,
    ): Promise<OrganizationSelection>;
  };
}

export function registerOrganizationRoutes(
  app: FastifyInstance,
  dependencies: OrganizationRouteDependencies,
): void {
  app.post<{ Body: CreateOrganizationBody }>(
    '/api/v1/organizations',
    {
      schema: {
        operationId: 'createOrganization',
        body: createOrganizationBodySchema,
        response: {
          201: {
            description: 'The organization and owner membership were created.',
            content: {
              'application/json': { schema: organizationSelectionSchema },
            },
          },
          ...problemResponses,
        },
        summary: 'Create an organization',
        tags: ['organizations'],
      },
    },
    async (request, reply) => {
      const identity = await requireIdentity(
        dependencies.identitySource,
        request,
      );
      const selection = await dependencies.organizations.createOrganization(
        identity,
        {
          defaultTimezone: request.body.default_timezone,
          name: request.body.name,
          unitSystem: request.body.unit_system,
        },
      );
      return reply.code(201).send(selectionResponse(selection));
    },
  );

  app.put<{ Params: OrganizationPath }>(
    '/api/v1/organizations/:organization_id/selection',
    {
      schema: {
        operationId: 'selectOrganization',
        params: organizationPathSchema,
        response: {
          200: {
            description: 'The current canonical membership was selected.',
            content: {
              'application/json': { schema: organizationSelectionSchema },
            },
          },
          ...problemResponses,
        },
        summary: 'Select an organization',
        tags: ['organizations'],
      },
    },
    async (request) =>
      selectionResponse(
        await dependencies.organizations.selectOrganization(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
        ),
      ),
  );

  app.get<{ Params: OrganizationPath }>(
    '/api/v1/organizations/:organization_id/memberships',
    {
      schema: {
        operationId: 'listMemberships',
        params: organizationPathSchema,
        response: {
          200: {
            description: 'Current organization memberships.',
            content: {
              'application/json': { schema: membershipListSchema },
            },
          },
          ...problemResponses,
        },
        summary: 'List memberships',
        tags: ['memberships'],
      },
    },
    async (request) => ({
      memberships: (
        await dependencies.organizations.listMemberships(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
        )
      ).map(membershipResponse),
    }),
  );

  app.put<{ Body: PutMembershipBody; Params: MembershipPath }>(
    '/api/v1/organizations/:organization_id/memberships/:user_id',
    {
      schema: {
        operationId: 'putMembership',
        body: putMembershipBodySchema,
        params: membershipPathSchema,
        response: {
          200: {
            description: 'The canonical membership was created or updated.',
            content: {
              'application/json': { schema: membershipSchema },
            },
          },
          ...problemResponses,
        },
        summary: 'Create or update a membership',
        tags: ['memberships'],
      },
    },
    async (request) =>
      membershipResponse(
        await dependencies.organizations.putMembership(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          request.params.user_id,
          request.body.role,
        ),
      ),
  );

  app.delete<{ Params: MembershipPath }>(
    '/api/v1/organizations/:organization_id/memberships/:user_id',
    {
      schema: {
        operationId: 'removeMembership',
        params: membershipPathSchema,
        response: {
          204: { description: 'The membership was removed.' },
          ...problemResponses,
        },
        summary: 'Remove a membership',
        tags: ['memberships'],
      },
    },
    async (request, reply) => {
      await dependencies.organizations.removeMembership(
        await requireIdentity(dependencies.identitySource, request),
        request.params.organization_id,
        request.params.user_id,
      );
      return reply.code(204).send();
    },
  );
}
