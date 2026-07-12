import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { sanitizeWorkerResult, supervisorFailure } from "./result.mjs";

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

export async function runIsolatedProbe({
  fixtureId,
  fixturePath,
  workerPath = resolve(sourceDirectory, "worker.mjs"),
  timeoutMs = 5_000,
  maxOutputBytes = 65_536,
  memoryMb = 128,
  nodeExecutable = process.execPath,
  networkIsolation = "require",
}) {
  try {
    await access(fixturePath);
  } catch {
    return supervisorFailure(fixtureId, "fixture_unavailable", "fixture_unavailable");
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
  ];

  let executable = nodeExecutable;
  let executableArgs = args;
  let networkIsolationMethod = "none";

  if (networkIsolation === "require") {
    if (process.platform !== "darwin") {
      return supervisorFailure(
        fixtureId,
        "isolation_unavailable",
        "network_isolation_unavailable",
      );
    }

    try {
      await access(macosSandboxExecutable);
    } catch {
      return supervisorFailure(
        fixtureId,
        "isolation_unavailable",
        "network_isolation_unavailable",
      );
    }

    executable = macosSandboxExecutable;
    executableArgs = ["-p", macosNoNetworkProfile, nodeExecutable, ...args];
    networkIsolationMethod = "macos_sandbox_exec";
  } else if (networkIsolation !== "test_only_none") {
    throw new Error("networkIsolation must be require or test_only_none");
  }

  const child = spawn(executable, executableArgs, {
    cwd: spikeRoot,
    env: minimalEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });

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

  const wallMs = performance.now() - startedAt;
  const processMetrics = {
    supervisor_wall_ms: wallMs,
    child_exit_code: outcome.code ?? null,
    child_signal: outcome.signal ?? null,
    stdout_bytes: stdout.reduce((sum, chunk) => sum + chunk.length, 0),
    stderr_bytes: stderr.reduce((sum, chunk) => sum + chunk.length, 0),
    total_output_bytes: outputState.total,
    network_isolation: networkIsolationMethod,
  };

  if (timedOut) {
    return {
      ...supervisorFailure(fixtureId, "timed_out", "parser_wall_time_limit"),
      process: processMetrics,
    };
  }

  if (outputLimited) {
    return {
      ...supervisorFailure(fixtureId, "output_limited", "parser_output_limit"),
      process: processMetrics,
    };
  }

  if (outcome.spawnError) {
    return {
      ...supervisorFailure(fixtureId, "worker_failed", "parser_internal_error"),
      process: processMetrics,
    };
  }

  if (outcome.code !== 0 && stdout.length === 0) {
    const stderrText = Buffer.concat(stderr).toString("utf8");
    if (/heap out of memory|reached heap limit|allocation failed/i.test(stderrText)) {
      return {
        ...supervisorFailure(fixtureId, "memory_limited", "parser_memory_limit"),
        process: processMetrics,
      };
    }

    return {
      ...supervisorFailure(fixtureId, "worker_failed", "parser_internal_error"),
      process: processMetrics,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(stdout).toString("utf8").trim());
  } catch {
    return {
      ...supervisorFailure(fixtureId, "worker_failed", "invalid_worker_output"),
      process: processMetrics,
    };
  }

  return {
    ...sanitizeWorkerResult(parsed, fixtureId),
    process: processMetrics,
  };
}

export async function runBatch(fixtures, options = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await runIsolatedProbe({ ...options, ...fixture }));
  }
  return results;
}
