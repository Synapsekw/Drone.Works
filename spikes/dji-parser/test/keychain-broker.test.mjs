import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { KeychainBroker } from "../src/keychain/broker.mjs";
import { EncryptedMemoryKeychainCache } from "../src/keychain/cache.mjs";
import {
  DisabledKeychainProvider,
  MockKeychainProvider,
} from "../src/keychain/providers.mjs";

const mockRequest = {
  version: 4,
  department: 7,
  keychainsArray: [[{
    featurePoint: "BaseFeature",
    aesCiphertext: Buffer.from("synthetic-ciphertext").toString("base64"),
  }]],
};

const mockKeychains = [[{
  featurePoint: "BaseFeature",
  aesKey: randomBytes(32).toString("base64"),
  aesIv: randomBytes(16).toString("base64"),
}]];

function setup(provider = new DisabledKeychainProvider()) {
  const cache = new EncryptedMemoryKeychainCache(randomBytes(32));
  const broker = new KeychainBroker({ cache, provider });
  return { broker, cache, provider };
}

function input(overrides = {}) {
  return {
    organizationId: "org-test",
    sourceId: "source-test",
    parserId: "dji-log-parser-js@0.5.7",
    logVersion: 14,
    keychainUseAuthorized: true,
    externalServiceProcessingAuthorized: false,
    requestFactory: async () => structuredClone(mockRequest),
    ...overrides,
  };
}

test("does not need a provider for pre-v13 logs", async () => {
  const { broker } = setup();
  let requestCalls = 0;
  const result = await broker.resolve(input({
    logVersion: 12,
    requestFactory: async () => {
      requestCalls += 1;
      return mockRequest;
    },
  }));

  assert.equal(result.result.status, "not_required");
  assert.equal(requestCalls, 0);
  assert.equal(result.keychainsForParser(), null);
});

test("separately gates authorization to use keychains", async () => {
  const { broker } = setup();
  let requestCalls = 0;
  const result = await broker.resolve(input({
    keychainUseAuthorized: false,
    externalServiceProcessingAuthorized: true,
    requestFactory: async () => {
      requestCalls += 1;
      return mockRequest;
    },
  }));

  assert.equal(result.result.status, "keychain_use_not_authorized");
  assert.equal(requestCalls, 0);
});

test("does not build or transmit a request without external authorization", async () => {
  const provider = new MockKeychainProvider({
    responses: new Map([["source-test", mockKeychains]]),
  });
  const { broker } = setup(provider);
  let requestCalls = 0;
  const result = await broker.resolve(input({
    requestFactory: async () => {
      requestCalls += 1;
      return mockRequest;
    },
  }));

  assert.equal(result.result.status, "key_service_not_authorized");
  assert.equal(result.result.provider_called, false);
  assert.equal(requestCalls, 0);
  assert.equal(provider.sanitizedCalls.length, 0);
});

test("fetches, validates, encrypts, and returns keychains with both authorizations", async () => {
  const provider = new MockKeychainProvider({
    responses: new Map([["source-test", mockKeychains]]),
  });
  const { broker, cache } = setup(provider);
  const result = await broker.resolve(input({
    externalServiceProcessingAuthorized: true,
  }));

  assert.equal(result.result.status, "fetched");
  assert.equal(result.result.provider_called, true);
  assert.equal(result.result.has_keychains, true);
  assert.deepEqual(result.keychainsForParser(), mockKeychains);
  assert.equal(provider.sanitizedCalls.length, 1);
  assert.equal(cache.size, 1);

  const serializedResolution = JSON.stringify(result);
  assert.equal(serializedResolution.includes(mockKeychains[0][0].aesKey), false);
  assert.equal(serializedResolution.includes(mockKeychains[0][0].aesIv), false);

  const encrypted = JSON.stringify(cache.encryptedSnapshot());
  assert.equal(encrypted.includes(mockKeychains[0][0].aesKey), false);
  assert.equal(encrypted.includes(mockKeychains[0][0].aesIv), false);
});

test("uses an authorized offline cache hit without calling the external provider", async () => {
  const provider = new MockKeychainProvider({
    responses: new Map([["source-test", mockKeychains]]),
  });
  const { broker } = setup(provider);
  await broker.resolve(input({ externalServiceProcessingAuthorized: true }));
  const cached = await broker.resolve(input({
    externalServiceProcessingAuthorized: false,
    requestFactory: async () => {
      throw new Error("requestFactory must not run on a cache hit");
    },
  }));

  assert.equal(cached.result.status, "cache_hit");
  assert.equal(cached.result.cache_hit, true);
  assert.equal(cached.result.provider_called, false);
  assert.equal(provider.sanitizedCalls.length, 1);
  assert.deepEqual(cached.keychainsForParser(), mockKeychains);
});

test("rejects an invalid request before calling the provider", async () => {
  const provider = new MockKeychainProvider();
  const { broker } = setup(provider);
  const result = await broker.resolve(input({
    externalServiceProcessingAuthorized: true,
    requestFactory: async () => ({ ...mockRequest, keychainsArray: [] }),
  }));

  assert.equal(result.result.status, "invalid_keychain_request");
  assert.equal(provider.sanitizedCalls.length, 0);
});

test("maps provider failures without exposing request values", async () => {
  for (const failureCode of [
    "key_service_unavailable",
    "key_service_rate_limited",
    "key_rejected",
  ]) {
    const provider = new MockKeychainProvider({ failureCode });
    const { broker } = setup(provider);
    const result = await broker.resolve(input({
      externalServiceProcessingAuthorized: true,
    }));

    assert.equal(result.result.status, failureCode);
    assert.equal(result.result.failure_code, failureCode);
    assert.equal(JSON.stringify(result).includes(mockRequest.keychainsArray[0][0].aesCiphertext), false);
  }
});

test("does not cache an invalid provider response", async () => {
  const invalidResponse = [[{
    featurePoint: "BaseFeature",
    aesKey: "not-base64",
    aesIv: "not-base64",
  }]];
  const provider = new MockKeychainProvider({
    responses: new Map([["source-test", invalidResponse]]),
  });
  const { broker, cache } = setup(provider);
  const result = await broker.resolve(input({
    externalServiceProcessingAuthorized: true,
  }));

  assert.equal(result.result.status, "invalid_keychain_response");
  assert.equal(cache.size, 0);
  assert.equal(result.keychainsForParser(), null);
});

test("deletes encrypted cache entries by source and organization", async () => {
  const provider = new MockKeychainProvider({
    responses: new Map([
      ["source-test", mockKeychains],
      ["source-other", mockKeychains],
    ]),
  });
  const { broker, cache } = setup(provider);

  await broker.resolve(input({ externalServiceProcessingAuthorized: true }));
  await broker.resolve(input({
    sourceId: "source-other",
    externalServiceProcessingAuthorized: true,
  }));
  assert.equal(cache.size, 2);

  assert.equal(await broker.revokeSource("org-test", "source-test"), 1);
  assert.equal(cache.size, 1);
  assert.equal(await broker.deleteOrganization("org-test"), 1);
  assert.equal(cache.size, 0);
});
