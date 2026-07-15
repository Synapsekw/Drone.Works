import { createServer } from "node:http";
import {
  DownloadAuthorizationError,
  issueAuthorizedDownload,
} from "./downloads.mjs";
import { withOrganization } from "./repositories.mjs";

export const API_PREFIX = "/api/v1";

const HIDDEN_RESOURCE_PROBLEM = Object.freeze({
  type: "about:blank",
  title: "Not Found",
  status: 404,
  detail: "Resource is not available",
});

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

export function createApiServer({ pool, authenticate, signer, now = () => new Date() }) {
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
