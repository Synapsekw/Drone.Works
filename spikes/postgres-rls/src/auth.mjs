function bearerToken(request) {
  const authorization = request?.headers?.authorization;
  if (typeof authorization !== "string") {
    return null;
  }
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match?.[1] ?? null;
}

function validInstant(value) {
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : instant;
}

/**
 * Convert an authentication provider session into the deliberately small
 * identity accepted by the application API. Organization and role claims are
 * intentionally discarded: database membership and RLS are authoritative.
 */
export function createSessionIdentityAdapter({ getSession, now = () => new Date() }) {
  if (typeof getSession !== "function") {
    throw new TypeError("getSession must be a function");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  return async function authenticate(request) {
    const token = bearerToken(request);
    if (token === null) {
      return null;
    }
    const session = await getSession(token);
    if (session === null || typeof session !== "object") {
      return null;
    }
    const expiresAt = validInstant(session.expiresAt);
    if (typeof session.sessionId !== "string"
        || session.sessionId.length === 0
        || typeof session.userId !== "string"
        || session.userId.length === 0
        || session.emailVerified !== true
        || session.revokedAt !== null
        || expiresAt === null
        || expiresAt <= now()) {
      return null;
    }
    return Object.freeze({
      sessionId: session.sessionId,
      userId: session.userId,
    });
  };
}
