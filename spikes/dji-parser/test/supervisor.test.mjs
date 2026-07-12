import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runBatch, runIsolatedProbe } from "../src/supervisor.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeWorker = resolve(testDirectory, "../test-support/fake-worker.mjs");
const parserWorker = resolve(testDirectory, "../src/worker.mjs");
const temporaryDirectories = [];

function runTestProbe(options) {
  return runIsolatedProbe({ networkIsolation: "test_only_none", ...options });
}

async function temporaryFixture(mode) {
  const directory = await mkdtemp(resolve(tmpdir(), "droneworks-parser-test-"));
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

test("returns an allowlisted sanitized result", async () => {
  const fixturePath = await temporaryFixture("success");
  const result = await runTestProbe({
    fixtureId: "safe-fixture",
    fixturePath,
    workerPath: fakeWorker,
  });

  assert.equal(result.status, "detected");
  assert.equal(result.format_version, 12);
  assert.equal(result.source.product_type, "SafeProduct");
  assert.equal("coordinates" in result, false);
  assert.equal("secret_serial" in result.source, false);
  assert.equal("stderr" in result.process, false);
});

test("terminates a worker at the wall-time limit", async () => {
  const fixturePath = await temporaryFixture("hang");
  const result = await runTestProbe({
    fixtureId: "hanging-fixture",
    fixturePath,
    workerPath: fakeWorker,
    timeoutMs: 100,
  });

  assert.equal(result.status, "timed_out");
  assert.equal(result.failure_code, "parser_wall_time_limit");
});

test("terminates a worker that exceeds the output limit", async () => {
  const fixturePath = await temporaryFixture("flood");
  const result = await runTestProbe({
    fixtureId: "flooding-fixture",
    fixturePath,
    workerPath: fakeWorker,
    maxOutputBytes: 1_024,
  });

  assert.equal(result.status, "output_limited");
  assert.equal(result.failure_code, "parser_output_limit");
  assert.ok(result.process.total_output_bytes > 1_024);
});

test("classifies a worker that exceeds the V8 memory limit", async () => {
  const fixturePath = await temporaryFixture("oom");
  const result = await runTestProbe({
    fixtureId: "memory-fixture",
    fixturePath,
    workerPath: fakeWorker,
    memoryMb: 16,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "memory_limited");
  assert.equal(result.failure_code, "parser_memory_limit");
  assert.equal("stderr" in result.process, false);
  assert.ok(result.process.stderr_bytes > 0);
});

test("does not expose child stderr after a crash", async () => {
  const fixturePath = await temporaryFixture("crash");
  const result = await runTestProbe({
    fixtureId: "crashing-fixture",
    fixturePath,
    workerPath: fakeWorker,
  });

  assert.equal(result.status, "worker_failed");
  assert.equal(result.failure_code, "parser_internal_error");
  assert.equal("stderr" in result.process, false);
  assert.ok(result.process.stderr_bytes > 0);
  assert.equal(JSON.stringify(result).includes("sensitive-child-error"), false);
});

test("denies child network access", async (t) => {
  let connections = 0;
  const server = createServer((_request, response) => {
    connections += 1;
    response.end("unexpected");
  });
  try {
    await new Promise((resolveListening, rejectListening) => {
      server.once("error", rejectListening);
      server.listen(0, "127.0.0.1", resolveListening);
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("The outer test sandbox does not permit a localhost listener");
      return;
    }
    throw error;
  }
  const address = server.address();
  const fixturePath = await temporaryFixture(`network:${address.port}`);

  try {
    const result = await runIsolatedProbe({
      fixtureId: "network-attempt",
      fixturePath,
      workerPath: fakeWorker,
    });

    assert.equal(result.status, "rejected");
    assert.equal(result.failure_code, "parser_internal_error");
    assert.equal(connections, 0);
  } finally {
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
});

test("the real parser worker rejects generated invalid bytes safely", async () => {
  const fixturePath = await temporaryFixture("not-a-dji-log");
  const result = await runTestProbe({
    fixtureId: "invalid-generated-fixture",
    fixturePath,
    workerPath: parserWorker,
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.failure_code, "invalid_or_corrupt_prefix");
  assert.equal(result.format_family, null);
});

test("continues the batch after a failed worker", async () => {
  const crashPath = await temporaryFixture("crash");
  const successPath = await temporaryFixture("success");
  const results = await runBatch([
    { fixtureId: "first-crashes", fixturePath: crashPath },
    { fixtureId: "second-succeeds", fixturePath: successPath },
  ], { workerPath: fakeWorker, networkIsolation: "test_only_none" });

  assert.equal(results[0].status, "worker_failed");
  assert.equal(results[1].status, "detected");
});

test("reports an unavailable fixture without starting a child", async () => {
  const result = await runTestProbe({
    fixtureId: "missing-fixture",
    fixturePath: resolve(tmpdir(), "droneworks-fixture-does-not-exist"),
    workerPath: fakeWorker,
  });

  assert.equal(result.status, "fixture_unavailable");
  assert.equal(result.failure_code, "fixture_unavailable");
});
