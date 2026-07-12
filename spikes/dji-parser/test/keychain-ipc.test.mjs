import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  runIsolatedDecode,
  runIsolatedKeychainRequest,
} from "../src/keychain/ipc.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeWorker = resolve(testDirectory, "../test-support/fake-worker.mjs");
const temporaryDirectories = [];

async function temporaryFixture(mode) {
  const directory = await mkdtemp(resolve(tmpdir(), "droneworks-keychain-ipc-"));
  temporaryDirectories.push(directory);
  const path = resolve(directory, "fixture.bin");
  await writeFile(path, mode);
  return path;
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

const keychains = [[{
  featurePoint: "BaseFeature",
  aesKey: randomBytes(32).toString("base64"),
  aesIv: randomBytes(16).toString("base64"),
}]];

test("extracts a private request while serializing metadata only", async () => {
  const fixturePath = await temporaryFixture("success");
  const result = await runIsolatedKeychainRequest({
    fixtureId: "request-fixture",
    fixturePath,
    workerPath: fakeWorker,
    networkIsolation: "test_only_none",
  });

  assert.equal(result.result.status, "keychain_request_ready");
  assert.equal(result.result.has_private_request, true);
  assert.equal(result.result.request.feature_points, 1);
  const request = result.requestForBroker();
  assert.equal(request.keychainsArray.length, 1);
  assert.equal(JSON.stringify(result).includes(request.keychainsArray[0][0].aesCiphertext), false);
});

test("rejects an invalid private request without exposing it", async () => {
  const fixturePath = await temporaryFixture("invalid-request");
  const result = await runIsolatedKeychainRequest({
    fixtureId: "invalid-request-fixture",
    fixturePath,
    workerPath: fakeWorker,
    networkIsolation: "test_only_none",
  });

  assert.equal(result.result.status, "invalid_keychain_request");
  assert.equal(result.requestForBroker(), null);
});

test("passes keychains through bounded stdin without arguments, environment, or output leakage", async () => {
  const fixturePath = await temporaryFixture("success");
  const result = await runIsolatedDecode({
    fixtureId: "decode-fixture",
    fixturePath,
    workerPath: fakeWorker,
    keychains,
    networkIsolation: "test_only_none",
  });

  assert.equal(result.status, "decoded");
  assert.equal(result.validation.keychain_received, true);
  assert.equal(result.validation.secret_in_arguments, false);
  assert.equal(result.validation.secret_in_environment, false);
  assert.equal(result.metrics.frames_count, 2);
  assert.ok(result.process.input_bytes > 0);
  assert.equal(JSON.stringify(result).includes(keychains[0][0].aesKey), false);
  assert.equal("coordinates" in result, false);
  assert.equal("private_key" in result, false);
});

test("rejects invalid keychains before opening the fixture or spawning", async () => {
  const result = await runIsolatedDecode({
    fixtureId: "invalid-keychain-fixture",
    fixturePath: resolve(tmpdir(), "fixture-does-not-exist"),
    workerPath: fakeWorker,
    keychains: [[{ featurePoint: "BaseFeature", aesKey: "bad", aesIv: "bad" }]],
    networkIsolation: "test_only_none",
  });

  assert.equal(result.status, "decode_failed");
  assert.equal(result.failure_code, "invalid_keychain_response");
  assert.equal(result.process, null);
});

test("rejects a valid keychain payload that exceeds the configured stdin bound", async () => {
  const fixturePath = await temporaryFixture("success");
  const result = await runIsolatedDecode({
    fixtureId: "input-limit-fixture",
    fixturePath,
    workerPath: fakeWorker,
    keychains,
    maxInputBytes: 16,
    networkIsolation: "test_only_none",
  });

  assert.equal(result.status, "decode_failed");
  assert.equal(result.failure_code, "parser_input_limit");
  assert.equal(result.process.input_bytes > result.process.max_input_bytes, true);
});
