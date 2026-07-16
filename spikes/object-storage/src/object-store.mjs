import { createHash } from "node:crypto";

export const MAX_SIGNED_DOWNLOAD_TTL_MS = 15 * 60 * 1000;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireKey(value) {
  if (typeof value !== "string"
      || !value.startsWith("organizations/")
      || value.includes("//")
      || value.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("objectKey must be a derived organization key");
  }
  return value;
}

function requireSha256(value) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("sha256 must be a lowercase SHA-256 digest");
  }
  return value;
}

export class ImmutableObjectConflictError extends Error {
  constructor() {
    super("immutable object key already contains different bytes");
    this.name = "ImmutableObjectConflictError";
  }
}

export class VersionedObjectStore {
  constructor(provider, { now = () => new Date() } = {}) {
    for (const method of [
      "putObject",
      "headObject",
      "listObjectVersions",
      "deleteObjectVersion",
      "signGetObject",
    ]) {
      if (typeof provider?.[method] !== "function") {
        throw new TypeError(`provider.${method} must be a function`);
      }
    }
    if (typeof now !== "function") {
      throw new TypeError("now must be a function");
    }
    this.provider = provider;
    this.now = now;
  }

  async putIfAbsent({ objectKey, bytes, contentType, sha256: expectedSha256 }) {
    const key = requireKey(objectKey);
    const body = Buffer.from(bytes);
    const digest = requireSha256(expectedSha256);
    if (sha256(body) !== digest) {
      throw new TypeError("bytes do not match sha256");
    }
    if (typeof contentType !== "string" || contentType.length === 0) {
      throw new TypeError("contentType is required");
    }
    try {
      const created = await this.provider.putObject({
        key,
        bytes: body,
        contentType,
        checksumSha256: digest,
        ifNoneMatch: "*",
      });
      return Object.freeze({
        stored: true,
        versionId: created.versionId,
        sha256: digest,
      });
    } catch (error) {
      if (error?.code !== "PreconditionFailed") {
        throw error;
      }
      const existing = await this.provider.headObject({ key });
      if (existing === null || existing.checksumSha256 !== digest) {
        throw new ImmutableObjectConflictError();
      }
      return Object.freeze({
        stored: false,
        versionId: existing.versionId,
        sha256: digest,
      });
    }
  }

  async issueDownload({ objectKey, versionId, ttlMs = 5 * 60 * 1000 }) {
    const key = requireKey(objectKey);
    if (typeof versionId !== "string" || versionId.length === 0) {
      throw new TypeError("versionId is required");
    }
    if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_SIGNED_DOWNLOAD_TTL_MS) {
      throw new RangeError(`ttlMs must be between 1 and ${MAX_SIGNED_DOWNLOAD_TTL_MS}`);
    }
    const object = await this.provider.headObject({ key, versionId });
    if (object === null) {
      return null;
    }
    const expiresAt = new Date(this.now().valueOf() + ttlMs);
    const signed = await this.provider.signGetObject({ key, versionId, expiresAt });
    return Object.freeze({ url: signed.url, expiresAt: expiresAt.toISOString() });
  }

  async purgePrefix(prefix) {
    const organizationPrefix = requireKey(prefix);
    if (!organizationPrefix.endsWith("/")) {
      throw new TypeError("purge prefix must end with /");
    }
    let deletedVersions = 0;
    while (true) {
      const versions = await this.provider.listObjectVersions({ prefix: organizationPrefix });
      if (versions.length === 0) {
        break;
      }
      for (const version of versions) {
        await this.provider.deleteObjectVersion({
          key: version.key,
          versionId: version.versionId,
        });
        deletedVersions += 1;
      }
    }
    const remaining = await this.provider.listObjectVersions({ prefix: organizationPrefix });
    if (remaining.length !== 0) {
      throw new Error("provider deletion could not be verified");
    }
    return Object.freeze({
      deletedVersions,
      prefixSha256: sha256(Buffer.from(organizationPrefix)),
      verifiedAt: this.now().toISOString(),
    });
  }
}
