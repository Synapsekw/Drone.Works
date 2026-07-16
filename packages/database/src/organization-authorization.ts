import { randomUUID } from 'node:crypto';

import {
  withOrganizationTransaction,
  type OrganizationPool,
  type OrganizationTransaction,
} from './organization-transaction.js';

export const organizationRoles = ['owner', 'admin', 'pilot', 'viewer'] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

export interface AppIdentity {
  readonly displayName: string;
  readonly userId: string;
}

export interface CreateOrganizationInput {
  readonly defaultTimezone: string;
  readonly name: string;
  readonly unitSystem: 'metric' | 'imperial';
}

export interface OrganizationSelection {
  readonly defaultTimezone: string;
  readonly name: string;
  readonly organizationId: string;
  readonly pilotProfileId: string | null;
  readonly role: OrganizationRole;
  readonly unitSystem: 'metric' | 'imperial';
}

export interface Membership {
  readonly pilotProfileId: string | null;
  readonly role: OrganizationRole;
  readonly userId: string;
}

export class OrganizationAccessDeniedError extends Error {
  constructor() {
    super('The organization resource was not found.');
    this.name = 'OrganizationAccessDeniedError';
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super('An organization must retain at least one owner.');
    this.name = 'LastOwnerError';
  }
}

interface MembershipRow {
  readonly pilot_profile_id: string | null;
  readonly role: OrganizationRole;
  readonly user_id: string;
}

interface OrganizationRow extends MembershipRow {
  readonly default_timezone: string;
  readonly name: string;
  readonly organization_id: string;
  readonly unit_system: 'metric' | 'imperial';
}

async function currentMembership(
  transaction: OrganizationTransaction,
  userId: string,
): Promise<MembershipRow> {
  const result = await transaction.query<MembershipRow>(
    `SELECT membership.user_id,
            membership.role,
            pilot.id AS pilot_profile_id
       FROM droneworks.memberships AS membership
       LEFT JOIN droneworks.pilot_profiles AS pilot
         ON (pilot.organization_id, pilot.membership_user_id) =
            (membership.organization_id, membership.user_id)
      WHERE membership.organization_id = $1
        AND membership.user_id = $2`,
    [transaction.organizationId, userId],
  );
  const membership = result.rows[0];
  if (!membership) throw new OrganizationAccessDeniedError();
  return membership;
}

function canManageMembers(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin';
}

function membershipFromRow(row: MembershipRow): Membership {
  return {
    pilotProfileId: row.pilot_profile_id,
    role: row.role,
    userId: row.user_id,
  };
}

async function lockOrganization(
  transaction: OrganizationTransaction,
): Promise<void> {
  const locked = await transaction.query(
    'SELECT id FROM droneworks.organizations WHERE id = $1 FOR UPDATE',
    [transaction.organizationId],
  );
  if (locked.rowCount !== 1) throw new OrganizationAccessDeniedError();
}

async function ownerCount(
  transaction: OrganizationTransaction,
): Promise<number> {
  const result = await transaction.query<{ readonly count: number }>(
    `SELECT count(*)::integer AS count
       FROM droneworks.memberships
      WHERE organization_id = $1
        AND role = 'owner'`,
    [transaction.organizationId],
  );
  return result.rows[0]?.count ?? 0;
}

async function writeAudit(
  transaction: OrganizationTransaction,
  actorUserId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  changedFields: readonly string[],
): Promise<void> {
  await transaction.query(
    `INSERT INTO droneworks.audit_events (
       organization_id, id, actor_kind, actor_user_id, action,
       resource_type, resource_id, changed_fields, metadata, occurred_at
     ) VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, '{}'::jsonb, now())`,
    [
      transaction.organizationId,
      randomUUID(),
      actorUserId,
      action,
      resourceType,
      resourceId,
      [...changedFields],
    ],
  );
}

export class OrganizationAuthorizationRepository {
  readonly #pool: OrganizationPool;

  constructor(pool: OrganizationPool) {
    this.#pool = pool;
  }

