import { createHash } from "node:crypto";
import {
  loadFlightForJob,
  loadOrganizationExportForJob,
} from "./repositories.mjs";
import {
  permanentlyDeleteFlight,
  permanentlyDeleteOrganization,
} from "./deletions.mjs";

export const FLIGHT_REFRESH_QUEUE = "canonical-flight-refresh-v1";
export const FLIGHT_REFRESH_PAYLOAD_VERSION = 1;

const PAYLOAD_KEYS = Object.freeze([
  "flightId",
  "organizationId",
  "schemaVersion",
]);

export const ORGANIZATION_EXPORT_QUEUE = "organization-export-v1";
export const ORGANIZATION_EXPORT_PAYLOAD_VERSION = 1;

const ORGANIZATION_EXPORT_PAYLOAD_KEYS = Object.freeze([
  "exportRequestId",
  "organizationId",
  "schemaVersion",
]);

export const ORGANIZATION_DELETION_QUEUE = "organization-deletion-v1";
export const ORGANIZATION_DELETION_PAYLOAD_VERSION = 1;

const ORGANIZATION_DELETION_PAYLOAD_KEYS = Object.freeze([
  "deletionRequestedAt",
  "organizationId",
  "schemaVersion",
]);

export const FLIGHT_DELETION_QUEUE = "flight-deletion-v1";
export const FLIGHT_DELETION_PAYLOAD_VERSION = 1;

const FLIGHT_DELETION_PAYLOAD_KEYS = Object.freeze([
  "deletedAt",
  "flightId",
  "organizationId",
  "schemaVersion",
]);

