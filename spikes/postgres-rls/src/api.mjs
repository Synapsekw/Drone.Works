import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  DownloadAuthorizationError,
  issueAuthorizedDownload,
} from "./downloads.mjs";
import { withOrganization } from "./repositories.mjs";

export const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 32 * 1024;

const HIDDEN_RESOURCE_PROBLEM = Object.freeze({
  type: "about:blank",
  title: "Not Found",
  status: 404,
  detail: "Resource is not available",
});

class ValidationError extends Error {
  constructor(errors) {
    super("The request is invalid");
    this.name = "ValidationError";
    this.errors = errors;
  }
}

function sendJson(response, status, body, contentType = "application/json") {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": `${contentType}; charset=utf-8`,
  });
  response.end(JSON.stringify(body));
}

function sendProblem(response, problem) {
  sendJson(response, problem.status, problem, "application/problem+json");
}

function sendEmpty(response, status) {
  response.writeHead(status, { "cache-control": "no-store" });
  response.end();
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new ValidationError([{
        field: "body",
        detail: `must not exceed ${MAX_BODY_BYTES} bytes`,
      }]);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError([{
      field: "body",
      detail: "must contain one valid JSON object",
    }]);
  }
}

function requireObject(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError([{
      field: "body",
      detail: "must be a JSON object",
    }]);
  }
  return input;
}

function validateKeys(input, allowed, required = allowed) {
  const errors = [];
  for (const field of required) {
    if (!Object.hasOwn(input, field)) {
      errors.push({ field, detail: "is required" });
    }
  }
  for (const field of Object.keys(input)) {
    if (!allowed.includes(field)) {
      errors.push({ field, detail: "is not allowed" });
    }
  }
  return errors;
}

function validIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function manualFlightInput(body) {
  const input = requireObject(body);
  const allowed = [
    "pilot_profile_id",
    "aircraft_id",
    "takeoff_at",
    "takeoff_timezone",
    "duration_ms",
    "location_text",
    "notes",
  ];
  const errors = validateKeys(input, allowed, allowed.slice(0, 6));
  for (const field of ["pilot_profile_id", "aircraft_id"]) {
    if (Object.hasOwn(input, field) && !validIdentifier(input[field])) {
      errors.push({ field, detail: "must be a non-empty opaque identifier" });
    }
  }
  const rfc3339 = typeof input.takeoff_at === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.takeoff_at);
  const takeoffAt = rfc3339 ? new Date(input.takeoff_at) : new Date(Number.NaN);
  if (!rfc3339 || Number.isNaN(takeoffAt.valueOf())) {
    errors.push({ field: "takeoff_at", detail: "must be an RFC 3339 timestamp" });
  }
  if (typeof input.takeoff_timezone !== "string" || input.takeoff_timezone.length === 0) {
    errors.push({ field: "takeoff_timezone", detail: "must be an IANA timezone" });
  } else {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.takeoff_timezone });
    } catch {
      errors.push({ field: "takeoff_timezone", detail: "must be an IANA timezone" });
    }
  }
  if (!Number.isSafeInteger(input.duration_ms) || input.duration_ms < 0) {
    errors.push({ field: "duration_ms", detail: "must be a non-negative integer" });
  }
  if (typeof input.location_text !== "string" || input.location_text.trim().length === 0) {
    errors.push({ field: "location_text", detail: "must be a non-empty string" });
  }
  const notes = input.notes ?? "";
  if (typeof notes !== "string" || notes.length > 10_000) {
    errors.push({ field: "notes", detail: "must be a string of at most 10000 characters" });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return Object.freeze({
    pilotProfileId: input.pilot_profile_id,
    aircraftId: input.aircraft_id,
    takeoffAt,
    takeoffTimezone: input.takeoff_timezone,
    durationMs: input.duration_ms,
    locationText: input.location_text,
    notes,
  });
}

