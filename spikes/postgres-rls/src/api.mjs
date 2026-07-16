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

function memberRoleInput(body) {
  const input = requireObject(body);
  const errors = validateKeys(input, ["role"]);
  if (!["admin", "pilot", "viewer"].includes(input.role)) {
    errors.push({ field: "role", detail: "must be admin, pilot, or viewer" });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return input.role;
}

function organizationSettingsInput(body) {
  const input = requireObject(body);
  const fields = [
    "name",
    "default_timezone",
    "unit_preference",
    "pilot_raw_download_enabled",
    "pilot_export_enabled",
  ];
  const errors = validateKeys(input, fields, []);
  if (Object.keys(input).length === 0) {
    errors.push({ field: "body", detail: "must include at least one setting" });
  }
  if (Object.hasOwn(input, "name")
      && (typeof input.name !== "string"
        || input.name.trim().length === 0
        || input.name.length > 200)) {
    errors.push({ field: "name", detail: "must be a non-empty string of at most 200 characters" });
  }
  if (Object.hasOwn(input, "default_timezone")) {
    if (typeof input.default_timezone !== "string"
        || input.default_timezone.length === 0) {
      errors.push({ field: "default_timezone", detail: "must be an IANA timezone" });
    } else {
      try {
        new Intl.DateTimeFormat("en", { timeZone: input.default_timezone });
      } catch {
        errors.push({ field: "default_timezone", detail: "must be an IANA timezone" });
      }
    }
  }
  if (Object.hasOwn(input, "unit_preference")
      && !["metric", "imperial"].includes(input.unit_preference)) {
    errors.push({ field: "unit_preference", detail: "must be metric or imperial" });
  }
  for (const field of [
    "pilot_raw_download_enabled",
    "pilot_export_enabled",
  ]) {
    if (Object.hasOwn(input, field) && typeof input[field] !== "boolean") {
      errors.push({ field, detail: "must be a boolean" });
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  const settings = {};
  if (Object.hasOwn(input, "name")) {
    settings.name = input.name.trim();
  }
  if (Object.hasOwn(input, "default_timezone")) {
    settings.defaultTimezone = input.default_timezone;
  }
  if (Object.hasOwn(input, "unit_preference")) {
    settings.unitPreference = input.unit_preference;
  }
  if (Object.hasOwn(input, "pilot_raw_download_enabled")) {
    settings.pilotRawDownloadEnabled = input.pilot_raw_download_enabled;
  }
  if (Object.hasOwn(input, "pilot_export_enabled")) {
    settings.pilotExportEnabled = input.pilot_export_enabled;
  }
  return Object.freeze(settings);
}

function ownershipTransferInput(body) {
  const input = requireObject(body);
  const errors = validateKeys(input, ["new_owner_user_id"]);
  if (!validIdentifier(input.new_owner_user_id)) {
    errors.push({
      field: "new_owner_user_id",
      detail: "must be a non-empty opaque identifier",
    });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return input.new_owner_user_id;
}

function batteryInput(body) {
  const input = requireObject(body);
  const fields = ["display_name", "serial_number", "lifecycle"];
  const errors = validateKeys(input, fields, []);
  if (Object.keys(input).length === 0) {
    errors.push({ field: "body", detail: "must include at least one battery field" });
  }
  if (Object.hasOwn(input, "display_name")
      && (typeof input.display_name !== "string"
        || input.display_name.trim().length === 0
        || input.display_name.length > 200)) {
    errors.push({
      field: "display_name",
      detail: "must be a non-empty string of at most 200 characters",
    });
  }
  if (Object.hasOwn(input, "serial_number")
      && input.serial_number !== null
      && (typeof input.serial_number !== "string"
        || input.serial_number.trim().length === 0
        || input.serial_number.length > 200)) {
    errors.push({
      field: "serial_number",
      detail: "must be null or a non-empty string of at most 200 characters",
    });
  }
  if (Object.hasOwn(input, "lifecycle")
      && !["active", "retired"].includes(input.lifecycle)) {
    errors.push({ field: "lifecycle", detail: "must be active or retired" });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  const battery = {};
  if (Object.hasOwn(input, "display_name")) {
    battery.displayName = input.display_name.trim();
  }
  if (Object.hasOwn(input, "serial_number")) {
    battery.serialNumber = input.serial_number === null
      ? null
      : input.serial_number.trim();
  }
  if (Object.hasOwn(input, "lifecycle")) {
    battery.lifecycle = input.lifecycle;
  }
  return Object.freeze(battery);
}

function importBatchInput(body) {
  const input = requireObject(body);
  const errors = validateKeys(input, ["files"]);
  if (!Array.isArray(input.files)
      || input.files.length === 0
      || input.files.length > 50) {
    errors.push({ field: "files", detail: "must contain between 1 and 50 files" });
  }
  const files = [];
  const clientFileIds = new Set();
  if (Array.isArray(input.files)) {
    input.files.forEach((file, index) => {
      if (file === null || typeof file !== "object" || Array.isArray(file)) {
        errors.push({ field: `files[${index}]`, detail: "must be an object" });
        return;
      }
      for (const field of ["client_file_id", "original_filename"]) {
        if (!Object.hasOwn(file, field)) {
          errors.push({ field: `files[${index}].${field}`, detail: "is required" });
        }
      }
      for (const field of Object.keys(file)) {
        if (!["client_file_id", "original_filename"].includes(field)) {
          errors.push({ field: `files[${index}].${field}`, detail: "is not allowed" });
        }
      }
      if (!validIdentifier(file.client_file_id)) {
        errors.push({
          field: `files[${index}].client_file_id`,
          detail: "must be a non-empty opaque identifier",
        });
      } else if (clientFileIds.has(file.client_file_id)) {
        errors.push({
          field: `files[${index}].client_file_id`,
          detail: "must be unique within the batch",
        });
      } else {
        clientFileIds.add(file.client_file_id);
      }
      if (typeof file.original_filename !== "string"
          || file.original_filename.trim().length === 0
          || file.original_filename.length > 255) {
        errors.push({
          field: `files[${index}].original_filename`,
          detail: "must be a non-empty string of at most 255 characters",
        });
      }
      files.push({
        clientFileId: file.client_file_id,
        originalFilename: typeof file.original_filename === "string"
          ? file.original_filename.trim()
          : file.original_filename,
      });
    });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

function emptyObjectInput(body) {
  const input = requireObject(body);
  const errors = validateKeys(input, [], []);
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return input;
}

function rfc3339Date(value, field, errors) {
  const validShape = typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const parsed = validShape ? new Date(value) : new Date(Number.NaN);
  if (!validShape || Number.isNaN(parsed.valueOf())) {
    errors.push({ field, detail: "must be an RFC 3339 timestamp" });
  }
  return parsed;
}

function maintenanceScheduleInput(body) {
  const input = requireObject(body);
  const allowed = [
    "aircraft_id",
    "title",
    "schedule_type",
    "interval_value",
    "due_at",
    "baseline_at",
    "due_soon_threshold_percent",
    "due_soon_days",
  ];
  const errors = validateKeys(input, allowed, [
    "aircraft_id",
    "title",
    "schedule_type",
    "baseline_at",
  ]);
  if (!validIdentifier(input.aircraft_id)) {
    errors.push({
      field: "aircraft_id",
      detail: "must be a non-empty opaque identifier",
    });
  }
  if (typeof input.title !== "string"
      || input.title.trim().length === 0
      || input.title.length > 200) {
    errors.push({
      field: "title",
      detail: "must be a non-empty string of at most 200 characters",
    });
  }
  const usageSchedule = ["flight_hours", "flight_count"].includes(
    input.schedule_type,
  );
  const dateSchedule = input.schedule_type === "one_shot_date";
  if (!usageSchedule && !dateSchedule) {
    errors.push({
      field: "schedule_type",
      detail: "must be flight_hours, flight_count, or one_shot_date",
    });
  }
  const baselineAt = rfc3339Date(input.baseline_at, "baseline_at", errors);
  let intervalValue = null;
  let dueAt = null;
  let dueSoonThresholdPercent = null;
  let dueSoonDays = null;
  if (usageSchedule) {
    if (!Number.isSafeInteger(input.interval_value) || input.interval_value <= 0) {
      errors.push({ field: "interval_value", detail: "must be a positive integer" });
    } else {
      intervalValue = input.interval_value;
    }
    if (Object.hasOwn(input, "due_at")) {
      errors.push({ field: "due_at", detail: "is allowed only for one_shot_date" });
    }
    if (Object.hasOwn(input, "due_soon_days")) {
      errors.push({
        field: "due_soon_days",
        detail: "is allowed only for one_shot_date",
      });
    }
    dueSoonThresholdPercent = input.due_soon_threshold_percent ?? 80;
    if (!Number.isSafeInteger(dueSoonThresholdPercent)
        || dueSoonThresholdPercent < 1
        || dueSoonThresholdPercent > 99) {
      errors.push({
        field: "due_soon_threshold_percent",
        detail: "must be an integer from 1 through 99",
      });
    }
  }
  if (dateSchedule) {
    dueAt = rfc3339Date(input.due_at, "due_at", errors);
    if (Object.hasOwn(input, "interval_value")) {
      errors.push({
        field: "interval_value",
        detail: "is not allowed for one_shot_date",
      });
    }
    if (Object.hasOwn(input, "due_soon_threshold_percent")) {
      errors.push({
        field: "due_soon_threshold_percent",
        detail: "is not allowed for one_shot_date",
      });
    }
    dueSoonDays = input.due_soon_days ?? 30;
    if (!Number.isSafeInteger(dueSoonDays) || dueSoonDays <= 0) {
      errors.push({ field: "due_soon_days", detail: "must be a positive integer" });
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return Object.freeze({
    aircraftId: input.aircraft_id,
    title: input.title.trim(),
    scheduleType: input.schedule_type,
    intervalValue,
    dueAt,
    baselineAt,
    dueSoonThresholdPercent,
    dueSoonDays,
  });
}

function maintenanceCompletionInput(body) {
  const input = requireObject(body);
  const errors = validateKeys(input, ["completed_at", "details"]);
  const completedAt = rfc3339Date(input.completed_at, "completed_at", errors);
  if (typeof input.details !== "string"
      || input.details.trim().length === 0
      || input.details.length > 2_000) {
    errors.push({
      field: "details",
      detail: "must be a non-empty string of at most 2000 characters",
    });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return Object.freeze({
    completedAt,
    details: input.details.trim(),
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

function importBatchRequestHash(files) {
  return createHash("sha256").update(JSON.stringify(files.map((file) => ({
    client_file_id: file.clientFileId,
    original_filename: file.originalFilename,
  })))).digest("hex");
}

function organizationExportRequestHash() {
  return createHash("sha256")
    .update("complete-organization-export:v1")
    .digest("hex");
}

function maintenanceScheduleRequestHash(input) {
  return createHash("sha256").update(JSON.stringify({
    aircraft_id: input.aircraftId,
    title: input.title,
    schedule_type: input.scheduleType,
    interval_value: input.intervalValue,
    due_at: input.dueAt?.toISOString() ?? null,
    baseline_at: input.baselineAt.toISOString(),
    due_soon_threshold_percent: input.dueSoonThresholdPercent,
    due_soon_days: input.dueSoonDays,
  })).digest("hex");
}

function maintenanceCompletionRequestHash(input) {
  return createHash("sha256").update(JSON.stringify({
    completed_at: input.completedAt.toISOString(),
    details: input.details,
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
            createFlightId: () => createId("flight-manual"),
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

      const tagsRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/tags$/,
        )
        : null;
      if (tagsRoute !== null) {
        const [organizationId] = tagsRoute;
        const tags = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.listTagsForMember(identity.userId),
        );
        if (tags === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: tags });
        return;
      }

      const flightTagRoute = ["PUT", "DELETE"].includes(request.method)
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights\/([^/]+)\/tags\/([^/]+)$/,
        )
        : null;
      if (flightTagRoute !== null) {
        const [organizationId, flightId, tagId] = flightTagRoute;
        const link = await withOrganization(
          pool,
          organizationId,
          (repositories) => (request.method === "PUT"
            ? repositories.putFlightTagForMember({
              userId: identity.userId,
              flightId,
              tagId,
              now: now(),
            })
            : repositories.deleteFlightTagForMember({
              userId: identity.userId,
              flightId,
              tagId,
              now: now(),
            })),
        );
        if (link === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        if (request.method === "DELETE") {
          sendEmpty(response, 204);
        } else {
          sendJson(response, 200, { data: link });
        }
        return;
      }

      const batteriesRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/batteries$/,
        )
        : null;
      if (batteriesRoute !== null) {
        const [organizationId] = batteriesRoute;
        const batteries = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.listBatteriesForMember(identity.userId),
        );
        if (batteries === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: batteries });
        return;
      }

      const batteryRoute = request.method === "PATCH"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/batteries\/([^/]+)$/,
        )
        : null;
      if (batteryRoute !== null) {
        const [organizationId, batteryId] = batteryRoute;
        const input = batteryInput(await readJsonBody(request));
        const battery = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.updateBatteryForManager({
            userId: identity.userId,
            batteryId,
            battery: input,
            now: now(),
          }),
        );
        if (battery === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: battery });
        return;
      }

      const flightBatteryRoute = ["PUT", "DELETE"].includes(request.method)
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/flights\/([^/]+)\/batteries\/([^/]+)$/,
        )
        : null;
      if (flightBatteryRoute !== null) {
        const [organizationId, flightId, batteryId] = flightBatteryRoute;
        const link = await withOrganization(
          pool,
          organizationId,
          (repositories) => (request.method === "PUT"
            ? repositories.putFlightBatteryForManager({
              userId: identity.userId,
              flightId,
              batteryId,
              now: now(),
            })
            : repositories.deleteFlightBatteryForManager({
              userId: identity.userId,
              flightId,
              batteryId,
              now: now(),
            })),
        );
        if (link === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        if (request.method === "DELETE") {
          sendEmpty(response, 204);
        } else {
          sendJson(response, 200, { data: link });
        }
        return;
      }

      const createImportBatchRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/import-batches$/,
        )
        : null;
      if (createImportBatchRoute !== null) {
        const [organizationId] = createImportBatchRoute;
        const idempotencyKey = request.headers["idempotency-key"];
        if (!validIdentifier(idempotencyKey)) {
          throw new ValidationError([{
            field: "Idempotency-Key",
            detail: "must be a non-empty opaque identifier",
          }]);
        }
        const files = importBatchInput(await readJsonBody(request));
        const result = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.createImportBatchForMember({
            userId: identity.userId,
            idempotencyKey,
            requestHash: importBatchRequestHash(files),
            files,
            createId,
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
        sendJson(response, 201, { data: result.batch });
        return;
      }

      const importBatchRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/import-batches\/([^/]+)$/,
        )
        : null;
      if (importBatchRoute !== null) {
        const [organizationId, batchId] = importBatchRoute;
        const batch = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.findImportBatchForMember({
            userId: identity.userId,
            batchId,
          }),
        );
        if (batch === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: batch });
        return;
      }

      const createOrganizationExportRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/organization-exports$/,
        )
        : null;
      if (createOrganizationExportRoute !== null) {
        const [organizationId] = createOrganizationExportRoute;
        const idempotencyKey = request.headers["idempotency-key"];
        if (!validIdentifier(idempotencyKey)) {
          throw new ValidationError([{
            field: "Idempotency-Key",
            detail: "must be a non-empty opaque identifier",
          }]);
        }
        emptyObjectInput(await readJsonBody(request));
        const result = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.createOrganizationExportForManager({
            userId: identity.userId,
            idempotencyKey,
            requestHash: organizationExportRequestHash(),
            createId,
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
        sendJson(response, 202, { data: result.exportRequest });
        return;
      }

      const organizationExportRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/organization-exports\/([^/]+)$/,
        )
        : null;
      if (organizationExportRoute !== null) {
        const [organizationId, exportRequestId] = organizationExportRoute;
        const exportRequest = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.findOrganizationExportForManager({
            userId: identity.userId,
            exportRequestId,
          }),
        );
        if (exportRequest === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: exportRequest });
        return;
      }

      const createMaintenanceScheduleRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/maintenance-schedules$/,
        )
        : null;
      if (createMaintenanceScheduleRoute !== null) {
        const [organizationId] = createMaintenanceScheduleRoute;
        const idempotencyKey = request.headers["idempotency-key"];
        if (!validIdentifier(idempotencyKey)) {
          throw new ValidationError([{
            field: "Idempotency-Key",
            detail: "must be a non-empty opaque identifier",
          }]);
        }
        const input = maintenanceScheduleInput(await readJsonBody(request));
        const result = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.createMaintenanceScheduleForManager({
            userId: identity.userId,
            idempotencyKey,
            requestHash: maintenanceScheduleRequestHash(input),
            createId,
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
        sendJson(response, 201, { data: result.schedule });
        return;
      }

      const maintenanceSchedulesRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/maintenance-schedules$/,
        )
        : null;
      if (maintenanceSchedulesRoute !== null) {
        const [organizationId] = maintenanceSchedulesRoute;
        const schedules = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.listMaintenanceSchedulesForMember({
            userId: identity.userId,
            now: now(),
          }),
        );
        if (schedules === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: schedules });
        return;
      }

      const maintenanceScheduleRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/maintenance-schedules\/([^/]+)$/,
        )
        : null;
      if (maintenanceScheduleRoute !== null) {
        const [organizationId, scheduleId] = maintenanceScheduleRoute;
        const schedule = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.findMaintenanceScheduleForMember({
            userId: identity.userId,
            scheduleId,
            now: now(),
          }),
        );
        if (schedule === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: schedule });
        return;
      }

      const maintenanceCompletionRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/maintenance-schedules\/([^/]+)\/completions$/,
        )
        : null;
      if (maintenanceCompletionRoute !== null) {
        const [organizationId, scheduleId] = maintenanceCompletionRoute;
        const idempotencyKey = request.headers["idempotency-key"];
        if (!validIdentifier(idempotencyKey)) {
          throw new ValidationError([{
            field: "Idempotency-Key",
            detail: "must be a non-empty opaque identifier",
          }]);
        }
        const input = maintenanceCompletionInput(await readJsonBody(request));
        const result = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.completeMaintenanceScheduleForManager({
            userId: identity.userId,
            scheduleId,
            idempotencyKey,
            requestHash: maintenanceCompletionRequestHash(input),
            createId,
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
        sendJson(response, 201, { data: result.result });
        return;
      }

      const membersRoute = request.method === "GET"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/members$/,
        )
        : null;
      if (membersRoute !== null) {
        const [organizationId] = membersRoute;
        const members = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.listMembersForManager(identity.userId),
        );
        if (members === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: members });
        return;
      }

      const putMemberRoute = request.method === "PUT"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/members\/([^/]+)$/,
        )
        : null;
      if (putMemberRoute !== null) {
        const [organizationId, targetUserId] = putMemberRoute;
        const role = memberRoleInput(await readJsonBody(request));
        const result = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.putMemberForManager({
            userId: identity.userId,
            targetUserId,
            role,
            now: now(),
          }),
        );
        if (result === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, result.kind === "created" ? 201 : 200, {
          data: result.member,
        });
        return;
      }

      const deleteMemberRoute = request.method === "DELETE"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/members\/([^/]+)$/,
        )
        : null;
      if (deleteMemberRoute !== null) {
        const [organizationId, targetUserId] = deleteMemberRoute;
        const member = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.deleteMemberForManager({
            userId: identity.userId,
            targetUserId,
            now: now(),
          }),
        );
        if (member === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendEmpty(response, 204);
        return;
      }

      const settingsRoute = request.method === "PATCH"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/settings$/,
        )
        : null;
      if (settingsRoute !== null) {
        const [organizationId] = settingsRoute;
        const settings = organizationSettingsInput(await readJsonBody(request));
        const organization = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.updateOrganizationSettingsForManager({
            userId: identity.userId,
            settings,
            now: now(),
          }),
        );
        if (organization === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: organization });
        return;
      }

      const ownershipTransferRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/ownership-transfers$/,
        )
        : null;
      if (ownershipTransferRoute !== null) {
        const [organizationId] = ownershipTransferRoute;
        const newOwnerUserId = ownershipTransferInput(await readJsonBody(request));
        const transfer = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.transferOrganizationOwnership({
            userId: identity.userId,
            newOwnerUserId,
            now: now(),
          }),
        );
        if (transfer === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: transfer });
        return;
      }

      const requestDeletionRoute = request.method === "POST"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/deletion-request$/,
        )
        : null;
      if (requestDeletionRoute !== null) {
        const [organizationId] = requestDeletionRoute;
        const organization = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.requestOrganizationDeletionForOwner({
            userId: identity.userId,
            now: now(),
          }),
        );
        if (organization === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 202, { data: organization });
        return;
      }

      const cancelDeletionRoute = request.method === "DELETE"
        ? matchRoute(
          url.pathname,
          /^\/api\/v1\/organizations\/([^/]+)\/deletion-request$/,
        )
        : null;
      if (cancelDeletionRoute !== null) {
        const [organizationId] = cancelDeletionRoute;
        const organization = await withOrganization(
          pool,
          organizationId,
          (repositories) => repositories.cancelOrganizationDeletionForOwner({
            userId: identity.userId,
            now: now(),
          }),
        );
        if (organization === null) {
          sendProblem(response, HIDDEN_RESOURCE_PROBLEM);
          return;
        }
        sendJson(response, 200, { data: organization });
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