const OUTBOX_JOB_TYPES = new Set([
  FLIGHT_REFRESH_QUEUE,
  ORGANIZATION_EXPORT_QUEUE,
  ORGANIZATION_DELETION_QUEUE,
  FLIGHT_DELETION_QUEUE,
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

function stableQueueJobId(organizationId, outboxId) {
  const bytes = createHash("sha256")
    .update(`droneworks-outbox-v1\0${organizationId}\0${outboxId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireClaim(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("claimed outbox row is required");
  }
  if (!OUTBOX_JOB_TYPES.has(value.job_type) || Number(value.payload_version) !== 1) {
    throw new TypeError("claimed outbox job type or payload version is invalid");
  }
  requireId(value.organization_id, "organizationId");
  requireId(value.id, "outboxId");
  requireId(value.resource_id, "resourceId");
  return value;
}

export function outboxJob(claim) {
  const row = requireClaim(claim);
  let data;
  if (row.job_type === FLIGHT_REFRESH_QUEUE) {
    data = flightRefreshPayload({
      schemaVersion: 1,
      organizationId: row.organization_id,
      flightId: row.resource_id,
    });
  } else if (row.job_type === ORGANIZATION_EXPORT_QUEUE) {
    data = organizationExportPayload({
      schemaVersion: 1,
      organizationId: row.organization_id,
      exportRequestId: row.resource_id,
    });
  } else if (row.job_type === ORGANIZATION_DELETION_QUEUE) {
    const expectedAt = requireDate(row.expected_at, "expectedAt").toISOString();
    data = organizationDeletionPayload({
      schemaVersion: 1,
      organizationId: row.organization_id,
      deletionRequestedAt: expectedAt,
    });
  } else {
    const expectedAt = requireDate(row.expected_at, "expectedAt").toISOString();
    data = flightDeletionPayload({
      schemaVersion: 1,
      organizationId: row.organization_id,
      flightId: row.resource_id,
      deletedAt: expectedAt,
    });
  }
  return Object.freeze({
    queue: row.job_type,
    jobId: stableQueueJobId(row.organization_id, row.id),
    data,
  });
}

export async function claimJobOutbox(pool, input) {
  if (pool === null || typeof pool?.query !== "function") {
    throw new TypeError("dispatcher pool.query must be a function");
  }
  const claimToken = requireId(input?.claimToken, "claimToken");
  const now = requireDate(input?.now, "now");
  const leaseSeconds = input?.leaseSeconds ?? 30;
  const limit = input?.limit ?? 10;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 600) {
    throw new TypeError("leaseSeconds must be an integer between 10 and 600");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("limit must be an integer between 1 and 100");
  }
  const result = await pool.query(
    "SELECT * FROM droneworks_jobs.claim_outbox($1, $2, $3, $4)",
    [claimToken, now.toISOString(), leaseSeconds, limit],
  );
  return result.rows.map((row) => Object.freeze(row));
}

export async function sendClaimedOutbox(boss, claim) {
  if (boss === null || typeof boss?.send !== "function") {
    throw new TypeError("boss.send must be a function");
  }
  const job = outboxJob(claim);
  const sentId = await boss.send(job.queue, job.data, { id: job.jobId });
  if (sentId !== null && sentId !== job.jobId) {
    throw new Error("queue returned an unexpected outbox job ID");
  }
  if (sentId === null) {
    const existing = await boss.getJobById(job.queue, job.jobId);
    if (existing === null
        || JSON.stringify(existing.data) !== JSON.stringify(job.data)) {
      throw new Error("queue deduplication did not retain the expected outbox job");
    }
  }
  return job.jobId;
}

export async function completeClaimedOutbox(pool, claim, input) {
  if (pool === null || typeof pool?.query !== "function") {
    throw new TypeError("dispatcher pool.query must be a function");
  }
  const row = requireClaim(claim);
  const claimToken = requireId(input?.claimToken, "claimToken");
  const queueJobId = requireId(input?.queueJobId, "queueJobId");
  const dispatchedAt = requireDate(input?.dispatchedAt, "dispatchedAt");
  const result = await pool.query(
    "SELECT droneworks_jobs.complete_outbox($1, $2, $3, $4, $5) AS completed",
    [row.organization_id, row.id, claimToken, queueJobId, dispatchedAt.toISOString()],
  );
  return result.rows[0].completed;
}

export async function releaseClaimedOutbox(pool, claim, input) {
  if (pool === null || typeof pool?.query !== "function") {
    throw new TypeError("dispatcher pool.query must be a function");
  }
  const row = requireClaim(claim);
  const claimToken = requireId(input?.claimToken, "claimToken");
  const availableAt = requireDate(input?.availableAt, "availableAt");
  const result = await pool.query(
    "SELECT droneworks_jobs.release_outbox($1, $2, $3, $4) AS released",
    [row.organization_id, row.id, claimToken, availableAt.toISOString()],
  );
  return result.rows[0].released;
}

export async function readJobOutboxMetrics(pool, now) {
  if (pool === null || typeof pool?.query !== "function") {
    throw new TypeError("dispatcher pool.query must be a function");
  }
  const result = await pool.query(
    "SELECT * FROM droneworks_jobs.outbox_metrics($1)",
    [requireDate(now, "now").toISOString()],
  );
  const row = result.rows[0];
  return Object.freeze({
    pendingCount: Number(row.pending_count),
    claimedCount: Number(row.claimed_count),
    oldestPendingSeconds: Number(row.oldest_pending_seconds),
  });
}

export function flightRefreshPayload(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("job payload must be an object");
  }
  const keys = Object.keys(input).sort();
  if (keys.length !== PAYLOAD_KEYS.length
      || keys.some((key, index) => key !== PAYLOAD_KEYS[index])) {
    throw new TypeError(
      "job payload must contain only schemaVersion, organizationId, and flightId",
    );
  }
  if (input.schemaVersion !== FLIGHT_REFRESH_PAYLOAD_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${FLIGHT_REFRESH_PAYLOAD_VERSION}`,
    );
  }
  return Object.freeze({
    schemaVersion: FLIGHT_REFRESH_PAYLOAD_VERSION,
    organizationId: requireId(input.organizationId, "organizationId"),
    flightId: requireId(input.flightId, "flightId"),
  });
}

export async function enqueueFlightRefresh(boss, input, options = {}) {
  if (boss === null || typeof boss?.send !== "function") {
    throw new TypeError("boss.send must be a function");
  }
  const id = await boss.send(
    FLIGHT_REFRESH_QUEUE,
    flightRefreshPayload(input),
    options,
  );
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("queue did not accept the flight refresh job");
  }
  return id;
}

export async function executeFlightRefresh(pool, job, handler) {
  if (job === null || typeof job !== "object") {
    throw new TypeError("queued job is required");
  }
  if (typeof handler !== "function") {
    throw new TypeError("job handler must be a function");
  }
  const payload = flightRefreshPayload(job.data);
  const flight = await loadFlightForJob(pool, payload);
  if (flight === null) {
    return Object.freeze({ status: "not_found" });
  }
  const result = await handler(Object.freeze({
    jobId: job.id,
    organizationId: payload.organizationId,
    flightId: payload.flightId,
    flight,
  }));
  return Object.freeze({
    status: "processed",
    result: result ?? null,
  });
}

