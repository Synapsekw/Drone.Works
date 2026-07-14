import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { readFile, writeFile } from "node:fs/promises";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function denied(action) {
  try {
    await action();
    return false;
  } catch {
    return true;
  }
}

async function childProcessDenied() {
  try {
    await new Promise((resolveChild, rejectChild) => {
      execFile("/bin/true", (error) => error ? rejectChild(error) : resolveChild());
    });
    return false;
  } catch (error) {
    return error?.code === "ERR_ACCESS_DENIED";
  }
}

const mode = argument("--mode") ?? "success";
const fixturePath = argument("--file") ?? "/input/source.bin";

if (mode === "boundary") {
  const fixture = await readFile(fixturePath);
  const networkDenied = await denied(() => fetch("http://192.0.2.1", {
    signal: AbortSignal.timeout(250),
  }));
  const result = {
    kind: "boundary_probe",
    uid: process.getuid?.() ?? null,
    fixture_read: fixture.length > 0,
    network_interfaces: Object.keys(networkInterfaces()).sort(),
    network_denied: networkDenied,
    rootfs_write_denied: await denied(() => writeFile("/app/write-attempt", "blocked")),
    source_write_denied: await denied(() => writeFile(fixturePath, "blocked")),
    child_process_denied: await childProcessDenied(),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (mode === "hang") {
  await new Promise(() => {});
} else if (mode === "flood") {
  process.stdout.write("x".repeat(2 * 1024 * 1024));
} else if (mode === "oom") {
  const allocations = [];
  while (true) {
    allocations.push(Buffer.alloc(8 * 1024 * 1024, 1));
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
  }
} else if (mode === "crash") {
  process.stderr.write("private-container-error-must-not-escape");
  process.exit(7);
} else {
  process.stdout.write(`${JSON.stringify({ kind: "success" })}\n`);
}
