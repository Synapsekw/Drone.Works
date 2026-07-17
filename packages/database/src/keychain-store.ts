import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';

import type { QueryResultRow } from 'pg';

import type { AppIdentity } from './organization-authorization.js';
import { OrganizationAccessDeniedError } from './organization-authorization.js';
import {
  requireOrganizationId,
  withOrganizationTransaction,
  type OrganizationPool,
  type OrganizationTransaction,
} from './organization-transaction.js';

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredKeychainContext {
  readonly logVersion: number;
  readonly organizationId: string;
  readonly parserId: string;
  readonly rawSourceId: string;
}

export interface StoredKeychainAuthorization {
  readonly externalServiceProcessingAuthorized: boolean;
  readonly keychainUseAuthorized: boolean;
  readonly noticeVersion: string;
  readonly termsVersion: string;
}

export interface StoredKeychainPoint {
  readonly aesIv: string;
  readonly aesKey: string;
  readonly featurePoint: string;
}

export type StoredKeychainResponse =
  readonly (readonly StoredKeychainPoint[])[];

export interface ManagedKeyProvider {
  key(reference: string, version: string): Promise<Buffer>;
}

interface SealedKeychains {
  readonly authenticationTag: Buffer;
  readonly ciphertext: Buffer;
  readonly keyReference: string;
  readonly keyVersion: string;
  readonly nonce: Buffer;
}

interface CacheRow extends QueryResultRow {
  readonly authentication_tag: Buffer;
  readonly ciphertext: Buffer;
  readonly key_reference: string;
  readonly key_version: string;
  readonly nonce: Buffer;
}

interface AuthorizationRow extends QueryResultRow {
  readonly external_service_processing_authorized: boolean;
  readonly keychain_use_authorized: boolean;
  readonly notice_version: string;
  readonly terms_version: string;
}

interface SourceAuthorizationRow extends QueryResultRow {
  readonly role: 'admin' | 'owner' | 'pilot' | 'viewer';
  readonly uploaded_by_user_id: string;
}

function requireContext(context: StoredKeychainContext): StoredKeychainContext {
  const organizationId = requireOrganizationId(context.organizationId);
  if (
    !uuidPattern.test(context.rawSourceId) ||
    !identifierPattern.test(context.parserId) ||
    !Number.isSafeInteger(context.logVersion) ||
    context.logVersion < 13 ||
    context.logVersion > 255
  ) {
    throw new TypeError('Invalid keychain cache context.');
  }
  return { ...context, organizationId };
}

function requireVersion(value: string, name: string): string {
  if (!identifierPattern.test(value)) {
    throw new TypeError(`${name} must be a stable non-sensitive identifier.`);
  }
  return value;
}

function additionalAuthenticatedData(context: StoredKeychainContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      log_version: context.logVersion,
      organization_id: context.organizationId,
      parser_id: context.parserId,
      raw_source_id: context.rawSourceId,
    }),
  );
}

export class KeychainCacheIntegrityError extends Error {
  constructor() {
    super('The encrypted keychain cache entry failed integrity validation.');
    this.name = 'KeychainCacheIntegrityError';
  }
}

export class Aes256GcmKeychainCipher {
  readonly #activeKeyReference: string;
  readonly #activeKeyVersion: string;
  readonly #provider: ManagedKeyProvider;

  constructor(
    input: Readonly<{
      activeKeyReference: string;
      activeKeyVersion: string;
      provider: ManagedKeyProvider;
    }>,
  ) {
    this.#activeKeyReference = requireVersion(
      input.activeKeyReference,
      'activeKeyReference',
    );
    this.#activeKeyVersion = requireVersion(
      input.activeKeyVersion,
      'activeKeyVersion',
    );
    this.#provider = input.provider;
  }

  async seal(
    context: StoredKeychainContext,
    keychains: StoredKeychainResponse,
  ): Promise<SealedKeychains> {
    const required = requireContext(context);
    const key = await this.#provider.key(
      this.#activeKeyReference,
      this.#activeKeyVersion,
    );
    if (key.length !== 32) {
      key.fill(0);
      throw new TypeError('The managed key provider must return 32 bytes.');
    }
    const nonce = randomBytes(12);
    const plaintext = Buffer.from(JSON.stringify(keychains));
    try {
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(additionalAuthenticatedData(required));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return {
        authenticationTag: cipher.getAuthTag(),
        ciphertext,
        keyReference: this.#activeKeyReference,
        keyVersion: this.#activeKeyVersion,
        nonce,
      };
    } finally {
      key.fill(0);
      plaintext.fill(0);
    }
  }

  async open(
    context: StoredKeychainContext,
    sealed: SealedKeychains,
  ): Promise<StoredKeychainResponse> {
    const required = requireContext(context);
    const key = await this.#provider.key(
      sealed.keyReference,
      sealed.keyVersion,
    );
    if (key.length !== 32) {
      key.fill(0);
      throw new KeychainCacheIntegrityError();
    }
    let plaintext: Buffer | null = null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
      decipher.setAAD(additionalAuthenticatedData(required));
      decipher.setAuthTag(sealed.authenticationTag);
      plaintext = Buffer.concat([
        decipher.update(sealed.ciphertext),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString('utf8')) as StoredKeychainResponse;
    } catch {
      throw new KeychainCacheIntegrityError();
    } finally {
      key.fill(0);
      plaintext?.fill(0);
    }
  }
}