export async function processNextFlightRefresh(boss, pool, handler) {
  if (boss === null || typeof boss?.fetch !== "function") {
    throw new TypeError("boss.fetch must be a function");
  }
  const [job] = await boss.fetch(FLIGHT_REFRESH_QUEUE, {
    includeMetadata: true,
  });
  if (job === undefined) {
    return null;
  }

  try {
    const outcome = await executeFlightRefresh(pool, job, handler);
    await boss.complete(FLIGHT_REFRESH_QUEUE, job.id, outcome);
    return Object.freeze({ jobId: job.id, outcome });
  } catch (error) {
    await boss.fail(FLIGHT_REFRESH_QUEUE, job.id, {
      error: error instanceof Error ? error.message : "job failed",
    });
    throw error;
  }
}

export function organizationExportPayload(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("job payload must be an object");
  }
  const keys = Object.keys(input).sort();
  if (keys.length !== ORGANIZATION_EXPORT_PAYLOAD_KEYS.length
      || keys.some(
        (key, index) => key !== ORGANIZATION_EXPORT_PAYLOAD_KEYS[index],
      )) {
    throw new TypeError(
      "job payload must contain only schemaVersion, organizationId, and exportRequestId",
    );
  }
  if (input.schemaVersion !== ORGANIZATION_EXPORT_PAYLOAD_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${ORGANIZATION_EXPORT_PAYLOAD_VERSION}`,
    );
  }
  return Object.freeze({
    schemaVersion: ORGANIZATION_EXPORT_PAYLOAD_VERSION,
    organizationId: requireId(input.organizationId, "organizationId"),
    exportRequestId: requireId(input.exportRequestId, "exportRequestId"),
  });
}

export async function enqueueOrganizationExport(boss, input, options = {}) {
  if (boss === null || typeof boss?.send !== "function") {
    throw new TypeError("boss.send must be a function");
  }
  const id = await boss.send(
    ORGANIZATION_EXPORT_QUEUE,
    organizationExportPayload(input),
    options,
  );
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("queue did not accept the organization export job");
  }
  return id;
}

export async function executeOrganizationExport(pool, job, handler) {
  if (job === null || typeof job !== "object") {
    throw new TypeError("queued job is required");
  }
  if (typeof handler !== "function") {
    throw new TypeError("job handler must be a function");
  }
  const payload = organizationExportPayload(job.data);
  const exportRequest = await loadOrganizationExportForJob(pool, payload);
  if (exportRequest === null) {
    return Object.freeze({ status: "not_found" });
  }
  const result = await handler(Object.freeze({
    jobId: job.id,
    organizationId: payload.organizationId,
    exportRequestId: payload.exportRequestId,
    exportRequest,
  }));
  return Object.freeze({
    status: "processed",
    result: result ?? null,
  });
}

export async function processNextOrganizationExport(boss, pool, handler) {
  if (boss === null || typeof boss?.fetch !== "function") {
    throw new TypeError("boss.fetch must be a function");
  }
  const [job] = await boss.fetch(ORGANIZATION_EXPORT_QUEUE, {
    includeMetadata: true,
  });
  if (job === undefined) {
    return null;
  }
  try {
    const outcome = await executeOrganizationExport(pool, job, handler);
    await boss.complete(ORGANIZATION_EXPORT_QUEUE, job.id, outcome);
    return Object.freeze({ jobId: job.id, outcome });
  } catch (error) {
    await boss.fail(ORGANIZATION_EXPORT_QUEUE, job.id, {
      error: error instanceof Error ? error.message : "job failed",
    });
    throw error;
  }
}

export function organizationDeletionPayload(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("job payload must be an object");
  }
  const keys = Object.keys(input).sort();
  if (keys.length !== ORGANIZATION_DELETION_PAYLOAD_KEYS.length
      || keys.some(
        (key, index) => key !== ORGANIZATION_DELETION_PAYLOAD_KEYS[index],
      )) {
    throw new TypeError(
      "job payload must contain only schemaVersion, organizationId, and deletionRequestedAt",
    );
  }
  if (input.schemaVersion !== ORGANIZATION_DELETION_PAYLOAD_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${ORGANIZATION_DELETION_PAYLOAD_VERSION}`,
    );
  }
  const deletionRequestedAt = new Date(input.deletionRequestedAt);
  if (typeof input.deletionRequestedAt !== "string"
      || Number.isNaN(deletionRequestedAt.valueOf())
      || deletionRequestedAt.toISOString() !== input.deletionRequestedAt) {
    throw new TypeError("deletionRequestedAt must be a canonical ISO timestamp");
  }
  return Object.freeze({
    schemaVersion: ORGANIZATION_DELETION_PAYLOAD_VERSION,
    organizationId: requireId(input.organizationId, "organizationId"),
    deletionRequestedAt: input.deletionRequestedAt,
  });
}