  async createOrganization(
    identity: AppIdentity,
    input: CreateOrganizationInput,
  ): Promise<OrganizationSelection> {
    const organizationId = randomUUID();
    const pilotProfileId = randomUUID();
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        await transaction.query(
          `INSERT INTO droneworks.organizations (
             id, name, default_timezone, unit_system, created_at
           ) VALUES ($1, $2, $3, $4, now())`,
          [
            organizationId,
            input.name.trim(),
            input.defaultTimezone.trim(),
            input.unitSystem,
          ],
        );
        await transaction.query(
          `INSERT INTO droneworks.memberships (
             organization_id, user_id, role, created_at
           ) VALUES ($1, $2, 'owner', now())`,
          [organizationId, identity.userId],
        );
        await transaction.query(
          `INSERT INTO droneworks.pilot_profiles (
             organization_id, id, display_name, membership_user_id, created_at
           ) VALUES ($1, $2, $3, $4, now())`,
          [
            organizationId,
            pilotProfileId,
            identity.displayName,
            identity.userId,
          ],
        );
        await writeAudit(
          transaction,
          identity.userId,
          'organization.created',
          'organization',
          organizationId,
          ['name', 'default_timezone', 'unit_system'],
        );
        await writeAudit(
          transaction,
          identity.userId,
          'membership.created',
          'membership',
          identity.userId,
          ['role'],
        );
        await writeAudit(
          transaction,
          identity.userId,
          'pilot_profile.created',
          'pilot_profile',
          pilotProfileId,
          ['display_name', 'membership_user_id'],
        );
        return {
          defaultTimezone: input.defaultTimezone.trim(),
          name: input.name.trim(),
          organizationId,
          pilotProfileId,
          role: 'owner',
          unitSystem: input.unitSystem,
        };
      },
    );
  }

  async selectOrganization(
    identity: AppIdentity,
    organizationId: string,
  ): Promise<OrganizationSelection> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const result = await transaction.query<OrganizationRow>(
          `SELECT organization.id AS organization_id,
                  organization.name,
                  organization.default_timezone,
                  organization.unit_system,
                  membership.user_id,
                  membership.role,
                  pilot.id AS pilot_profile_id
             FROM droneworks.organizations AS organization
             JOIN droneworks.memberships AS membership
               ON membership.organization_id = organization.id
             LEFT JOIN droneworks.pilot_profiles AS pilot
               ON (pilot.organization_id, pilot.membership_user_id) =
                  (membership.organization_id, membership.user_id)
            WHERE organization.id = $1
              AND membership.user_id = $2`,
          [transaction.organizationId, identity.userId],
        );
        const row = result.rows[0];
        if (!row) throw new OrganizationAccessDeniedError();
        return {
          defaultTimezone: row.default_timezone,
          name: row.name,
          organizationId: row.organization_id,
          pilotProfileId: row.pilot_profile_id,
          role: row.role,
          unitSystem: row.unit_system,
        };
      },
    );
  }

  async listMemberships(
    identity: AppIdentity,
    organizationId: string,
  ): Promise<readonly Membership[]> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        const actor = await currentMembership(transaction, identity.userId);
        if (!canManageMembers(actor.role)) {
          throw new OrganizationAccessDeniedError();
        }
        const result = await transaction.query<MembershipRow>(
          `SELECT membership.user_id,
                  membership.role,
                  pilot.id AS pilot_profile_id
             FROM droneworks.memberships AS membership
             LEFT JOIN droneworks.pilot_profiles AS pilot
               ON (pilot.organization_id, pilot.membership_user_id) =
                  (membership.organization_id, membership.user_id)
            WHERE membership.organization_id = $1
            ORDER BY membership.created_at, membership.user_id`,
          [transaction.organizationId],
        );
        return result.rows.map(membershipFromRow);
      },
    );
  }

  async putMembership(
    identity: AppIdentity,
    organizationId: string,
    targetUserId: string,
    role: OrganizationRole,
  ): Promise<Membership> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        await lockOrganization(transaction);
        const actor = await currentMembership(transaction, identity.userId);
        if (!canManageMembers(actor.role)) {
          throw new OrganizationAccessDeniedError();
        }
        const existingResult = await transaction.query<MembershipRow>(
          `SELECT membership.user_id,
                  membership.role,
                  pilot.id AS pilot_profile_id
             FROM droneworks.memberships AS membership
             LEFT JOIN droneworks.pilot_profiles AS pilot
               ON (pilot.organization_id, pilot.membership_user_id) =
                  (membership.organization_id, membership.user_id)
            WHERE membership.organization_id = $1
              AND membership.user_id = $2`,
          [transaction.organizationId, targetUserId],
        );
        const existing = existingResult.rows[0];
        if (
          actor.role !== 'owner' &&
          (role === 'owner' || existing?.role === 'owner')
        ) {
          throw new OrganizationAccessDeniedError();
        }
        if (
          existing?.role === 'owner' &&
          role !== 'owner' &&
          (await ownerCount(transaction)) <= 1
        ) {
          throw new LastOwnerError();
        }
        await transaction.query(
          `INSERT INTO droneworks.memberships (
             organization_id, user_id, role, created_at
           ) VALUES ($1, $2, $3, now())
           ON CONFLICT (organization_id, user_id)
           DO UPDATE SET role = EXCLUDED.role`,
          [transaction.organizationId, targetUserId, role],
        );
        await writeAudit(
          transaction,
          identity.userId,
          existing ? 'membership.role_changed' : 'membership.created',
          'membership',
          targetUserId,
          ['role'],
        );
        return {
          pilotProfileId: existing?.pilot_profile_id ?? null,
          role,
          userId: targetUserId,
        };
      },
    );
  }

  async removeMembership(
    identity: AppIdentity,
    organizationId: string,
    targetUserId: string,
  ): Promise<void> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        await lockOrganization(transaction);
        const actor = await currentMembership(transaction, identity.userId);
        if (!canManageMembers(actor.role)) {
          throw new OrganizationAccessDeniedError();
        }
        const targetResult = await transaction.query<MembershipRow>(
          `SELECT user_id, role, NULL::uuid AS pilot_profile_id
             FROM droneworks.memberships
            WHERE organization_id = $1
              AND user_id = $2`,
          [transaction.organizationId, targetUserId],
        );
        const target = targetResult.rows[0];
        if (!target) throw new OrganizationAccessDeniedError();
        if (actor.role !== 'owner' && target.role === 'owner') {
          throw new OrganizationAccessDeniedError();
        }
        if (target.role === 'owner' && (await ownerCount(transaction)) <= 1) {
          throw new LastOwnerError();
        }
        await transaction.query(
          `UPDATE droneworks.pilot_profiles
              SET membership_user_id = NULL
            WHERE organization_id = $1
              AND membership_user_id = $2`,
          [transaction.organizationId, targetUserId],
        );
        await transaction.query(
          `DELETE FROM droneworks.memberships
            WHERE organization_id = $1
              AND user_id = $2`,
          [transaction.organizationId, targetUserId],
        );
        await writeAudit(
          transaction,
          identity.userId,
          'membership.removed',
          'membership',
          targetUserId,
          ['membership_user_id', 'role'],
        );
      },
    );
  }
}
