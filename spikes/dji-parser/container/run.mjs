import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export const DEFAULT_CONSTRAINTS = Object.freeze({
  containerUser: "65532:65532",
  cpus: 0.5,
  memoryMb: 192,
  pidsLimit: 32,
  tmpfsMb: 16,
  timeoutMs: 5_000,
  maxOutputBytes: 65_536,
});

function positiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function buildContainerCreateArgs({
  name,
  image,
  fixturePath,
  commandArgs = [],
  constraints = {},
}) {
  if (!name || !image || !fixturePath) {
    throw new Error("name, image, and fixturePath are required");
  }

  const effective = { ...DEFAULT_CONSTRAINTS, ...constraints };
  positiveNumber(effective.cpus, "cpus");
  positiveInteger(effective.memoryMb, "memoryMb");
  positiveInteger(effective.pidsLimit, "pidsLimit");
  positiveInteger(effective.tmpfsMb, "tmpfsMb");

  return [
    "create",
    "--name", name,
    "--network", "none",
    "--read-only",
    "--user", effective.containerUser,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--cpus", String(effective.cpus),
    "--memory", `${effective.memoryMb}m`,
    "--memory-swap", `${effective.memoryMb}m`,
    "--pids-limit", String(effective.pidsLimit),
    "--ulimit", "core=0:0",
    "--ulimit", "nofile=64:64",
    "--tmpfs", `/tmp:rw,noexec,nosuid,size=${effective.tmpfsMb}m`,
    "--mount", `type=bind,source=${resolve(fixturePath)},target=/input/source.bin,readonly`,
    image,
    ...commandArgs,
  ];
}

export function validateContainerInspection(inspection, constraints = {}) {
  const effective = { ...DEFAULT_CONSTRAINTS, ...constraints };
  const host = inspection?.HostConfig ?? {};
  const config = inspection?.Config ?? {};
  const errors = [];
  const expectedMemory = effective.memoryMb * 1024 * 1024;
  const expectedNanoCpus = Math.round(effective.cpus * 1_000_000_000);
  const inputMount = inspection?.Mounts?.find((mount) => mount.Destination === "/input/source.bin");

  if (host.NetworkMode !== "none") errors.push("network namespace is not disabled");
  if (host.ReadonlyRootfs !== true) errors.push("root filesystem is not read-only");
  if (host.Privileged === true) errors.push("container is privileged");
  if (host.OomKillDisable === true) errors.push("kernel OOM termination is disabled");
  if (host.Memory !== expectedMemory) errors.push("hard memory limit does not match");
  if (host.MemorySwap !== expectedMemory) errors.push("swap would exceed the memory limit");
  if (host.NanoCpus !== expectedNanoCpus) errors.push("CPU quota does not match");
  if (host.PidsLimit !== effective.pidsLimit) errors.push("PID limit does not match");
  if (!host.CapDrop?.includes("ALL")) errors.push("Linux capabilities are not all dropped");
  if (!host.SecurityOpt?.some((value) => value.startsWith("no-new-privileges"))) {
    errors.push("no-new-privileges is not enabled");
  }
  if (!host.Tmpfs?.["/tmp"]?.includes(`size=${effective.tmpfsMb}m`)) {
    errors.push("bounded temporary filesystem is missing");
  }
  if (config.User !== effective.containerUser) errors.push("container user does not match");
  if (!inputMount || inputMount.RW !== false) errors.push("source file is not mounted read-only");

  return errors;
}

