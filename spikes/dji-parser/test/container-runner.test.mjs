import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildContainerCreateArgs,
  classifyContainerExecution,
  DEFAULT_CONSTRAINTS,
  validateContainerInspection,
} from "../container/run.mjs";

function validInspection() {
  return {
    Config: { User: DEFAULT_CONSTRAINTS.containerUser },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      Privileged: false,
      OomKillDisable: false,
      Memory: DEFAULT_CONSTRAINTS.memoryMb * 1024 * 1024,
      MemorySwap: DEFAULT_CONSTRAINTS.memoryMb * 1024 * 1024,
      NanoCpus: DEFAULT_CONSTRAINTS.cpus * 1_000_000_000,
      PidsLimit: DEFAULT_CONSTRAINTS.pidsLimit,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: { "/tmp": `rw,noexec,nosuid,size=${DEFAULT_CONSTRAINTS.tmpfsMb}m` },
    },
    Mounts: [{ Destination: "/input/source.bin", RW: false }],
  };
}

test("container creation applies every required hard boundary", () => {
  const args = buildContainerCreateArgs({
    name: "proof",
    image: "parser:test",
    fixturePath: "/tmp/source.bin",
    commandArgs: ["--mode", "boundary"],
  });

  assert.deepEqual(args.slice(0, 3), ["create", "--name", "proof"]);
  assert.ok(args.includes("none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("ALL"));
  assert.ok(args.includes("no-new-privileges"));
  assert.ok(args.includes(`${DEFAULT_CONSTRAINTS.memoryMb}m`));
  assert.ok(args.includes(String(DEFAULT_CONSTRAINTS.cpus)));
  assert.ok(args.includes(String(DEFAULT_CONSTRAINTS.pidsLimit)));
  assert.ok(args.some((value) => value.includes("target=/input/source.bin,readonly")));
});

test("container inspection accepts the complete boundary", () => {
  assert.deepEqual(validateContainerInspection(validInspection()), []);
});

test("container inspection fails closed when a hard boundary is weakened", () => {
  const inspection = validInspection();
  inspection.HostConfig.NetworkMode = "bridge";
  inspection.HostConfig.Memory = 0;
  inspection.Config.User = "0:0";

  const errors = validateContainerInspection(inspection);
  assert.ok(errors.includes("network namespace is not disabled"));
  assert.ok(errors.includes("hard memory limit does not match"));
  assert.ok(errors.includes("container user does not match"));
});

test("container execution classifies wall-time termination first", () => {
  assert.deepEqual(
    classifyContainerExecution({ stopReason: "timeout", stdout: "" }, { OOMKilled: true, ExitCode: 137 }),
    { status: "timed_out", failureCode: "parser_wall_time_limit" },
  );
});

test("container execution classifies output termination", () => {
  assert.deepEqual(
    classifyContainerExecution({ stopReason: "output", stdout: "" }, { OOMKilled: false, ExitCode: 137 }),
    { status: "output_limited", failureCode: "parser_output_limit" },
  );
});

test("container execution classifies a cgroup OOM kill", () => {
  assert.deepEqual(
    classifyContainerExecution({ stopReason: null, stdout: "" }, { OOMKilled: true, ExitCode: 137 }),
    { status: "memory_limited", failureCode: "parser_memory_limit" },
  );
});

test("container execution rejects invalid successful output", () => {
  assert.deepEqual(
    classifyContainerExecution({ stopReason: null, stdout: "not-json" }, { OOMKilled: false, ExitCode: 0 }),
    { status: "worker_failed", failureCode: "invalid_worker_output" },
  );
});

test("container execution accepts one valid JSON result", () => {
  assert.deepEqual(
    classifyContainerExecution({ stopReason: null, stdout: '{"status":"ok"}' }, { OOMKilled: false, ExitCode: 0 }),
    { status: "completed", failureCode: null },
  );
});
