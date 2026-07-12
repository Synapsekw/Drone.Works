import { readFile } from "node:fs/promises";

const fileIndex = process.argv.indexOf("--file");
const fixturePath = process.argv[fileIndex + 1];
const mode = (await readFile(fixturePath, "utf8")).trim();

if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else if (mode === "oom") {
  const allocations = [];
  while (true) {
    allocations.push(new Array(100_000).fill(Math.random()));
  }
} else if (mode === "flood") {
  process.stdout.write("x".repeat(200_000));
} else if (mode === "crash") {
  process.stderr.write("sensitive-child-error-must-not-escape");
  process.exit(7);
} else if (mode === "invalid-json") {
  process.stdout.write("not-json");
} else if (mode.startsWith("network:")) {
  const port = Number(mode.slice("network:".length));
  try {
    await fetch(`http://127.0.0.1:${port}`);
    process.stdout.write(`${JSON.stringify({
      status: "detected",
      format_family: "dji_txt",
      format_version: 99,
      encryption: "none",
    })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({
      status: "rejected",
      failure_code: "parser_internal_error",
      encryption: "unknown",
    })}\n`);
  }
} else {
  process.stdout.write(`${JSON.stringify({
    status: "detected",
    failure_code: null,
    format_family: "dji_txt",
    format_version: 12,
    encryption: "none",
    source: {
      platform: "DJIFly",
      application_version: "1.0",
      product_type: "SafeProduct",
      secret_serial: "must-not-escape",
    },
    metrics: {
      bytes: mode.length,
      read_ms: 1,
      parse_ms: 2,
      worker_total_ms: 3,
    },
    coordinates: [25, 55],
  })}\n`);
}
