import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

function contextKey(context) {
  return [
    context.organizationId,
    context.sourceId,
    context.parserId,
    context.logVersion,
  ].join("\u001f");
}

function aad(context) {
  return Buffer.from(JSON.stringify({
    organization_id: context.organizationId,
    source_id: context.sourceId,
    parser_id: context.parserId,
    log_version: context.logVersion,
  }));
}

function validateContext(context) {
  if (!context
    || typeof context.organizationId !== "string"
    || typeof context.sourceId !== "string"
    || typeof context.parserId !== "string"
    || !Number.isSafeInteger(context.logVersion)) {
    throw new TypeError("A complete keychain cache context is required");
  }
}

export class EncryptedMemoryKeychainCache {
  #entries = new Map();
  #masterKey;

  constructor(masterKey) {
    if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
      throw new TypeError("The spike cache requires a 32-byte encryption key");
    }
    this.#masterKey = Buffer.from(masterKey);
  }

  async get(context) {
    validateContext(context);
    const entry = this.#entries.get(contextKey(context));
    if (!entry) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", this.#masterKey, entry.iv);
    decipher.setAAD(aad(context));
    decipher.setAuthTag(entry.authTag);
    const plaintext = Buffer.concat([
      decipher.update(entry.ciphertext),
      decipher.final(),
    ]);

    try {
      return JSON.parse(plaintext.toString("utf8"));
    } finally {
      plaintext.fill(0);
    }
  }

  async put(context, keychains) {
    validateContext(context);
    const iv = randomBytes(12);
    const plaintext = Buffer.from(JSON.stringify(keychains));
    const cipher = createCipheriv("aes-256-gcm", this.#masterKey, iv);
    cipher.setAAD(aad(context));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    plaintext.fill(0);

    this.#entries.set(contextKey(context), {
      organizationId: context.organizationId,
      sourceId: context.sourceId,
      parserId: context.parserId,
      logVersion: context.logVersion,
      iv,
      authTag,
      ciphertext,
      createdAt: new Date().toISOString(),
    });
  }

  async deleteSource(organizationId, sourceId) {
    let deleted = 0;
    for (const [key, entry] of this.#entries.entries()) {
      if (entry.organizationId === organizationId && entry.sourceId === sourceId) {
        entry.ciphertext.fill(0);
        entry.authTag.fill(0);
        entry.iv.fill(0);
        this.#entries.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async deleteOrganization(organizationId) {
    let deleted = 0;
    for (const [key, entry] of this.#entries.entries()) {
      if (entry.organizationId === organizationId) {
        entry.ciphertext.fill(0);
        entry.authTag.fill(0);
        entry.iv.fill(0);
        this.#entries.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  destroy() {
    for (const entry of this.#entries.values()) {
      entry.ciphertext.fill(0);
      entry.authTag.fill(0);
      entry.iv.fill(0);
    }
    this.#entries.clear();
    this.#masterKey.fill(0);
  }

  encryptedSnapshot() {
    return [...this.#entries.values()].map((entry) => ({
      organization_id: entry.organizationId,
      source_id: entry.sourceId,
      parser_id: entry.parserId,
      log_version: entry.logVersion,
      iv: entry.iv.toString("base64"),
      auth_tag: entry.authTag.toString("base64"),
      ciphertext: entry.ciphertext.toString("base64"),
      created_at: entry.createdAt,
    }));
  }

  get size() {
    return this.#entries.size;
  }
}
