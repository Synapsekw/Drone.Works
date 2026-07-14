import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const boundaryWorker = resolve(testDirectory, "../test-support/container-boundary-worker.mjs");

test("container boundary worker remains alive in hang mode", async () => {
  const child = spawn(process.execPath, [boundaryWorker, "--mode", "hang"], {
    stdio: "ignore",
  });
  const exit = once(child, "exit");

  try {
    await once(child, "spawn");
    const outcome = await Promise.race([
      exit.then(([code, signal]) => ({ code, signal })),
      delay(150, null),
    ]);
    assert.equal(outcome, null);
  } finally {
    child.kill("SIGKILL");
    await exit;
  }
});
