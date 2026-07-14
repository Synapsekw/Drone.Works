import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runContainerizedParser } from "./run.mjs";

const image = process.env.DRONEWORKS_PARSER_PROOF_IMAGE ?? "droneworks/dji-parser-proof:ci";
const directory = await mkdtemp(resolve(tmpdir(), "droneworks-container-proof-"));
const fixturePath = resolve(directory, "source.bin");
await writeFile(fixturePath, "generated containment fixture");

async function run(mode, constraints = {}) {
  return runContainerizedParser({
    image,
    fixturePath,
    commandArgs: ["--mode", mode],
    constraints,
  });
}

try {
  const boundary = await run("boundary");
  assert.equal(boundary.status, "completed");
  assert.equal(boundary.boundary.validated, true);
  assert.notEqual(boundary.result.uid, 0);
  assert.equal(boundary.result.fixture_read, true);
  assert.equal(boundary.result.network_denied, true);
  assert.equal(boundary.result.rootfs_write_denied, true);
  assert.equal(boundary.result.source_write_denied, true);
  assert.equal(boundary.result.child_process_denied, true);
  assert.equal(boundary.result.network_interfaces.every((name) => name === "lo"), true);

  const crash = await run("crash");
  assert.equal(crash.status, "worker_failed");
  assert.equal(crash.failure_code, "parser_internal_error");
  assert.equal(JSON.stringify(crash).includes("private-container-error"), false);

  const afterCrash = await run("success");
  assert.equal(afterCrash.status, "completed");

  const timeout = await run("hang", { timeoutMs: 300 });
  assert.equal(timeout.status, "timed_out");
  assert.equal(timeout.failure_code, "parser_wall_time_limit");

  const output = await run("flood", { maxOutputBytes: 1_024 });
  assert.equal(output.status, "output_limited");
  assert.equal(output.failure_code, "parser_output_limit");
  assert.ok(output.process.total_output_bytes > 1_024);

  const memory = await run("oom", { memoryMb: 96, timeoutMs: 10_000 });
  assert.equal(memory.status, "memory_limited");
  assert.equal(memory.failure_code, "parser_memory_limit");
  assert.equal(memory.process.oom_killed, true);

  process.stdout.write(`${JSON.stringify({
    status: "verified",
    checks: {
      boundary: boundary.status,
      crash_isolation: crash.status,
      later_operation: afterCrash.status,
      wall_time: timeout.status,
      output: output.status,
      memory: memory.status,
    },
  }, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
