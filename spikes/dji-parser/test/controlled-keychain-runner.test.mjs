import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { EncryptedMemoryKeychainCache } from "../src/keychain/cache.mjs";
import {
  readCredentialFile,
  runControlledKeychain,
} from "../src/keychain/controlled-runner.mjs";
import { MockKeychainProvider } from "../src/keychain/providers.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeWorker = resolve(testDirectory, "../test-support/fake-worker.mjs");
const temporaryDirectories = [];

async function temporaryFile(name, contents) {
  const directory = await mkdtemp(resolve(tmpdir(), "droneworks-controlled-keychain-"));
  temporaryDirectories.push(directory);
  const path = resolve(directory, name);
  await writeFile(path, contents);
  return path;
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function fixture(externalServiceProcessing = true, id = "controlled-fixture") {
  return {
    id,
    review: { status: "approved_local" },
    provenance: {
      commercial_evaluation: true,
      external_service_processing: externalServiceProcessing,
      review_on: "2099-12-31",
    },
  };
}

const keychains = [[{
  featurePoint: "BaseFeature",
  aesKey: randomBytes(32).toString("base64"),
  aesIv: randomBytes(16).toString("base64"),
}]];

test("dry-run builds only sanitized request metadata without a provider", async () => {
  const fixturePath = await temporaryFile("fixture.bin", "success");
  const result = await runControlledKeychain({
    fixture: fixture(false),
    fixturePath,
    workerPath: fakeWorker,
    networkIsolation: "test_only_none",
  });

  assert.equal(result.mode, "dry_run");
  assert.equal(result.external_network_authorized, false);
  assert.equal(result.request.status, "keychain_request_ready");
  assert.equal(result.request.request.feature_points, 1);
  assert.equal(result.broker, null);
  assert.equal(result.decode, null);
  assert.equal(JSON.stringify(result).includes("private-request-marker"), false);
});

test("live mode fetches and decodes through the broker without serializing secrets", async () => {
  const fixturePath = await temporaryFile("fixture.bin", "success");
  const followUpPath = await temporaryFile("follow-up.bin", "success");
  const provider = new MockKeychainProvider({
    responses: new Map([["controlled-fixture", keychains]]),
  });
  const result = await runControlledKeychain({
    fixture: fixture(true),
    fixturePath,
    followUpFixtures: [
      {
        fixture: fixture(false, "offline-follow-up"),
        fixtureId: "offline-follow-up",
        fixturePath: followUpPath,
      },
      {
        fixture: fixture(false, "controlled-fixture"),
        fixtureId: "controlled-fixture",
        fixturePath,
      },
    ],
    provider,
    allowDjiRequest: true,
    workerPath: fakeWorker,
    networkIsolation: "test_only_none",
  });

  assert.equal(result.mode, "live");
  assert.equal(result.broker.status, "fetched");
  assert.equal(result.decode.status, "decoded");
  assert.equal(result.decode.validation.secret_in_arguments, false);
  assert.equal(result.decode.validation.secret_in_environment, false);
  assert.deepEqual(
    result.follow_up_decodes.map((decode) => decode.fixture_id),
    ["offline-follow-up", "controlled-fixture"],
  );
  assert.equal(result.follow_up_decodes.every((decode) => decode.status === "decoded"), true);
  assert.equal(provider.sanitizedCalls.length, 1);
  assert.equal(JSON.stringify(result).includes(keychains[0][0].aesKey), false);
  assert.equal(JSON.stringify(result).includes(keychains[0][0].aesIv), false);
});

test("live mode rejects a fixture without external-processing authorization before parsing", async () => {
  await assert.rejects(runControlledKeychain({
    fixture: fixture(false),
    fixturePath: resolve(tmpdir(), "missing-controlled-fixture"),
    provider: new MockKeychainProvider(),
    allowDjiRequest: true,
    workerPath: fakeWorker,
    networkIsolation: "test_only_none",
  }), /not authorized/);
});

test("live mode rejects an unauthorized offline follow-up before the provider call", async () => {
  const fixturePath = await temporaryFile("fixture.bin", "success");
  const provider = new MockKeychainProvider();
  const unauthorized = fixture(false, "unauthorized-follow-up");
  unauthorized.provenance.commercial_evaluation = false;

  await assert.rejects(runControlledKeychain({
    fixture: fixture(true),
    fixturePath,
    followUpFixtures: [{
      fixture: unauthorized,
      fixtureId: unauthorized.id,
      fixturePath,
    }],
    provider,
    allowDjiRequest: true,
    workerPath: fakeWorker,
    networkIsolation: "test_only_none",
  }), /not authorized/);
  assert.equal(provider.sanitizedCalls.length, 0);
});

test("credential reader accepts the one named local value", async () => {
  const credentialPath = await temporaryFile(
    ".env.local",
    "IGNORED=value\nDJI_FLIGHT_RECORD_API_KEY=temporary-test-key\n",
  );
  assert.equal(await readCredentialFile(credentialPath), "temporary-test-key");
});

test("destroy clears encrypted cache entries", async () => {
  const masterKey = randomBytes(32);
  const cache = new EncryptedMemoryKeychainCache(masterKey);
  const context = {
    organizationId: "org-test",
    sourceId: "source-test",
    parserId: "parser-test",
    logVersion: 14,
  };
  await cache.put(context, keychains);
  cache.destroy();

  assert.equal(cache.size, 0);
  assert.equal(await cache.get(context), null);
});
