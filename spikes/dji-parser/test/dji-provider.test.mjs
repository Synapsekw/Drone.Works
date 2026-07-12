import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { DjiKeychainProvider } from "../src/keychain/dji-provider.mjs";
import { KeychainProviderError } from "../src/keychain/providers.mjs";

const request = {
  version: 4,
  department: 7,
  keychainsArray: [[{
    featurePoint: "BaseFeature",
    aesCiphertext: Buffer.from("synthetic-ciphertext").toString("base64"),
  }]],
};

const keychains = [[{
  featurePoint: "BaseFeature",
  aesKey: randomBytes(32).toString("base64"),
  aesIv: randomBytes(16).toString("base64"),
}]];

function expectProviderError(code) {
  return (error) => error instanceof KeychainProviderError && error.code === code;
}

async function startMockServer() {
  const observations = { successCalls: 0, requestBody: null, apiKey: null };
  const server = createServer((incoming, response) => {
    if (incoming.url === "/success") {
      observations.successCalls += 1;
      observations.apiKey = incoming.headers["api-key"];
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        observations.requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: keychains }));
      });
      return;
    }

    if (incoming.url === "/redirect") {
      response.writeHead(302, { Location: "/success" });
      response.end();
      return;
    }

    if (incoming.url === "/rejected") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "credential rejected" }));
      return;
    }

    if (incoming.url === "/rate-limited") {
      response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      response.end(JSON.stringify({ error: "rate limited" }));
      return;
    }

    if (incoming.url === "/oversized") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: keychains, padding: "x".repeat(1_024) }));
      return;
    }

    if (incoming.url === "/malformed") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("not-json");
      return;
    }

    if (incoming.url === "/slow") {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: keychains }));
      }, 150);
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  return {
    observations,
    endpoint(path) {
      return `http://127.0.0.1:${port}${path}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
    },
  };
}

function provider(endpoint, overrides = {}) {
  return new DjiKeychainProvider({
    endpoint,
    allowedEndpoints: [endpoint],
    allowInsecureLoopback: true,
    credentialProvider: async () => "private-test-api-key",
    timeoutMs: 500,
    maxResponseBytes: 256 * 1024,
    ...overrides,
  });
}

test("rejects an endpoint outside the exact allowlist before reading credentials", () => {
  let credentialCalls = 0;
  assert.throws(() => new DjiKeychainProvider({
    endpoint: "https://unapproved.invalid/keychains",
    allowedEndpoints: ["https://approved.invalid/keychains"],
    credentialProvider: async () => {
      credentialCalls += 1;
      return "must-not-be-read";
    },
  }), /not allowlisted/);
  assert.equal(credentialCalls, 0);
});

test("rejects cleartext non-loopback endpoints", () => {
  assert.throws(() => new DjiKeychainProvider({
    endpoint: "http://example.invalid/keychains",
    allowedEndpoints: ["http://example.invalid/keychains"],
    credentialProvider: async () => "unused",
  }), /must use HTTPS/);
});

test("keeps the default external endpoint disabled without explicit authorization", () => {
  assert.throws(() => new DjiKeychainProvider({
    credentialProvider: async () => "unused",
  }), /network access is not authorized/);
});

test("rejects invalid request data before reading credentials or using the network", async () => {
  let credentialCalls = 0;
  const endpoint = "http://127.0.0.1:1/keychains";
  const adapter = provider(endpoint, {
    credentialProvider: async () => {
      credentialCalls += 1;
      return "must-not-be-read";
    },
  });

  await assert.rejects(
    adapter.fetchKeychains({ request: { ...request, keychainsArray: [] } }),
    expectProviderError("invalid_keychain_request"),
  );
  assert.equal(credentialCalls, 0);
});

test("DJI provider contract against a local mock HTTP server", async (t) => {
  let mock;
  try {
    mock = await startMockServer();
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("The outer test sandbox does not permit a localhost listener");
      return;
    }
    throw error;
  }

  try {
    await t.test("posts the exact request with a runtime credential", async () => {
      const endpoint = mock.endpoint("/success");
      const result = await provider(endpoint).fetchKeychains({ request });

      assert.deepEqual(result, keychains);
      assert.deepEqual(mock.observations.requestBody, request);
      assert.equal(mock.observations.apiKey, "private-test-api-key");
    });

    await t.test("does not follow redirects", async () => {
      const callsBefore = mock.observations.successCalls;
      const endpoint = mock.endpoint("/redirect");
      await assert.rejects(
        provider(endpoint).fetchKeychains({ request }),
        expectProviderError("key_service_unavailable"),
      );
      assert.equal(mock.observations.successCalls, callsBefore);
    });

    await t.test("classifies credential rejection", async () => {
      const endpoint = mock.endpoint("/rejected");
      await assert.rejects(
        provider(endpoint).fetchKeychains({ request }),
        expectProviderError("key_rejected"),
      );
    });

    await t.test("classifies rate limiting separately", async () => {
      const endpoint = mock.endpoint("/rate-limited");
      await assert.rejects(
        provider(endpoint).fetchKeychains({ request }),
        expectProviderError("key_service_rate_limited"),
      );
    });

    await t.test("rejects an oversized response", async () => {
      const endpoint = mock.endpoint("/oversized");
      await assert.rejects(
        provider(endpoint, { maxResponseBytes: 128 }).fetchKeychains({ request }),
        expectProviderError("invalid_keychain_response"),
      );
    });

    await t.test("rejects malformed JSON", async () => {
      const endpoint = mock.endpoint("/malformed");
      await assert.rejects(
        provider(endpoint).fetchKeychains({ request }),
        expectProviderError("invalid_keychain_response"),
      );
    });

    await t.test("bounds the complete request and response time", async () => {
      const endpoint = mock.endpoint("/slow");
      await assert.rejects(
        provider(endpoint, { timeoutMs: 20 }).fetchKeychains({ request }),
        expectProviderError("key_service_unavailable"),
      );
    });

    await t.test("does not expose the credential in provider errors", async () => {
      const secret = "credential-that-must-not-escape";
      const endpoint = mock.endpoint("/rejected");
      try {
        await provider(endpoint, {
          credentialProvider: async () => secret,
        }).fetchKeychains({ request });
        assert.fail("Expected provider rejection");
      } catch (error) {
        assert.equal(JSON.stringify(error).includes(secret), false);
        assert.equal(error.message.includes(secret), false);
      }
    });
  } finally {
    await mock.close();
  }
});
