import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixturePath = process.argv[2];
const mode = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : "summary";
const source = await readFile(fixturePath);
const fixtureMode = source.toString("utf8");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const sensitive = Buffer.concat(chunks);
const payload = JSON.parse(sensitive.toString("utf8"));
const secret = payload.keychains?.[0]?.[0]?.aesKey ?? "";
sensitive.fill(0);

if (fixtureMode === "flood" && mode === "intermediate") {
  process.stdout.write("x".repeat(200_000));
} else if (mode === "intermediate") {
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    kind: "dji_parser_intermediate",
    parser: {
      id: "dji-log-parser",
      version: "0.5.7",
      source_commit: "e2e0775670a8391b4f7ecc40fca4cb01ea4a90fa",
    },
    source: {
      sha256: createHash("sha256").update(source).digest("hex"),
      bytes: source.length,
      format_family: "dji_txt",
      format_version: 14,
    },
    flights: [{
      flight_index: 0,
      imported: {
        takeoff_time_utc: "2026-01-01T00:00:00Z",
        declared_duration_ms: 1000,
        declared_distance_m: 2,
        declared_max_height_m: 3,
        declared_max_horizontal_speed_mps: 4,
        declared_max_vertical_speed_mps: 5,
        aircraft_name: "private-aircraft-name",
        aircraft_model: "Synthetic",
        application_platform: "Synthetic",
        application_version: "1.0.0",
        identifiers: {
          aircraft_serials: ["private-aircraft-serial"],
          battery_serials: [],
          camera_serials: [],
          controller_serials: [],
        },
      },
      capabilities: ["altitude", "position"],
      sample_count: 1,
      samples: [{
        elapsed_ms: 0,
        position: { latitude_deg: 25, longitude_deg: 55 },
        altitude_msl_m: 10,
        height_agl_m: 0,
        velocity: { x_mps: 0, y_mps: 0, z_mps: 0 },
        attitude: { pitch_deg: 0, roll_deg: 0, yaw_deg: 0 },
        battery: null,
        gps: { satellites: 10, signal_level: 5, position_used: true },
        signal: null,
      }],
    }],
  })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    kind: "decode_summary",
    status: "decoded",
    failure_code: null,
    validation: {
      keychain_received: secret.length > 0,
      secret_in_arguments: process.argv.join(" ").includes(secret),
      secret_in_environment: Object.values(process.env).some((value) => value.includes(secret)),
      frame_count_positive: true,
      time_monotonic: true,
      coordinates_in_bounds: true,
      battery_in_bounds: true,
    },
    capabilities: { location: true, battery: false, signal: false, attitude: true },
    metrics: {
      frames_count: 1,
      read_ms: 0.1,
      parse_ms: 0.2,
      decode_ms: 0.3,
      worker_total_ms: 0.6,
      max_rss_bytes: 1024,
    },
  })}\n`);
}
