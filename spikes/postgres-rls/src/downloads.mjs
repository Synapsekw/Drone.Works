import { withOrganization } from "./repositories.mjs";

export const DEFAULT_DOWNLOAD_TTL_MS = 5 * 60 * 1000;
export const MAX_DOWNLOAD_TTL_MS = 15 * 60 * 1000;

export class DownloadAuthorizationError extends Error {
  constructor() {
    super("Download is not available");
    this.name = "DownloadAuthorizationError";
    this.code = "download_not_found";
    this.status = 404;
  }
}

function requireId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${field} must be a non-empty identifier`);
  }
  return value;
}

function encodeObjectSegment(value) {
  return encodeURIComponent(requireId(value, "object key segment"))
    .replace(/[!'()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
}

export function deriveObjectKey(resourceType, resource) {
  if (!["raw_source", "export"].includes(resourceType)) {
    throw new TypeError("resourceType must be raw_source or export");
  }
  if (resource === null || typeof resource !== "object") {
    throw new TypeError("authorized resource is required");
  }
  const organization = encodeObjectSegment(resource.organization_id);
  const resourceId = encodeObjectSegment(resource.resource_id);
  const objectComponent = encodeObjectSegment(resource.object_component);

  if (resourceType === "raw_source") {
    return `organizations/${organization}/raw-sources/${resourceId}/revisions/${objectComponent}`;
  }
  return `organizations/${organization}/exports/${resourceId}/${objectComponent}`;
}

export async function issueAuthorizedDownload(pool, input, signer, options = {}) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("download input is required");
  }
  if (Object.hasOwn(input, "objectKey")) {
    throw new TypeError("objectKey is derived from an authorized resource");
  }
  if (signer === null || typeof signer?.issue !== "function") {
    throw new TypeError("signer.issue must be a function");
  }

  const organizationId = requireId(input.organizationId, "organizationId");
  const userId = requireId(input.userId, "userId");
  const resourceId = requireId(input.resourceId, "resourceId");
  if (!["raw_source", "export"].includes(input.resourceType)) {
    throw new TypeError("resourceType must be raw_source or export");
  }

  const now = options.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError("now must be a valid Date");
  }
  const ttlMs = options.ttlMs ?? DEFAULT_DOWNLOAD_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_DOWNLOAD_TTL_MS) {
    throw new RangeError(`ttlMs must be between 1 and ${MAX_DOWNLOAD_TTL_MS}`);
  }
  const expiresAt = new Date(now.valueOf() + ttlMs);

  return withOrganization(pool, organizationId, async (repositories) => {
    const resource = await repositories.findDownloadableObject({
      userId,
      resourceType: input.resourceType,
      resourceId,
      now,
    });
    if (resource === null) {
      throw new DownloadAuthorizationError();
    }

    const signed = await signer.issue({
      objectKey: deriveObjectKey(input.resourceType, resource),
      expiresAt: new Date(expiresAt),
    });
    if (signed === null || typeof signed?.url !== "string" || signed.url.length === 0) {
      throw new TypeError("signer.issue must return a non-empty url");
    }
    return Object.freeze({
      url: signed.url,
      expiresAt: expiresAt.toISOString(),
    });
  });
}
