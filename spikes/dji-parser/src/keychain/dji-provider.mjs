import { KeychainProviderError } from "./providers.mjs";
import { validateKeychainRequest } from "./validation.mjs";

export const DJI_KEYCHAIN_ENDPOINT = "https://dev.dji.com/openapi/v1/flight-records/keychains";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

function providerError(code) {
  return new KeychainProviderError(code);
}

function normalizedEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid keychain provider endpoint");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Keychain provider endpoint cannot contain credentials, query, or fragment");
  }

  return url;
}

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

function validateConfiguration({
  endpoint,
  allowedEndpoints,
  allowInsecureLoopback,
  externalNetworkAuthorized,
  credentialProvider,
  fetchImplementation,
  timeoutMs,
  maxResponseBytes,
}) {
  const url = normalizedEndpoint(endpoint);
  const allowed = new Set(allowedEndpoints.map((value) => normalizedEndpoint(value).href));

  if (!allowed.has(url.href)) {
    throw new TypeError("Keychain provider endpoint is not allowlisted");
  }

  const secure = url.protocol === "https:";
  const testLoopback = allowInsecureLoopback === true
    && url.protocol === "http:"
    && isLoopback(url.hostname);
  if (!secure && !testLoopback) {
    throw new TypeError("Keychain provider endpoint must use HTTPS");
  }
  if (secure && externalNetworkAuthorized !== true) {
    throw new TypeError("External keychain provider network access is not authorized");
  }

  if (typeof credentialProvider !== "function" || typeof fetchImplementation !== "function") {
    throw new TypeError("Keychain provider requires credential and fetch implementations");
  }

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("Invalid keychain provider timeout");
  }

  if (!Number.isSafeInteger(maxResponseBytes)
    || maxResponseBytes < 1
    || maxResponseBytes > 4 * 1024 * 1024) {
    throw new TypeError("Invalid keychain provider response limit");
  }

  return url.href;
}

async function readBoundedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw providerError("invalid_keychain_response");
  }

  if (!response.body) {
    throw providerError("invalid_keychain_response");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw providerError("invalid_keychain_response");
      }
      chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
  }
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403 || (status >= 400 && status < 500 && status !== 429)) {
    return "key_rejected";
  }
  if (status === 429) {
    return "key_service_rate_limited";
  }
  return "key_service_unavailable";
}

export class DjiKeychainProvider {
  #credentialProvider;
  #endpoint;
  #fetch;
  #maxResponseBytes;
  #timeoutMs;

  constructor({
    credentialProvider,
    endpoint = DJI_KEYCHAIN_ENDPOINT,
    allowedEndpoints = [DJI_KEYCHAIN_ENDPOINT],
    allowInsecureLoopback = false,
    externalNetworkAuthorized = false,
    fetchImplementation = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  }) {
    this.#endpoint = validateConfiguration({
      endpoint,
      allowedEndpoints,
      allowInsecureLoopback,
      externalNetworkAuthorized,
      credentialProvider,
      fetchImplementation,
      timeoutMs,
      maxResponseBytes,
    });
    this.#credentialProvider = credentialProvider;
    this.#fetch = fetchImplementation;
    this.#timeoutMs = timeoutMs;
    this.#maxResponseBytes = maxResponseBytes;
  }

  async fetchKeychains({ request }) {
    const requestValidation = validateKeychainRequest(request);
    if (!requestValidation.valid) {
      throw providerError(requestValidation.code);
    }

    let credential;
    try {
      credential = await this.#credentialProvider();
    } catch {
      throw providerError("key_service_unavailable");
    }
    if (typeof credential !== "string"
      || credential.length < 1
      || credential.length > 4_096
      || /[\r\n]/.test(credential)) {
      throw providerError("key_rejected");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    timer.unref();

    let response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Api-Key": credential,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      throw providerError("key_service_unavailable");
    }

    try {
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        throw providerError(classifyHttpStatus(response.status));
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        await response.body?.cancel();
        throw providerError("invalid_keychain_response");
      }

      const body = await readBoundedBody(response, this.#maxResponseBytes);
      let envelope;
      try {
        envelope = JSON.parse(body);
      } catch {
        throw providerError("invalid_keychain_response");
      }

      if (!envelope || typeof envelope !== "object" || !("data" in envelope)) {
        throw providerError("invalid_keychain_response");
      }

      return envelope.data;
    } catch (error) {
      if (error instanceof KeychainProviderError) {
        throw error;
      }
      throw providerError("key_service_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
