import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import type { ApplicationPool } from '@drone-works/database';

export const betterAuthVersion = '1.6.23' as const;

export type AuthEmailKind =
  'account-deletion' | 'invitation' | 'password-reset' | 'verification';

export interface AuthEmailDelivery {
  send(message: {
    readonly kind: AuthEmailKind;
    readonly recipient: string;
    readonly url: string;
  }): Promise<void>;
}

export interface VerifiedAuthConfiguration {
  readonly baseUrl: string;
  readonly beforeDeleteUser: (userId: string) => Promise<void>;
  readonly email: AuthEmailDelivery;
  readonly pool: ApplicationPool;
  readonly secret: string;
  readonly secureCookies: boolean;
  readonly trustedOrigins: readonly string[];
}

function authAudit(
  pool: ApplicationPool,
  action: string,
  resourceType: 'session' | 'user',
  resourceId: string,
  changedFields: readonly string[],
): Promise<unknown> {
  return pool.query(
    `INSERT INTO auth_audit_events (
       id, action, resource_type, resource_id, changed_fields, occurred_at
     ) VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
    [action, resourceType, resourceId, [...changedFields]],
  );
}

export function createVerifiedAuth(configuration: VerifiedAuthConfiguration) {
  const userFields = {
    createdAt: 'created_at',
    emailVerified: 'email_verified',
    updatedAt: 'updated_at',
  } as const;
  const sessionFields = {
    createdAt: 'created_at',
    expiresAt: 'expires_at',
    ipAddress: 'ip_address',
    updatedAt: 'updated_at',
    userAgent: 'user_agent',
    userId: 'user_id',
  } as const;
  const accountFields = {
    accessToken: 'access_token',
    accessTokenExpiresAt: 'access_token_expires_at',
    accountId: 'account_id',
    createdAt: 'created_at',
    idToken: 'id_token',
    providerId: 'provider_id',
    refreshToken: 'refresh_token',
    refreshTokenExpiresAt: 'refresh_token_expires_at',
    updatedAt: 'updated_at',
    userId: 'user_id',
  } as const;
  const verificationFields = {
    createdAt: 'created_at',
    expiresAt: 'expires_at',
    updatedAt: 'updated_at',
  } as const;

  return betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        disableImplicitLinking: true,
        enabled: true,
      },
      encryptOAuthTokens: true,
      fields: accountFields,
      modelName: 'accounts',
    },
    advanced: {
      cookiePrefix: 'droneworks',
      crossSubDomainCookies: { enabled: false },
      database: { generateId: 'uuid' },
      defaultCookieAttributes: {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: configuration.secureCookies,
      },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      trustedProxyHeaders: false,
      useSecureCookies: configuration.secureCookies,
    },
    appName: 'Drone.Works',
    basePath: '/api/auth',
    baseURL: configuration.baseUrl,
    database: configuration.pool,
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await authAudit(
              configuration.pool,
              'session.created',
              'session',
              session.id,
              ['expires_at'],
            );
          },
        },
        delete: {
          after: async (session) => {
            await authAudit(
              configuration.pool,
              'session.revoked',
              'session',
              session.id,
              [],
            );
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            await authAudit(
              configuration.pool,
              'user.registered',
              'user',
              user.id,
              ['email_verified', 'name'],
            );
          },
        },
        update: {
          after: async (user) => {
            if (!user.id) return;
            await authAudit(
              configuration.pool,
              'user.updated',
              'user',
              user.id,
              ['email_verified', 'name'],
            );
          },
        },
      },
    },
    emailAndPassword: {
      autoSignIn: false,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
      onPasswordReset: async ({ user }) => {
        await authAudit(
          configuration.pool,
          'user.password_reset',
          'user',
          user.id,
          ['password'],
        );
      },
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ url, user }) => {
        await configuration.email.send({
          kind: 'password-reset',
          recipient: user.email,
          url,
        });
      },
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendOnSignIn: true,
      sendOnSignUp: true,
      sendVerificationEmail: async ({ url, user }) => {
        await configuration.email.send({
          kind: 'verification',
          recipient: user.email,
          url,
        });
      },
    },
    rateLimit: {
      customRules: {
        '/request-password-reset': { max: 3, window: 300 },
        '/send-verification-email': { max: 3, window: 300 },
        '/sign-in/email': { max: 5, window: 60 },
        '/sign-up/email': { max: 5, window: 300 },
      },
      enabled: true,
      max: 100,
      storage: 'memory',
      window: 60,
    },
    secret: configuration.secret,
    session: {
      cookieCache: { enabled: false },
      expiresIn: 60 * 60 * 24 * 7,
      fields: sessionFields,
      freshAge: 60 * 60,
      modelName: 'sessions',
      updateAge: 60 * 60 * 24,
    },
    trustedOrigins: [...configuration.trustedOrigins],
    user: {
      deleteUser: {
        beforeDelete: async (user) => {
          try {
            await configuration.beforeDeleteUser(user.id);
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === 'AccountDeletionBlockedError'
            ) {
              throw new APIError('CONFLICT', {
                message:
                  'Transfer ownership before deleting the final owner account.',
              });
            }
            throw error;
          }
        },
        deleteTokenExpiresIn: 3600,
        enabled: true,
        sendDeleteAccountVerification: async ({ url, user }) => {
          await configuration.email.send({
            kind: 'account-deletion',
            recipient: user.email,
            url,
          });
        },
      },
      fields: userFields,
      modelName: 'users',
    },
    verification: {
      fields: verificationFields,
      modelName: 'verifications',
      storeIdentifier: 'hashed',
    },
  });
}

export type VerifiedAuth = ReturnType<typeof createVerifiedAuth>;
