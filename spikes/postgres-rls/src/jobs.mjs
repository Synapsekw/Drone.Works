import { loadFlightForJob } from "./repositories.mjs";

export const FLIGHT_REFRESH_QUEUE = "canonical-flight-refresh-v1";
export const FLIGHT_REFRESH_PAYLOAD_VERSION = 1;

const PAYLOAD_KEYS = Object.freeze([
  "flightId",
  "organizationId",
  "schemaVersion",
]);

function requireId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${field} must be a non-empty identifier`);
  }
  return value;
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