async function writeAudit(
  transaction: OrganizationTransaction,
  actorUserId: string,
  action: string,
  rawSourceId: string,
  changedFields: readonly string[],
): Promise<void> {
  await transaction.query(
    `INSERT INTO droneworks.audit_events (
       organization_id, id, actor_kind, actor_user_id, action,
       resource_type, resource_id, changed_fields, metadata, occurred_at
     ) VALUES ($1, $2, 'user', $3, $4, 'raw_source', $5, $6,
               '{"provider":"dji"}'::jsonb, now())`,
    [
      transaction.organizationId,
      randomUUID(),
      actorUserId,
      action,
      rawSourceId,
      [...changedFields],
    ],
  );
}

export class PostgresKeychainStore {
  readonly #cipher: Aes256GcmKeychainCipher;
  readonly #pool: OrganizationPool;

  constructor(
    input: Readonly<{
      cipher: Aes256GcmKeychainCipher;
      pool: OrganizationPool;
    }>,
  ) {
    this.#cipher = input.cipher;
    this.#pool = input.pool;
  }

  async authorization(
    context: StoredKeychainContext,
  ): Promise<StoredKeychainAuthorization | null> {
    const required = requireContext(context);
    return withOrganizationTransaction(
      this.#pool,
      required.organizationId,
      async (transaction) => {
        const result = await transaction.query<AuthorizationRow>(
          `SELECT consent.keychain_use_authorized,
                  consent.external_service_processing_authorized,
                  consent.notice_version,
                  consent.terms_version
             FROM droneworks.keychain_authorizations AS consent
             JOIN droneworks.raw_sources AS source
               ON (source.organization_id, source.id) =
                  (consent.organization_id, consent.raw_source_id)
            WHERE consent.organization_id = $1
              AND consent.raw_source_id = $2
              AND consent.revoked_at IS NULL
              AND source.state = 'retained'`,
          [required.organizationId, required.rawSourceId],
        );
        const row = result.rows[0];
        return row
          ? {
              externalServiceProcessingAuthorized:
                row.external_service_processing_authorized,
              keychainUseAuthorized: row.keychain_use_authorized,
              noticeVersion: row.notice_version,
              termsVersion: row.terms_version,
            }
          : null;
      },
    );
  }

  async authorizeSource(
    identity: AppIdentity,
    organizationId: string,
    rawSourceId: string,
    input: Readonly<{
      noticeVersion: string;
      termsVersion: string;
    }>,
  ): Promise<void> {
    return this.setSourceAuthorization(identity, organizationId, rawSourceId, {
      externalServiceProcessingAuthorized: true,
      keychainUseAuthorized: true,
      ...input,
    });
  }

