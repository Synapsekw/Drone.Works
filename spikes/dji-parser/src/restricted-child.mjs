import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(sourceDirectory, "..");
const macosSandboxExecutable = "/usr/bin/sandbox-exec";
const macosNoNetworkProfile = "(version 1) (allow default) (deny network*)";

function appendBounded(chunks, chunk, state) {
  state.total += chunk.length;
  if (state.kept < state.limit) {
    const remaining = state.limit - state.kept;
    const kept = chunk.subarray(0, remaining);
    chunks.push(kept);
    state.kept += kept.length;
  }
}

function minimalEnvironment() {
  const environment = {
    LANG: process.env.LANG ?? "C",
    LC_ALL: process.env.LC_ALL ?? "C",
    PATH: process.env.PATH ?? "",
    NODE_NO_WARNINGS: "1",
  };

  if (process.env.TMPDIR) {
    environment.TMPDIR = process.env.TMPDIR;
  }

  return environment;
}

function failure(status, failureCode, process = null) {
  return {
    ok: false,
    status,
    failureCode,
    process,
  };
}

export async function executeRestrictedChild({
  fixtureId,
  fixturePath,
  workerPath = resolve(sourceDirectory, "worker.mjs"),
  operation = "probe",
  sensitiveInput = null,
  maxInputBytes = 262_144,
  timeoutMs = 5_000,
  maxOutputBytes = 65_536,
  memoryMb = 128,
  nodeExecutable = process.execPath,
  networkIsolation = "require",
}) {
  try {
    await access(fixturePath);
  } catch {
    return failure("fixture_unavailable", "fixture_unavailable");
  }

  let inputBuffer = null;
  let inputByteLength = 0;
  if (sensitiveInput !== null) {
    inputBuffer = Buffer.from(JSON.stringify(sensitiveInput));
    inputByteLength = inputBuffer.length;
    if (inputBuffer.length > maxInputBytes) {
      inputBuffer.fill(0);
      return failure("input_limited", "parser_input_limit", {
        input_bytes: inputByteLength,
        max_input_bytes: maxInputBytes,
      });
    }
  }

  const startedAt = performance.now();
  const stdout = [];
  const stderr = [];
  const outputState = { total: 0, kept: 0, limit: maxOutputBytes };
  let timedOut = false;
  let outputLimited = false;

  const args = [
    "--permission",
    `--allow-fs-read=${spikeRoot}`,
    `--allow-fs-read=${dirname(workerPath)}`,
    `--allow-fs-read=${fixturePath}`,
    `--max-old-space-size=${memoryMb}`,
    workerPath,
    "--fixture-id",
    fixtureId,
    "--file",
    fixturePath,
    "--operation",
    operation,
  ];

  let executable = nodeExecutable;
  let executableArgs = args;
  let networkIsolationMethod = "none";

  if (networkIsolation === "require") {
    if (process.platform !== "darwin") {
      inputBuffer?.fill(0);
      return failure("isolation_unavailable", "network_isolation_unavailable");
    }

    try {
      await access(macosSandboxExecutable);
    } catch {
      inputBuffer?.fill(0);
      return failure("isolation_unavailable", "network_isolation_unavailable");
    }

    executable = macosSandboxExecutable;
    executableArgs = ["-p", macosNoNetworkProfile, nodeExecutable, ...args];
    networkIsolationMethod = "macos_sandbox_exec";
  } else if (networkIsolation !== "test_only_none") {
    inputBuffer?.fill(0);
    throw new Error("networkIsolation must be require or test_only_none");
  }

  const child = spawn(executable, executableArgs, {
    cwd: spikeRoot,
    env: minimalEnvironment(),
    stdio: [inputBuffer ? "pipe" : "ignore", "pipe", "pipe"],
  });

  if (inputBuffer) {
    child.stdin.on("error", () => {});
    child.stdin.end(inputBuffer);
  }

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();

  child.stdout.on("data", (chunk) => {
    appendBounded(stdout, chunk, outputState);
    if (outputState.total > maxOutputBytes && !outputLimited) {
      outputLimited = true;
      child.kill("SIGKILL");
    }
  });

  child.stderr.on("data", (chunk) => {
    appendBounded(stderr, chunk, outputState);
    if (outputState.total > maxOutputBytes && !outputLimited) {
      outputLimited = true;
      child.kill("SIGKILL");
    }
  });

  const outcome = await new Promise((resolveOutcome) => {
    child.once("error", (error) => resolveOutcome({ spawnError: error }));
    child.once("close", (code, signal) => resolveOutcome({ code, signal }));
  });
  clearTimeout(timer);
  inputBuffer?.fill(0);

  const processMetrics = {
    supervisor_wall_ms: performance.now() - startedAt,
    child_exit_code: outcome.code ?? null,
    child_signal: outcome.signal ?? null,
    input_bytes: inputByteLength,
    stdout_bytes: stdout.reduce((sum, chunk) => sum + chunk.length, 0),
    stderr_bytes: stderr.reduce((sum, chunk) => sum + chunk.length, 0),
    total_output_bytes: outputState.total,
    network_isolation: networkIsolationMethod,
  };

  if (timedOut) {
    return failure("timed_out", "parser_wall_time_limit", processMetrics);
  }

  if (outputLimited) {
    return failure("output_limited", "parser_output_limit", processMetrics);
  }

  if (outcome.spawnError) {
    return failure("worker_failed", "parser_internal_error", processMetrics);
  }

  if (outcome.code !== 0 && stdout.length === 0) {
    const stderrText = Buffer.concat(stderr).toString("utf8");
    if (/heap out of memory|reached heap limit|allocation failed/i.test(stderrText)) {
      return failure("memory_limited", "parser_memory_limit", processMetrics);
    }

    return failure("worker_failed", "parser_internal_error", processMetrics);
  }

  try {
    return {
      ok: true,
      raw: JSON.parse(Buffer.concat(stdout).toString("utf8").trim()),
      process: processMetrics,
    };
  } catch {
    return failure("worker_failed", "invalid_worker_output", processMetrics);
  }
}
