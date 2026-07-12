export class KeychainProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = "KeychainProviderError";
    this.code = code;
  }
}

export class DisabledKeychainProvider {
  async fetchKeychains() {
    throw new KeychainProviderError("key_service_not_authorized");
  }
}

export class MockKeychainProvider {
  #calls = [];
  #failureCode;
  #responses;

  constructor({ responses = new Map(), failureCode = null } = {}) {
    this.#responses = responses;
    this.#failureCode = failureCode;
  }

  async fetchKeychains({ sourceId, requestMetadata }) {
    this.#calls.push({
      source_id: sourceId,
      request_version: requestMetadata.request_version,
      department: requestMetadata.department,
      groups: requestMetadata.groups,
      feature_points: requestMetadata.feature_points,
      serialized_bytes: requestMetadata.serialized_bytes,
    });

    if (this.#failureCode) {
      throw new KeychainProviderError(this.#failureCode);
    }

    if (!this.#responses.has(sourceId)) {
      throw new KeychainProviderError("key_rejected");
    }

    return structuredClone(this.#responses.get(sourceId));
  }

  get sanitizedCalls() {
    return structuredClone(this.#calls);
  }
}