function notesInput(body) {
  const input = requireObject(body);
  const errors = validateKeys(input, ["notes"]);
  if (typeof input.notes !== "string" || input.notes.length > 10_000) {
    errors.push({ field: "notes", detail: "must be a string of at most 10000 characters" });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return input.notes;
}

function assignmentInput(body) {
  const input = requireObject(body);
  const fields = ["pilot_profile_id", "aircraft_id"];
  const errors = validateKeys(input, fields);
  for (const field of fields) {
    if (!validIdentifier(input[field])) {
      errors.push({ field, detail: "must be a non-empty opaque identifier" });
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return Object.freeze({
    pilotProfileId: input.pilot_profile_id,
    aircraftId: input.aircraft_id,
  });
}

function requestHash(input) {
  return createHash("sha256").update(JSON.stringify({
    pilot_profile_id: input.pilotProfileId,
    aircraft_id: input.aircraftId,
    takeoff_at: input.takeoffAt.toISOString(),
    takeoff_timezone: input.takeoffTimezone,
    duration_ms: input.durationMs,
    location_text: input.locationText,
    notes: input.notes,
  })).digest("hex");
}

function decodeIdentifier(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.length === 0 || decoded.length > 256) {
      throw new TypeError("identifier is invalid");
    }
    return decoded;
  } catch (error) {
    if (error instanceof TypeError) {
      throw error;
    }
    throw new TypeError("identifier is invalid", { cause: error });
  }
}

function matchRoute(pathname, pattern) {
  const match = pattern.exec(pathname);
  if (match === null) {
    return null;
  }
  return match.slice(1).map(decodeIdentifier);
}

export function createApiServer({
  pool,
  authenticate,
  signer,
  now = () => new Date(),
  createId = randomUUID,
}) {
  if (pool === null || typeof pool?.connect !== "function") {
    throw new TypeError("pool.connect must be a function");
  }
  if (typeof authenticate !== "function") {
    throw new TypeError("authenticate must be a function");
  }
  if (signer === null || typeof signer?.issue !== "function") {
    throw new TypeError("signer.issue must be a function");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }
  if (typeof createId !== "function") {
    throw new TypeError("createId must be a function");
  }

  return createServer(async (request, response) => {
    try {
      const identity = await authenticate(request);
      if (identity === null
          || typeof identity !== "object"
          || typeof identity.userId !== "string"
          || identity.userId.length === 0) {
        sendProblem(response, {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "Authentication is required",
        });
        return;
      }

      const url = new URL(request.url, "http://api.invalid");
      const flightRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights\/([^/]+)$/,
        )
        : null;
      if (flightRoute !== null) {
        const [organizationId, flightId] = flightRoute;
        const flight = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.findFlightForMember({
            userId: identity.userId,
            flightId,
          }),
        );
        if (flight === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: flight });
        return;
      }

      const createFlightRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights$/,
        )
        : null;
      if (createFlightRoute !== null) {
        const [organizationId] = createFlightRoute;
        const idempotencyKey = request.headers["idempotency-key"];
        if (!validIdentifier(idempotencyKey)) {
          throw new ValidationError([{
            field: "Idempotency-Key",
            detail: "must be a non-empty opaque identifier",
          }]);
        }
        const input = manualFlightInput(await readJsonBody(request));
        const result = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.createManualFlightForMember({
            userId: identity.userId,
            idempotencyKey,
            requestHash: requestHash(input),
            createFlightId: createId,
            ...input,
            now: now(),
          }),
        );
        if (result === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        if (result.kind === "conflict") {
          sendProblem(response, {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: "The idempotency key was already used with different input",
          });
          return;
        }
        sendJson(response, 201, { data: result.flight });
        return;
      }

      const notesRoute = request.method === "PATCH"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights\/([^/]+)\/notes$/,
        )
        : null;
      if (notesRoute !== null) {
        const [organizationId, flightId] = notesRoute;
        const notes = notesInput(await readJsonBody(request));
        const flight = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.updateFlightNotesForMember({
            userId: identity.userId,
            flightId,
            notes,
            now: now(),
          }),
        );
        if (flight === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: flight });
        return;
      }

      const assignmentRoute = request.method === "PATCH"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights\/([^/]+)\/assignment$/,
        )
        : null;
      if (assignmentRoute !== null) {
        const [organizationId, flightId] = assignmentRoute;
        const assignment = assignmentInput(await readJsonBody(request));
        const flight = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.reassignFlightForMember({
            userId: identity.userId,
            flightId,
            ...assignment,
            now: now(),
          }),
        );
        if (flight === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: flight });
        return;
      }

      const deleteRoute = request.method === "DELETE"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights\/([^/]+)$/,
        )
        : null;
      if (deleteRoute !== null) {
        const [organizationId, flightId] = deleteRoute;
        const flight = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.deleteFlightForMember({
            userId: identity.userId,
            flightId,
            now: now(),
          }),
        );
        if (flight === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendEmpty(response, 204);
        return;
      }

      const restoreRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights\/([^/]+)\/restore$/,
        )
        : null;
      if (restoreRoute !== null) {
        const [organizationId, flightId] = restoreRoute;
        const flight = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.restoreFlightForMember({
            userId: identity.userId,
            flightId,
            now: now(),
          }),
        );
        if (flight === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: flight });
        return;
      }

      const rawDownloadRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/raw-sources\/([^/]+)\/downloads$/,
        )
        : null;
      const exportDownloadRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/exports\/([^/]+)\/downloads$/,
        )
        : null;
      const downloadRoute = rawDownloadRoute ?? exportDownloadRoute;
      if (downloadRoute !== null) {
        const [organizationId, resourceId] = downloadRoute;
        const download = await issueAuthorizedDownload(pool, {
          organizationId,
          userId: identity.userId,
          resourceType: rawDownloadRoute === null ? "export" : "raw_source",
          resourceId,
        }, signer, { now: now() });
        sendJson(response, 200, {
          data: {
            url: download.url,
            expires_at: download.expiresAt,
          },
        });
        return;
      }

      sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
    } catch (error) {
      if (error instanceof DownloadAuthorizationError) {
        sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
        return;
      }
      if (error instanceof ValidationError) {
        sendProblem(response, {
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "The request is invalid",
          errors: error.errors,
        });
        return;
      }
      if (error instanceof TypeError || error instanceof URIError) {
        sendProblem(response, {
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "The request is invalid",
        });
        return;
      }
      sendProblem(response, {
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "The request could not be completed",
      });
    }
  });
}