  async setSourceAuthorization(
    identity: AppIdentity,
    organizationId: string,
    rawSourceId: string,
    input: Readonly<{
      externalServiceProcessingAuthorized: boolean;
      keychainUseAuthorized: boolean;
      noticeVersion: string;
      termsVersion: string;
    }>,
  ): Promise<void> {
    const requiredOrganizationId = requireOrganizationId(organizationId);
    if (
      !uuidPattern.test(rawSourceId) ||
      typeof input.keychainUseAuthorized !== 'boolean' ||
      typeof input.externalServiceProcessingAuthorized !== 'boolean'
    )
      throw new OrganizationAccessDeniedError();
    const noticeVersion = requireVersion(input.noticeVersion, 'noticeVersion');
    const termsVersion = requireVersion(input.termsVersion, 'termsVersion');
    await withOrganizationTransaction(
      this.#pool,
      requiredOrganizationId,
      async (transaction) => {
        const source = await transaction.query<SourceAuthorizationRow>(
          `SELECT membership.role, batch.uploaded_by_user_id
             FROM droneworks.raw_sources AS source
             JOIN droneworks.import_items AS item
               ON (item.organization_id, item.raw_source_id) =
                  (source.organization_id, source.id)
             JOIN droneworks.import_batches AS batch
               ON (batch.organization_id, batch.id) =
                  (item.organization_id, item.import_batch_id)
             JOIN droneworks.memberships AS membership
               ON membership.organization_id = source.organization_id
              AND membership.user_id = $3
            WHERE source.organization_id = $1
              AND source.id = $2
              AND source.state = 'retained'
            ORDER BY item.created_at
            LIMIT 1`,
          [requiredOrganizationId, rawSourceId, identity.userId],
        );
        const row = source.rows[0];
        if (
          !row ||
          (!['owner', 'admin'].includes(row.role) &&
            row.uploaded_by_user_id !== identity.userId)
        ) {
          throw new OrganizationAccessDeniedError();
        }
        await transaction.query(
          `INSERT INTO droneworks.keychain_authorizations (
             organization_id, raw_source_id, keychain_use_authorized,
             external_service_processing_authorized, notice_version,
             terms_version, approved_by_user_id, approved_at, revoked_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), NULL)
           ON CONFLICT (organization_id, raw_source_id) DO UPDATE SET
             keychain_use_authorized = EXCLUDED.keychain_use_authorized,
             external_service_processing_authorized =
               EXCLUDED.external_service_processing_authorized,
             notice_version = EXCLUDED.notice_version,
             terms_version = EXCLUDED.terms_version,
             approved_by_user_id = EXCLUDED.approved_by_user_id,
             approved_at = EXCLUDED.approved_at,
             revoked_at = NULL`,
          [
            requiredOrganizationId,
            rawSourceId,
            input.keychainUseAuthorized,
            input.externalServiceProcessingAuthorized,
            noticeVersion,
            termsVersion,
            identity.userId,
          ],
        );
        if (!input.keychainUseAuthorized) {
          await transaction.query(
            `DELETE FROM droneworks.keychain_cache_entries
              WHERE organization_id = $1 AND raw_source_id = $2`,
            [requiredOrganizationId, rawSourceId],
          );
        }
        await writeAudit(
          transaction,
          identity.userId,
          'keychain.authorization_recorded',
          rawSourceId,
          [
            'external_service_processing_authorized',
            'keychain_use_authorized',
            'notice_version',
            'terms_version',
          ],
        );
      },
    );
  }