async function runtimeOutput(runtime, args) {
  const { stdout } = await execFileAsync(runtime, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function appendBounded(chunks, chunk, state) {
  state.total += chunk.length;
  if (state.kept >= state.limit) return;
  const kept = chunk.subarray(0, state.limit - state.kept);
  chunks.push(kept);
  state.kept += kept.length;
}

async function startAttached(runtime, name, { timeoutMs, maxOutputBytes }) {
  const stdout = [];
  const stderr = [];
  const output = { total: 0, kept: 0, limit: maxOutputBytes };
  let stopReason = null;
  let stopPromise = Promise.resolve();
  const child = spawn(runtime, ["start", "--attach", name], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  function requestStop(reason) {
    if (stopReason) return;
    stopReason = reason;
    stopPromise = runtimeOutput(runtime, ["kill", name])
      .catch(() => {})
      .finally(() => child.kill("SIGKILL"));
  }

  const timer = setTimeout(() => requestStop("timeout"), timeoutMs);
  timer.unref();

  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
    stream.on("data", (chunk) => {
      appendBounded(chunks, chunk, output);
      if (output.total > maxOutputBytes) requestStop("output");
    });
  }

  const outcome = await new Promise((resolveOutcome) => {
    child.once("error", (error) => resolveOutcome({ error }));
    child.once("close", (code, signal) => resolveOutcome({ code, signal }));
  });
  clearTimeout(timer);
  await stopPromise;

  return {
    ...outcome,
    stopReason,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stdoutBytes: stdout.reduce((total, chunk) => total + chunk.length, 0),
    stderrBytes: stderr.reduce((total, chunk) => total + chunk.length, 0),
    totalOutputBytes: output.total,
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value.trim());
  } catch {
    return null;
  }
}

export function classifyContainerExecution(execution, state) {
  if (execution.stopReason === "timeout") {
    return { status: "timed_out", failureCode: "parser_wall_time_limit" };
  }
  if (execution.stopReason === "output") {
    return { status: "output_limited", failureCode: "parser_output_limit" };
  }
  if (state.OOMKilled === true) {
    return { status: "memory_limited", failureCode: "parser_memory_limit" };
  }
  if (execution.error || state.ExitCode !== 0) {
    return { status: "worker_failed", failureCode: "parser_internal_error" };
  }
  if (!safeJson(execution.stdout)) {
    return { status: "worker_failed", failureCode: "invalid_worker_output" };
  }
  return { status: "completed", failureCode: null };
}

export async function runContainerizedParser({
  image,
  fixturePath,
  commandArgs = [],
  constraints = {},
  runtime = process.env.DRONEWORKS_CONTAINER_RUNTIME ?? "docker",
}) {
  const effective = { ...DEFAULT_CONSTRAINTS, ...constraints };
  positiveInteger(effective.timeoutMs, "timeoutMs");
  positiveInteger(effective.maxOutputBytes, "maxOutputBytes");
  const name = `droneworks-parser-${randomUUID()}`;
  let created = false;

  try {
    await runtimeOutput(runtime, buildContainerCreateArgs({
      name,
      image,
      fixturePath,
      commandArgs,
      constraints: effective,
    }));
    created = true;

    const inspection = JSON.parse(await runtimeOutput(runtime, ["inspect", name]))[0];
    const inspectionErrors = validateContainerInspection(inspection, effective);
    if (inspectionErrors.length > 0) {
      throw new Error(`Container boundary validation failed: ${inspectionErrors.join("; ")}`);
    }

    const execution = await startAttached(runtime, name, effective);
    const state = JSON.parse(await runtimeOutput(runtime, ["inspect", "--format", "{{json .State}}", name]));

    const { status, failureCode } = classifyContainerExecution(execution, state);

    return {
      schema_version: 1,
      status,
      failure_code: failureCode,
      result: status === "completed" ? safeJson(execution.stdout) : null,
      boundary: {
        validated: true,
        network: "none",
        root_filesystem: "read_only",
        user: effective.containerUser,
        cpus: effective.cpus,
        memory_mb: effective.memoryMb,
        pids_limit: effective.pidsLimit,
      },
      process: {
        exit_code: state.ExitCode ?? null,
        oom_killed: state.OOMKilled === true,
        stdout_bytes: execution.stdoutBytes,
        stderr_bytes: execution.stderrBytes,
        total_output_bytes: execution.totalOutputBytes,
      },
    };
  } finally {
    if (created) {
      await runtimeOutput(runtime, ["rm", "--force", name]).catch(() => {});
    }
  }
}
