const STATUSES = new Set([
  "detected",
  "encrypted_key_required",
  "rejected",
  "fixture_unavailable",
  "timed_out",
  "output_limited",
  "memory_limited",
  "isolation_unavailable",
  "worker_failed",
]);

const FAILURE_CODES = new Set([
  "unsupported_format",
  "unsupported_version",
  "invalid_or_corrupt_prefix",
  "missing_required_details",
  "encrypted_key_required",
  "fixture_unavailable",
  "parser_wall_time_limit",
  "parser_output_limit",
  "parser_memory_limit",
  "network_isolation_unavailable",
  "invalid_worker_output",
  "parser_internal_error",
]);

const ENCRYPTION = new Set(["none", "keychain_required", "unknown"]);

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function safeText(value, maxLength = 80) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replaceAll(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

export function sanitizeWorkerResult(raw, fixtureId) {
  const status = STATUSES.has(raw?.status) ? raw.status : "worker_failed";
  const failureCode = FAILURE_CODES.has(raw?.failure_code) ? raw.failure_code : null;
  const formatVersion = Number.isSafeInteger(raw?.format_version) && raw.format_version >= 0
    ? raw.format_version
    : null;

  return {
    schema_version: 1,
    fixture_id: fixtureId,
    status,
    failure_code: failureCode,
    format_family: raw?.format_family === "dji_txt" ? "dji_txt" : null,
    format_version: formatVersion,
    encryption: ENCRYPTION.has(raw?.encryption) ? raw.encryption : "unknown",
    source: {
      platform: safeText(raw?.source?.platform),
      application_version: safeText(raw?.source?.application_version),
      product_type: safeText(raw?.source?.product_type),
    },
    metrics: {
      bytes: Number.isSafeInteger(raw?.metrics?.bytes) && raw.metrics.bytes >= 0
        ? raw.metrics.bytes
        : null,
      read_ms: finiteNonNegative(raw?.metrics?.read_ms),
      parse_ms: finiteNonNegative(raw?.metrics?.parse_ms),
      worker_total_ms: finiteNonNegative(raw?.metrics?.worker_total_ms),
      rss_bytes: Number.isSafeInteger(raw?.metrics?.rss_bytes) && raw.metrics.rss_bytes >= 0
        ? raw.metrics.rss_bytes
        : null,
      heap_used_bytes: Number.isSafeInteger(raw?.metrics?.heap_used_bytes) && raw.metrics.heap_used_bytes >= 0
        ? raw.metrics.heap_used_bytes
        : null,
    },
  };
}

export function supervisorFailure(fixtureId, status, failureCode, metrics = {}) {
  return sanitizeWorkerResult({
    status,
    failure_code: failureCode,
    encryption: "unknown",
    metrics,
  }, fixtureId);
}
