import { validateKeychainRequest, validateKeychainResponse } from "./validation.mjs";
import { executeRestrictedChild } from "../restricted-child.mjs";

class PrivateKeychainRequest {
  #request;

  constructor(result, request = null) {
    this.result = Object.freeze({ ...result });
    this.#request = request ? structuredClone(request) : null;
  }

  requestForBroker() {
    return this.#request ? structuredClone(this.#request) : null;
  }

  toJSON() {
    return this.result;
  }
}

function requestResult(fixtureId, status, options = {}, request = null) {
  return new PrivateKeychainRequest({
    schema_version: 1,
    fixture_id: fixtureId,
    status,
    failure_code: options.failureCode ?? null,
    request: options.requestMetadata ?? null,
    process: options.process ?? null,
    has_private_request: Boolean(request),
  }, request);
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function sanitizeDecode(raw, fixtureId, processMetrics) {
  const status = raw?.status === "decoded" ? "decoded" : "decode_failed";
  const allowedFailureCodes = new Set([
    "decode_failed",
    "truncated_records",
    "key_rejected",
    "parser_internal_error",
  ]);

  return {
    schema_version: 1,
    fixture_id: fixtureId,
    status,
    failure_code: allowedFailureCodes.has(raw?.failure_code) ? raw.failure_code : null,
    validation: {
      keychain_received: raw?.validation?.keychain_received === true,
      secret_in_arguments: raw?.validation?.secret_in_arguments === true,
      secret_in_environment: raw?.validation?.secret_in_environment === true,
      frame_count_positive: raw?.validation?.frame_count_positive === true,
      time_monotonic: raw?.validation?.time_monotonic === true,
      coordinates_in_bounds: raw?.validation?.coordinates_in_bounds === true,
      battery_in_bounds: raw?.validation?.battery_in_bounds === true,
    },
    capabilities: {
      location: raw?.capabilities?.location === true,
      battery: raw?.capabilities?.battery === true,
      signal: raw?.capabilities?.signal === true,
      attitude: raw?.capabilities?.attitude === true,
    },
    metrics: {
      frames_count: Number.isSafeInteger(raw?.metrics?.frames_count) && raw.metrics.frames_count >= 0
        ? raw.metrics.frames_count
        : null,
      decode_ms: finiteNonNegative(raw?.metrics?.decode_ms),
      worker_total_ms: finiteNonNegative(raw?.metrics?.worker_total_ms),
      rss_bytes: Number.isSafeInteger(raw?.metrics?.rss_bytes) && raw.metrics.rss_bytes >= 0
        ? raw.metrics.rss_bytes
        : null,
      heap_used_bytes: Number.isSafeInteger(raw?.metrics?.heap_used_bytes) && raw.metrics.heap_used_bytes >= 0
        ? raw.metrics.heap_used_bytes
        : null,
    },
    process: processMetrics,
  };
}

export async function runIsolatedKeychainRequest(options) {
  const execution = await executeRestrictedChild({
    ...options,
    operation: "build-keychain-request",
  });

  if (!execution.ok) {
    return requestResult(options.fixtureId, execution.status, {
      failureCode: execution.failureCode,
      process: execution.process,
    });
  }

  if (execution.raw?.kind !== "keychain_request") {
    return requestResult(options.fixtureId, "worker_failed", {
      failureCode: "invalid_worker_output",
      process: execution.process,
    });
  }

  const validated = validateKeychainRequest(execution.raw.request);
  if (!validated.valid) {
    return requestResult(options.fixtureId, "invalid_keychain_request", {
      failureCode: validated.code,
      process: execution.process,
    });
  }

  return requestResult(options.fixtureId, "keychain_request_ready", {
    requestMetadata: validated.metadata,
    process: execution.process,
  }, execution.raw.request);
}

export async function runIsolatedDecode({ keychains, ...options }) {
  const validated = validateKeychainResponse(keychains);
  if (!validated.valid) {
    return {
      schema_version: 1,
      fixture_id: options.fixtureId,
      status: "decode_failed",
      failure_code: validated.code,
      validation: null,
      capabilities: null,
      metrics: null,
      process: null,
    };
  }

  const execution = await executeRestrictedChild({
    ...options,
    operation: "decode-with-keychain",
    sensitiveInput: { keychains },
  });

  if (!execution.ok) {
    return {
      schema_version: 1,
      fixture_id: options.fixtureId,
      status: "decode_failed",
      failure_code: execution.failureCode,
      validation: null,
      capabilities: null,
      metrics: null,
      process: execution.process,
    };
  }

  if (execution.raw?.kind !== "decode_summary") {
    return {
      schema_version: 1,
      fixture_id: options.fixtureId,
      status: "decode_failed",
      failure_code: "invalid_worker_output",
      validation: null,
      capabilities: null,
      metrics: null,
      process: execution.process,
    };
  }

  return sanitizeDecode(execution.raw, options.fixtureId, execution.process);
}
