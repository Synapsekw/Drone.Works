import { createHash } from "node:crypto";
import { deriveObjectKey } from "./downloads.mjs";
import { withOrganization } from "./repositories.mjs";

export const ORGANIZATION_EXPORT_BUNDLE_FORMAT =
  "droneworks-organization-export-v1";
export const ORGANIZATION_EXPORT_BUNDLE_CONTENT_TYPE =
  "application/vnd.droneworks.organization-export+json";
export const ORGANIZATION_EXPORT_ARTIFACT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const FLIGHT_CSV_FIELDS = Object.freeze([
  "organization_id",
  "id",
  "pilot_profile_id",
  "aircraft_id",
  "source_kind",
  "state",
  "takeoff_at",
  "takeoff_timezone",
  "duration_ms",
  "location_text",
  "notes",
]);

const TELEMETRY_CSV_FIELDS = Object.freeze([
  "organization_id",
  "flight_revision_id",
  "elapsed_ms",
  "height_agl_m",
]);

function requireId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${field} must be a non-empty identifier`);
  }
  return value;
}

function requireDate(value, field) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "object"
    ? canonicalJson(value).trimEnd()
    : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function csvDocument(rows, fields) {
  const lines = [fields.join(",")];
  for (const row of rows) {
    lines.push(fields.map((field) => csvValue(row[field])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function bundleFile(path, mediaType, content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    path,
    media_type: mediaType,
    byte_length: bytes.length,
    sha256: sha256(bytes),
    content_base64: bytes.toString("base64"),
  };
}

export function buildOrganizationExportBundle(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("manifest must be an object");
  }
  if (manifest.schema_version !== 1
      || manifest.snapshot === null
      || typeof manifest.snapshot !== "object"
      || Array.isArray(manifest.snapshot)) {
    throw new TypeError("manifest must contain a version 1 snapshot");
  }
  const flights = manifest.snapshot.canonical_flights;
  const telemetry = manifest.snapshot.telemetry_samples;
  if (!Array.isArray(flights) || !Array.isArray(telemetry)) {
    throw new TypeError("manifest snapshot must contain flights and telemetry");
  }
  const { snapshot, ...publicManifest } = manifest;
  const files = [
    bundleFile(
      "manifest.json",
      "application/json",
      canonicalJson({
        ...publicManifest,
        bundle_format: ORGANIZATION_EXPORT_BUNDLE_FORMAT,
        data_files: ["data.json", "flights.csv", "telemetry.csv"],
      }),
    ),
    bundleFile(
      "data.json",
      "application/json",
      canonicalJson({ schema_version: 1, collections: snapshot }),
    ),
    bundleFile(
      "flights.csv",
      "text/csv",
      csvDocument(flights, FLIGHT_CSV_FIELDS),
    ),
    bundleFile(
      "telemetry.csv",
      "text/csv",
      csvDocument(telemetry, TELEMETRY_CSV_FIELDS),
    ),
  ];
  const bytes = Buffer.from(canonicalJson({
    archive_format: ORGANIZATION_EXPORT_BUNDLE_FORMAT,
    files,
  }), "utf8");
  return Object.freeze({
    bytes,
    sha256: sha256(bytes),
    contentType: ORGANIZATION_EXPORT_BUNDLE_CONTENT_TYPE,
    files: Object.freeze(files.map((file) => Object.freeze({
      path: file.path,
      mediaType: file.media_type,
      byteLength: file.byte_length,
      sha256: file.sha256,
    }))),
  });
}

function artifactIdentity(organizationId, exportRequestId, bundleSha256) {
  const resourceDigest = createHash("sha256")
    .update(`${organizationId}\0${exportRequestId}`)
    .digest("hex")
    .slice(0, 32);
  return Object.freeze({
    artifactId: `organization-export-artifact-${resourceDigest}`,
    objectArtifactId: `bundle-v1-${bundleSha256}.json`,
  });
}

export async function generateOrganizationExportArtifact(
  pool,
  input,
  artifactStore,
  options = {},
) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("organization export input is required");
  }
  if (artifactStore === null
      || typeof artifactStore?.putIfAbsent !== "function") {
    throw new TypeError("artifactStore.putIfAbsent must be a function");
  }
  const organizationId = requireId(input.organizationId, "organizationId");
  const exportRequestId = requireId(
    input.exportRequestId,
    "exportRequestId",
  );
  const now = requireDate(options.now ?? new Date(), "now");

  return withOrganization(pool, organizationId, async (repositories) => {
    const request = await repositories.lockOrganizationExportForGeneration(
      exportRequestId,
    );
    if (request === null) {
      return null;
    }
    if (request.state === "ready") {
      if (request.export_artifact_id === null
          || request.object_artifact_id === null
          || request.artifact_state !== "ready") {
        throw new Error("ready organization export has no ready artifact");
      }
      return Object.freeze({
        status: "already_ready",
        exportRequestId,
        artifactId: request.export_artifact_id,
        objectKey: deriveObjectKey("export", {
          organization_id: organizationId,
          resource_id: request.export_artifact_id,
          object_component: request.object_artifact_id,
        }),
      });
    }
    if (!["queued", "processing"].includes(request.state)) {
      throw new Error(`organization export cannot run from ${request.state}`);
    }

    const bundle = buildOrganizationExportBundle(request.manifest);
    const identity = artifactIdentity(
      organizationId,
      exportRequestId,
      bundle.sha256,
    );
    const objectKey = deriveObjectKey("export", {
      organization_id: organizationId,
      resource_id: identity.artifactId,
      object_component: identity.objectArtifactId,
    });
    const stored = await artifactStore.putIfAbsent({
      objectKey,
      bytes: Buffer.from(bundle.bytes),
      contentType: bundle.contentType,
      sha256: bundle.sha256,
    });
    if (stored === null
        || typeof stored !== "object"
        || stored.sha256 !== bundle.sha256) {
      throw new Error("artifact store did not confirm the export digest");
    }
    const availableUntil = new Date(
      now.valueOf() + ORGANIZATION_EXPORT_ARTIFACT_LIFETIME_MS,
    );
    const completed = await repositories.finalizeOrganizationExport({
      exportRequestId,
      requestedByUserId: request.requested_by_user_id,
      artifactId: identity.artifactId,
      objectArtifactId: identity.objectArtifactId,
      bundleSha256: bundle.sha256,
      fileCount: bundle.files.length,
      now,
      availableUntil,
    });
    return Object.freeze({
      status: "ready",
      exportRequestId,
      artifactId: identity.artifactId,
      objectKey,
      sha256: bundle.sha256,
      byteLength: bundle.bytes.length,
      files: bundle.files,
      availableUntil: availableUntil.toISOString(),
      exportRequest: completed.exportRequest,
    });
  });
}