export async function enqueueOrganizationDeletion(boss, input, options = {}) {
  if (boss === null || typeof boss?.send !== "function") {
    throw new TypeError("boss.send must be a function");
  }
  const id = await boss.send(
    ORGANIZATION_DELETION_QUEUE,
    organizationDeletionPayload(input),
    options,
  );
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("queue did not accept the organization deletion job");
  }
  return id;
}

export async function executeOrganizationDeletion(pool, job, options = {}) {
  if (job === null || typeof job !== "object") {
    throw new TypeError("queued job is required");
  }
  const payload = organizationDeletionPayload(job.data);
  const outcome = await permanentlyDeleteOrganization(pool, {
    organizationId: payload.organizationId,
    deletionRequestedAt: new Date(payload.deletionRequestedAt),
  }, {
    now: options.now,
    maximumBackupRetentionDays: options.maximumBackupRetentionDays,
  });
  if (typeof options.afterDelete === "function") {
    await options.afterDelete(outcome);
  }
  return outcome;
}

export async function processNextOrganizationDeletion(boss, pool, options = {}) {
  if (boss === null || typeof boss?.fetch !== "function") {
    throw new TypeError("boss.fetch must be a function");
  }
  const [job] = await boss.fetch(ORGANIZATION_DELETION_QUEUE, {
    includeMetadata: true,
  });
  if (job === undefined) {
    return null;
  }
  try {
    const outcome = await executeOrganizationDeletion(pool, job, options);
    await boss.complete(ORGANIZATION_DELETION_QUEUE, job.id, outcome);
    return Object.freeze({ jobId: job.id, outcome });
  } catch (error) {
    await boss.fail(ORGANIZATION_DELETION_QUEUE, job.id, {
      error: error instanceof Error ? error.message : "job failed",
    });
    throw error;
  }
}

export function flightDeletionPayload(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("job payload must be an object");
  }
  const keys = Object.keys(input).sort();
  if (keys.length !== FLIGHT_DELETION_PAYLOAD_KEYS.length
      || keys.some((key, index) => key !== FLIGHT_DELETION_PAYLOAD_KEYS[index])) {
    throw new TypeError(
      "job payload must contain only schemaVersion, organizationId, flightId, and deletedAt",
    );
  }
  if (input.schemaVersion !== FLIGHT_DELETION_PAYLOAD_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${FLIGHT_DELETION_PAYLOAD_VERSION}`,
    );
  }
  const deletedAt = new Date(input.deletedAt);
  if (typeof input.deletedAt !== "string"
      || Number.isNaN(deletedAt.valueOf())
      || deletedAt.toISOString() !== input.deletedAt) {
    throw new TypeError("deletedAt must be a canonical ISO timestamp");
  }
  return Object.freeze({
    schemaVersion: FLIGHT_DELETION_PAYLOAD_VERSION,
    organizationId: requireId(input.organizationId, "organizationId"),
    flightId: requireId(input.flightId, "flightId"),
    deletedAt: input.deletedAt,
  });
}

export async function enqueueFlightDeletion(boss, input, options = {}) {
  if (boss === null || typeof boss?.send !== "function") {
    throw new TypeError("boss.send must be a function");
  }
  const id = await boss.send(
    FLIGHT_DELETION_QUEUE,
    flightDeletionPayload(input),
    options,
  );
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("queue did not accept the flight deletion job");
  }
  return id;
}

export async function executeFlightDeletion(pool, job, options = {}) {
  if (job === null || typeof job !== "object") {
    throw new TypeError("queued job is required");
  }
  const payload = flightDeletionPayload(job.data);
  const outcome = await permanentlyDeleteFlight(pool, {
    organizationId: payload.organizationId,
    flightId: payload.flightId,
    deletedAt: new Date(payload.deletedAt),
  }, { now: options.now });
  if (typeof options.afterDelete === "function") {
    await options.afterDelete(outcome);
  }
  return outcome;
}

export async function processNextFlightDeletion(boss, pool, options = {}) {
  if (boss === null || typeof boss?.fetch !== "function") {
    throw new TypeError("boss.fetch must be a function");
  }
  const [job] = await boss.fetch(FLIGHT_DELETION_QUEUE, {
    includeMetadata: true,
  });
  if (job === undefined) {
    return null;
  }
  try {
    const outcome = await executeFlightDeletion(pool, job, options);
    await boss.complete(FLIGHT_DELETION_QUEUE, job.id, outcome);
    return Object.freeze({ jobId: job.id, outcome });
  } catch (error) {
    await boss.fail(FLIGHT_DELETION_QUEUE, job.id, {
      error: error instanceof Error ? error.message : "job failed",
    });
    throw error;
  }
}
