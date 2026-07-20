import { createHash, randomBytes } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import {
  acceptInvitationBodySchema,
  createInvitationBodySchema,
  invitationPathSchema,
  invitationSchema,
  membershipSchema,
  organizationPathSchema,
  problemDetailSchema,
  type AcceptInvitationBody,
  type CreateInvitationBody,
  type InvitationPath,
  type OrganizationPath,
} from '@drone-works/contracts/server';
import type {
  AppIdentity,
  InvitationRole,
  Membership,
  OrganizationInvitation,
} from '@drone-works/database';

import type { AuthEmailDelivery } from './auth.js';
import type { IdentitySource } from './identity.js';
import { requireIdentity } from './organization-routes.js';

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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invitationResponse(
  organizationId: string,
  invitation: OrganizationInvitation,
) {
  return {
    expires_at: invitation.expiresAt.toISOString(),
    invitation_id: invitation.invitationId,
    organization_id: organizationId,
    role: invitation.role,
  };
}

function membershipResponse(membership: Membership) {
  return {
    pilot_profile_id: membership.pilotProfileId,
    role: membership.role,
    user_id: membership.userId,
  };
}

export interface InvitationRouteDependencies {
  readonly email: AuthEmailDelivery;
  readonly identitySource: IdentitySource;
  readonly publicWebUrl: string;
  readonly organizations: {
    acceptInvitation(
      identity: AppIdentity,
      organizationId: string,
      tokenSha256: string,
    ): Promise<Membership>;
    createInvitation(
      identity: AppIdentity,
      organizationId: string,
      input: {
        readonly emailNormalized: string;
        readonly expiresAt: Date;
        readonly role: InvitationRole;
        readonly tokenSha256: string;
      },
    ): Promise<OrganizationInvitation>;
    revokeInvitation(
      identity: AppIdentity,
      organizationId: string,
      invitationId: string,
    ): Promise<void>;
  };
}

export function registerInvitationRoutes(
  app: FastifyInstance,
  dependencies: InvitationRouteDependencies,
): void {
  app.post<{ Body: CreateInvitationBody; Params: OrganizationPath }>(
    '/api/v1/organizations/:organization_id/invitations',
    {
      schema: {
        body: createInvitationBodySchema,
        operationId: 'createInvitation',
        params: organizationPathSchema,
        response: {
          201: {
            description: 'A single-use organization invitation was created.',
            content: { 'application/json': { schema: invitationSchema } },
          },
          ...problemResponses,
        },
        summary: 'Create an organization invitation',
        tags: ['invitations'],
      },
    },
    async (request, reply) => {
      const token = randomBytes(32).toString('base64url');
      const emailNormalized = request.body.email.trim().toLowerCase();
      const invitation = await dependencies.organizations.createInvitation(
        await requireIdentity(dependencies.identitySource, request),
        request.params.organization_id,
        {
          emailNormalized,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          role: request.body.role,
          tokenSha256: sha256(token),
        },
      );
      const invitationUrl = new URL('/', dependencies.publicWebUrl);
      invitationUrl.searchParams.set(
        'organization_id',
        request.params.organization_id,
      );
      invitationUrl.searchParams.set('invitation_token', token);
      await dependencies.email.send({
        kind: 'invitation',
        recipient: emailNormalized,
        url: invitationUrl.toString(),
      });
      return reply
        .code(201)
        .send(invitationResponse(request.params.organization_id, invitation));
    },
  );

  app.post<{ Body: AcceptInvitationBody; Params: OrganizationPath }>(
    '/api/v1/organizations/:organization_id/invitations/accept',
    {
      schema: {
        body: acceptInvitationBodySchema,
        operationId: 'acceptInvitation',
        params: organizationPathSchema,
        response: {
          200: {
            description: 'The verified matching user accepted the invitation.',
            content: { 'application/json': { schema: membershipSchema } },
          },
          ...problemResponses,
        },
        summary: 'Accept an organization invitation',
        tags: ['invitations'],
      },
    },
    async (request) =>
      membershipResponse(
        await dependencies.organizations.acceptInvitation(
          await requireIdentity(dependencies.identitySource, request),
          request.params.organization_id,
          sha256(request.body.token),
        ),
      ),
  );

  app.delete<{ Params: InvitationPath }>(
    '/api/v1/organizations/:organization_id/invitations/:invitation_id',
    {
      schema: {
        operationId: 'revokeInvitation',
        params: invitationPathSchema,
        response: {
          204: { description: 'The pending invitation was revoked.' },
          ...problemResponses,
        },
        summary: 'Revoke an organization invitation',
        tags: ['invitations'],
      },
    },
    async (request, reply) => {
      await dependencies.organizations.revokeInvitation(
        await requireIdentity(dependencies.identitySource, request),
        request.params.organization_id,
        request.params.invitation_id,
      );
      return reply.code(204).send();
    },
  );
}
