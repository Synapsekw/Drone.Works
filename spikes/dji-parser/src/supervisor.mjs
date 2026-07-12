import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeWorkerResult, supervisorFailure } from "./result.mjs";
import { executeRestrictedChild } from "./restricted-child.mjs";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

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
  const execution = await executeRestrictedChild({
    fixtureId,
    fixturePath,
    workerPath,
    operation: "probe",
    timeoutMs,
    maxOutputBytes,
    memoryMb,
    nodeExecutable,
    networkIsolation,
  });

  if (!execution.ok) {
    const result = supervisorFailure(fixtureId, execution.status, execution.failureCode);
    return execution.process ? { ...result, process: execution.process } : result;
  }

  return { ...sanitizeWorkerResult(execution.raw, fixtureId), process: execution.process };
}

export async function runBatch(fixtures, options = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await runIsolatedProbe({ ...options, ...fixture }));
  }
  return results;
}
