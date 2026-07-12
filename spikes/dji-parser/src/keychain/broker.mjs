import { KeychainProviderError } from "./providers.mjs";
import { validateKeychainRequest, validateKeychainResponse } from "./validation.mjs";

const PUBLIC_STATUSES = new Set([
  "not_required",
  "keychain_use_not_authorized",
  "cache_hit",
  "fetched",
  "key_service_not_authorized",
  "key_service_unavailable",
  "key_service_rate_limited",
  "key_rejected",
  "invalid_keychain_request",
  "invalid_keychain_response",
]);

class KeychainResolution {
  #keychains;

  constructor(result, keychains = null) {
    this.result = Object.freeze({ ...result });
    this.#keychains = keychains ? structuredClone(keychains) : null;
  }

  keychainsForParser() {
    return this.#keychains ? structuredClone(this.#keychains) : null;
  }

  toJSON() {
    return this.result;
  }
}

function resolution(status, options = {}, keychains = null) {
  if (!PUBLIC_STATUSES.has(status)) {
    throw new Error(`Unknown keychain resolution status: ${status}`);
  }

  return new KeychainResolution({
    schema_version: 1,
    status,
    failure_code: options.failureCode ?? null,
    cache_hit: options.cacheHit ?? false,
    provider_called: options.providerCalled ?? false,
    request: options.requestMetadata ?? null,
    response: options.responseMetadata ?? null,
    has_keychains: Boolean(keychains),
  }, keychains);
}

function validIdentity(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function validateBrokerInput(input) {
  if (!validIdentity(input.organizationId)
    || !validIdentity(input.sourceId)
    || !validIdentity(input.parserId)
    || !Number.isSafeInteger(input.logVersion)
    || input.logVersion < 0) {
    throw new TypeError("Invalid keychain broker identity or log version");
  }
}

export class KeychainBroker {
  #cache;
  #provider;

  constructor({ cache, provider }) {
    if (!cache || !provider) {
      throw new TypeError("Keychain broker requires cache and provider implementations");
    }
    this.#cache = cache;
    this.#provider = provider;
  }

  async resolve(input) {
    validateBrokerInput(input);

    if (input.logVersion < 13) {
      return resolution("not_required");
    }

    if (input.keychainUseAuthorized !== true) {
      return resolution("keychain_use_not_authorized", {
        failureCode: "keychain_use_not_authorized",
      });
    }

    const cacheContext = {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      parserId: input.parserId,
      logVersion: input.logVersion,
    };
    const cached = await this.#cache.get(cacheContext);
    if (cached) {
      const validated = validateKeychainResponse(cached);
      if (validated.valid) {
        return resolution("cache_hit", {
          cacheHit: true,
          responseMetadata: validated.metadata,
        }, cached);
      }
      await this.#cache.deleteSource(input.organizationId, input.sourceId);
    }

    if (input.externalServiceProcessingAuthorized !== true) {
      return resolution("key_service_not_authorized", {
        failureCode: "key_service_not_authorized",
      });
    }

    if (typeof input.requestFactory !== "function") {
      return resolution("invalid_keychain_request", {
        failureCode: "invalid_keychain_request",
      });
    }

    const request = await input.requestFactory();
    const requestValidation = validateKeychainRequest(request);
    if (!requestValidation.valid) {
      return resolution("invalid_keychain_request", {
        failureCode: requestValidation.code,
      });
    }

    let keychains;
    try {
      keychains = await this.#provider.fetchKeychains({
        sourceId: input.sourceId,
        request,
        requestMetadata: requestValidation.metadata,
      });
    } catch (error) {
      const code = error instanceof KeychainProviderError
        ? error.code
        : "key_service_unavailable";
      const status = PUBLIC_STATUSES.has(code) ? code : "key_service_unavailable";
      return resolution(status, {
        failureCode: status,
        providerCalled: true,
        requestMetadata: requestValidation.metadata,
      });
    }

    const responseValidation = validateKeychainResponse(keychains);
    if (!responseValidation.valid) {
      return resolution("invalid_keychain_response", {
        failureCode: responseValidation.code,
        providerCalled: true,
        requestMetadata: requestValidation.metadata,
      });
    }

    await this.#cache.put(cacheContext, keychains);
    return resolution("fetched", {
      providerCalled: true,
      requestMetadata: requestValidation.metadata,
      responseMetadata: responseValidation.metadata,
    }, keychains);
  }

  async revokeSource(organizationId, sourceId) {
    return this.#cache.deleteSource(organizationId, sourceId);
  }

  async deleteOrganization(organizationId) {
    return this.#cache.deleteOrganization(organizationId);
  }
}