  async get(
    context: StoredKeychainContext,
  ): Promise<StoredKeychainResponse | null> {
    const required = requireContext(context);
    return withOrganizationTransaction(
      this.#pool,
      required.organizationId,
      async (transaction) => {
        const result = await transaction.query<CacheRow>(
          `SELECT key_reference, key_version, nonce, authentication_tag, ciphertext
             FROM droneworks.keychain_cache_entries AS cache
             JOIN droneworks.keychain_authorizations AS consent
               ON (consent.organization_id, consent.raw_source_id) =
                  (cache.organization_id, cache.raw_source_id)
             JOIN droneworks.raw_sources AS source
               ON (source.organization_id, source.id) =
                  (cache.organization_id, cache.raw_source_id)
            WHERE cache.organization_id = $1
              AND cache.raw_source_id = $2
              AND cache.parser_id = $3
              AND cache.log_version = $4
              AND consent.revoked_at IS NULL
              AND consent.keychain_use_authorized
              AND source.state = 'retained'`,
          [
            required.organizationId,
            required.rawSourceId,
            required.parserId,
            required.logVersion,
          ],
        );
        const row = result.rows[0];
        if (!row) return null;
        const keychains = await this.#cipher.open(required, {
          authenticationTag: row.authentication_tag,
          ciphertext: row.ciphertext,
          keyReference: row.key_reference,
          keyVersion: row.key_version,
          nonce: row.nonce,
        });
        await transaction.query(
          `UPDATE droneworks.keychain_cache_entries
              SET last_used_at = now()
            WHERE organization_id = $1
              AND raw_source_id = $2
              AND parser_id = $3
              AND log_version = $4`,
          [
            required.organizationId,
            required.rawSourceId,
            required.parserId,
            required.logVersion,
          ],
        );
        return keychains;
      },
    );
  }

  async put(
    context: StoredKeychainContext,
    keychains: StoredKeychainResponse,
    metadata: Readonly<{
      noticeVersion: string;
      providerId: string;
      termsVersion: string;
    }>,
  ): Promise<void> {
    const required = requireContext(context);
    const providerId = requireVersion(metadata.providerId, 'providerId');
    const noticeVersion = requireVersion(
      metadata.noticeVersion,
      'noticeVersion',
    );
    const termsVersion = requireVersion(metadata.termsVersion, 'termsVersion');
    const sealed = await this.#cipher.seal(required, keychains);
    try {
      await withOrganizationTransaction(
        this.#pool,
        required.organizationId,
        async (transaction) => {
          const result = await transaction.query(
            `INSERT INTO droneworks.keychain_cache_entries (
               organization_id, raw_source_id, parser_id, log_version,
               provider_id, notice_version, terms_version, key_reference,
               key_version, nonce, authentication_tag, ciphertext,
               created_at, last_used_at
             )
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    now(), now()
               FROM droneworks.keychain_authorizations AS consent
              WHERE consent.organization_id = $1
                AND consent.raw_source_id = $2
                AND consent.revoked_at IS NULL
                AND consent.keychain_use_authorized
                AND consent.external_service_processing_authorized
                AND consent.notice_version = $6
                AND consent.terms_version = $7
             ON CONFLICT (organization_id, raw_source_id, parser_id, log_version)
             DO UPDATE SET
               provider_id = EXCLUDED.provider_id,
               notice_version = EXCLUDED.notice_version,
               terms_version = EXCLUDED.terms_version,
               key_reference = EXCLUDED.key_reference,
               key_version = EXCLUDED.key_version,
               nonce = EXCLUDED.nonce,
               authentication_tag = EXCLUDED.authentication_tag,
               ciphertext = EXCLUDED.ciphertext,
               created_at = EXCLUDED.created_at,
               last_used_at = EXCLUDED.last_used_at`,
            [
              required.organizationId,
              required.rawSourceId,
              required.parserId,
              required.logVersion,
              providerId,
              noticeVersion,
              termsVersion,
              sealed.keyReference,
              sealed.keyVersion,
              sealed.nonce,
              sealed.authenticationTag,
              sealed.ciphertext,
            ],
          );
          if (result.rowCount !== 1) throw new OrganizationAccessDeniedError();
        },
      );
    } finally {
      sealed.nonce.fill(0);
      sealed.authenticationTag.fill(0);
      sealed.ciphertext.fill(0);
    }
  }

  async revokeSource(
    identity: AppIdentity,
    organizationId: string,
    rawSourceId: string,
  ): Promise<number> {
    const requiredOrganizationId = requireOrganizationId(organizationId);
    if (!uuidPattern.test(rawSourceId))
      throw new OrganizationAccessDeniedError();
    return withOrganizationTransaction(
      this.#pool,
      requiredOrganizationId,
      async (transaction) => {
        const membership = await transaction.query<
          { readonly role: string } & QueryResultRow
        >(
          `SELECT role FROM droneworks.memberships
            WHERE organization_id = $1 AND user_id = $2`,
          [requiredOrganizationId, identity.userId],
        );
        if (!membership.rows[0] || membership.rows[0].role === 'viewer') {
          throw new OrganizationAccessDeniedError();
        }
        const deleted = await transaction.query(
          `DELETE FROM droneworks.keychain_cache_entries
            WHERE organization_id = $1 AND raw_source_id = $2`,
          [requiredOrganizationId, rawSourceId],
        );
        const revoked = await transaction.query(
          `UPDATE droneworks.keychain_authorizations
              SET keychain_use_authorized = false,
                  external_service_processing_authorized = false,
                  revoked_at = now()
            WHERE organization_id = $1
              AND raw_source_id = $2
              AND revoked_at IS NULL`,
          [requiredOrganizationId, rawSourceId],
        );
        if (revoked.rowCount !== 1) throw new OrganizationAccessDeniedError();
        await writeAudit(
          transaction,
          identity.userId,
          'keychain.authorization_revoked',
          rawSourceId,
          [
            'external_service_processing_authorized',
            'keychain_use_authorized',
            'revoked_at',
          ],
        );
        return deleted.rowCount ?? 0;
      },
    );
  }

  async deleteSource(
    organizationId: string,
    rawSourceId: string,
  ): Promise<number> {
    const requiredOrganizationId = requireOrganizationId(organizationId);
    if (!uuidPattern.test(rawSourceId)) return 0;
    return withOrganizationTransaction(
      this.#pool,
      requiredOrganizationId,
      async (transaction) => {
        const result = await transaction.query(
          `DELETE FROM droneworks.keychain_cache_entries
            WHERE organization_id = $1 AND raw_source_id = $2`,
          [requiredOrganizationId, rawSourceId],
        );
        return result.rowCount ?? 0;
      },
    );
  }

  async deleteOrganization(organizationId: string): Promise<number> {
    const requiredOrganizationId = requireOrganizationId(organizationId);
    return withOrganizationTransaction(
      this.#pool,
      requiredOrganizationId,
      async (transaction) => {
        const result = await transaction.query(
          `DELETE FROM droneworks.keychain_cache_entries
            WHERE organization_id = $1`,
          [requiredOrganizationId],
        );
        return result.rowCount ?? 0;
      },
    );
  }
}
