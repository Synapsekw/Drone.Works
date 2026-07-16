import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, tmpdir, totalmem, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import pg from "pg";
import {
  codecCapabilities,
  compressTelemetry,
  decompressTelemetry,
  generateSyntheticTelemetry,
  telemetryPoints,
} from "../src/codec.mjs";
import { downsampleTelemetry, pageTelemetry, telemetrySummary } from "../src/downsample.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;
const PROFILES = Object.freeze({
  smoke: Object.freeze({
    organizations: 4,
    flights: 100,
    samplesPerFlight: 600,
    cadenceMs: 2_000,
    templates: 4,
    relationalFlights: 20,
    writeConcurrency: 32,
  }),
  benchmark: Object.freeze({
    organizations: 100,
    flights: 100_000,
    samplesPerFlight: 6_000,
    cadenceMs: 200,
    templates: 100,
    relationalFlights: 1_000,
    writeConcurrency: 128,
  }),
});

function parseArguments(arguments_) {
  let profile = "smoke";
  let output;
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === "--profile") profile = arguments_[++index];
    else if (arguments_[index] === "--output") output = resolve(arguments_[++index]);
    else throw new TypeError(`unknown argument ${arguments_[index]}`);
  }
  if (!PROFILES[profile]) throw new TypeError(`unknown profile ${profile}`);
  return {
    profile,
    output: output ?? (profile === "benchmark"
      ? new URL("../results/benchmark.json", import.meta.url).pathname
      : undefined),
  };
}

async function findPostgresBin() {
  const candidates = [
    process.env.POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@18/bin",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "postgres"));
      await access(join(candidate, "initdb"));
      await access(join(candidate, "pg_ctl"));
      return candidate;
    } catch {
      // Continue to the next explicit native installation.
    }
  }
  throw new Error("PostgreSQL 18 server binaries not found; Docker is not used by this benchmark");
}

function milliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function objectKey(organizationId, flightId) {
  return `org-${String(organizationId).padStart(3, "0")}/flight-${String(flightId).padStart(6, "0")}.dwtc.gz`;
}

async function runInBatches(total, concurrency, operation, progressEvery = 10_000) {
  for (let start = 1; start <= total; start += concurrency) {
    const end = Math.min(total, start + concurrency - 1);
    await Promise.all(Array.from({ length: end - start + 1 }, (_, offset) => operation(start + offset)));
    if (end % progressEvery < concurrency || end === total) process.stdout.write(`materialized ${end}/${total} objects\n`);
  }
}

function rowsToPoints(rows) {
  return rows.map((row, index) => ({
    index,
    elapsed_ms: Number(row.elapsed_ms),
    route_x_m: row.route_x_m === null ? null : Number(row.route_x_m),
    route_y_m: row.route_y_m === null ? null : Number(row.route_y_m),
    altitude_m: row.altitude_m === null ? null : Number(row.altitude_m),
    horizontal_speed_mps: row.horizontal_speed_mps === null ? null : Number(row.horizontal_speed_mps),
    vertical_speed_mps: row.vertical_speed_mps === null ? null : Number(row.vertical_speed_mps),
    battery_percent: row.battery_percent === null ? null : Number(row.battery_percent),
    satellite_count: row.satellite_count === null ? null : Number(row.satellite_count),
    signal_percent: row.signal_percent === null ? null : Number(row.signal_percent),
    flags: Number(row.flags),
    warning_code: row.warning_code === null ? null : Number(row.warning_code),
  }));
}

async function queryFlightRows(client, organizationId, flightId, bounds = {}) {
  const clauses = ["organization_id = $1", "flight_id = $2"];
  const parameters = [organizationId, flightId];
  if (bounds.startMs !== undefined) {
    parameters.push(bounds.startMs);
    clauses.push(`elapsed_ms >= $${parameters.length}`);
  }
  if (bounds.endMs !== undefined) {
    parameters.push(bounds.endMs);
    clauses.push(`elapsed_ms <= $${parameters.length}`);
  }
  const result = await client.query(
    `SELECT elapsed_ms, route_x_m, route_y_m, altitude_m,
            horizontal_speed_mps, vertical_speed_mps, battery_percent,
            satellite_count, signal_percent, flags, warning_code
       FROM telemetry_benchmark.row_samples
      WHERE ${clauses.join(" AND ")}
      ORDER BY elapsed_ms`,
    parameters,
  );
  return rowsToPoints(result.rows);
}

async function benchmarkRelational(client, profile) {
  const insertFlightsStarted = performance.now();
  await client.query(
    `INSERT INTO telemetry_benchmark.row_flights (organization_id, flight_id, started_month)
     SELECT ((flight_id - 1) % $2)::integer + 1,
            flight_id,
            (date '2025-01-01' + (((flight_id - 1) % 24)::text || ' months')::interval)::date
       FROM generate_series(1, $1::integer) AS flight_id`,
    [profile.relationalFlights, profile.organizations],
  );
  const insertSamplesStarted = performance.now();
  await client.query(
    `INSERT INTO telemetry_benchmark.row_samples (
       started_month, organization_id, flight_id, elapsed_ms, route_x_m, route_y_m,
       altitude_m, horizontal_speed_mps, vertical_speed_mps, battery_percent,
       satellite_count, signal_percent, flags, warning_code
     )
     SELECT flight.started_month,
            flight.organization_id,
            flight.flight_id,
            sample_index * $1,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
              THEN NULL ELSE (cos(sample_index::double precision / ($2 - 1) * pi() * 6)
                * (100 + sample_index::double precision / ($2 - 1) * 400))::real END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
              THEN NULL ELSE (sin(sample_index::double precision / ($2 - 1) * pi() * 6)
                * (100 + sample_index::double precision / ($2 - 1) * 400))::real END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
              THEN NULL ELSE (20 + sin(sample_index::double precision / $2 * pi()) * 80)::real END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
              THEN NULL ELSE (8 + sin(sample_index::double precision / 170) * 4)::real END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
              THEN NULL ELSE (cos(sample_index::double precision / 220) * 2.5)::real END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
              THEN NULL
              WHEN sample_index = floor($2 * 0.801) THEN 11.25::real
              ELSE (100 - sample_index::double precision / ($2 - 1) * 76)::real END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
              THEN 0 ELSE 13 + (sample_index % 8) END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434)
                   OR sample_index % 997 = 0
              THEN NULL ELSE 92 - (sample_index % 23) END,
            CASE WHEN sample_index BETWEEN floor($2 * 0.43) AND floor($2 * 0.434) THEN 1
              WHEN sample_index = floor($2 * 0.555) THEN 2 ELSE 0 END,
            CASE WHEN sample_index = floor($2 * 0.555) THEN 7 ELSE NULL END
       FROM telemetry_benchmark.row_flights AS flight
       CROSS JOIN generate_series(0, $2::integer - 1) AS sample_index`,
    [profile.cadenceMs, profile.samplesPerFlight],
  );
  const sampleInsertMs = milliseconds(insertSamplesStarted);
  await client.query("ANALYZE telemetry_benchmark.row_samples");
  const storage = await client.query(
    `SELECT (
              SELECT sum(pg_total_relation_size(relid))
                FROM pg_partition_tree('telemetry_benchmark.row_samples')
               WHERE isleaf
            )::text AS samples_bytes,
            pg_total_relation_size('telemetry_benchmark.row_flights')::text AS flights_bytes`,
  );
  const measuredRows = profile.relationalFlights * profile.samplesPerFlight;
  const samplesBytes = Number(storage.rows[0].samples_bytes);

  const lookupFlightId = Math.min(42, profile.relationalFlights);
  const lookupOrganizationId = ((lookupFlightId - 1) % profile.organizations) + 1;
  const firstReadStarted = performance.now();
  const firstPoints = await queryFlightRows(client, lookupOrganizationId, lookupFlightId);
  const firstReadMs = milliseconds(firstReadStarted);
  const replayDurations = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = performance.now();
    downsampleTelemetry(await queryFlightRows(client, lookupOrganizationId, lookupFlightId), Math.min(1_000, profile.samplesPerFlight));
    replayDurations.push(milliseconds(started));
  }
  const windowStarted = performance.now();
  const windowPoints = await queryFlightRows(client, lookupOrganizationId, lookupFlightId, {
    startMs: 300_000,
    endMs: 600_000,
  });
  const windowMs = milliseconds(windowStarted);
  let cursor = -1;
  let exportedRows = 0;
  let exportQueries = 0;
  let exportBytes = 0;
  const exportStarted = performance.now();
  while (cursor !== null) {
    const page = await client.query(
      `SELECT elapsed_ms, route_x_m, route_y_m, altitude_m,
              horizontal_speed_mps, vertical_speed_mps, battery_percent,
              satellite_count, signal_percent, flags, warning_code
         FROM telemetry_benchmark.row_samples
        WHERE organization_id = $1 AND flight_id = $2 AND elapsed_ms > $3
        ORDER BY elapsed_ms
        LIMIT 1000`,
      [lookupOrganizationId, lookupFlightId, cursor],
    );
    exportQueries += 1;
    exportedRows += page.rowCount;
    exportBytes += Buffer.byteLength(JSON.stringify(page.rows));
    cursor = page.rowCount === 1_000 ? Number(page.rows.at(-1).elapsed_ms) : null;
  }
  const exportMs = milliseconds(exportStarted);

  const deleteFlightId = profile.relationalFlights;
  const deleteFlightOrganization = ((deleteFlightId - 1) % profile.organizations) + 1;
  const singleDeleteStarted = performance.now();
  const deletedFlight = await client.query(
    "DELETE FROM telemetry_benchmark.row_flights WHERE organization_id = $1 AND flight_id = $2 RETURNING flight_id",
    [deleteFlightOrganization, deleteFlightId],
  );
  const singleDeleteMs = milliseconds(singleDeleteStarted);
  const organizationToDelete = profile.organizations;
  const organizationRows = await client.query(
    "SELECT count(*)::integer AS flights FROM telemetry_benchmark.row_flights WHERE organization_id = $1",
    [organizationToDelete],
  );
  const organizationDeleteStarted = performance.now();
  const deletedOrganizationRows = await client.query(
    "DELETE FROM telemetry_benchmark.row_flights WHERE organization_id = $1 RETURNING flight_id",
    [organizationToDelete],
  );
  const organizationDeleteMs = milliseconds(organizationDeleteStarted);

  return {
    candidate: "postgres_partitioned_rows",
    measurement_scope: {
      flights_actual: profile.relationalFlights,
      samples_per_flight: profile.samplesPerFlight,
      frames_actual: measuredRows,
      benchmark_frames_projected: profile.flights * profile.samplesPerFlight,
      projection_method: "measured bytes per row multiplied linearly; timings are not claimed at projected scale",
    },
    ingest: {
      flights_ms: Math.round((insertSamplesStarted - insertFlightsStarted) * 100) / 100,
      samples_ms: sampleInsertMs,
      samples_per_second: Math.round(measuredRows / (sampleInsertMs / 1_000)),
    },
    storage: {
      samples_bytes_actual: samplesBytes,
      flights_bytes_actual: Number(storage.rows[0].flights_bytes),
      bytes_per_sample_actual: samplesBytes / measuredRows,
      samples_bytes_projected_100k: Math.round(samplesBytes / measuredRows * profile.flights * profile.samplesPerFlight),
    },
    retrieval: {
      first_application_read_ms: firstReadMs,
      warm_replay_median_ms: median(replayDurations),
      replay_points: Math.min(1_000, profile.samplesPerFlight),
      replay_json_bytes: Buffer.byteLength(JSON.stringify(downsampleTelemetry(firstPoints, Math.min(1_000, profile.samplesPerFlight)))),
      window_ms: windowMs,
      window_points: windowPoints.length,
      full_export_ms: exportMs,
      full_export_rows: exportedRows,
      full_export_queries: exportQueries,
      full_export_json_bytes: exportBytes,
      operating_system_cache_was_not_dropped: true,
    },
    deletion: {
      single_flight_ms: singleDeleteMs,
      single_flight_deleted: deletedFlight.rowCount,
      organization_id: organizationToDelete,
      organization_flights_before: organizationRows.rows[0].flights,
      organization_flights_deleted: deletedOrganizationRows.rowCount,
      organization_ms: organizationDeleteMs,
    },
    replay_summary_matches_full: JSON.stringify(telemetrySummary(downsampleTelemetry(firstPoints, Math.min(1_000, profile.samplesPerFlight))))
      === JSON.stringify(telemetrySummary(firstPoints)),
  };
}

async function benchmarkObjects(client, objectRoot, profile) {
  const templates = [];
  const templateStarted = performance.now();
  for (let templateId = 1; templateId <= profile.templates; templateId += 1) {
    const version = templateId % 10 === 0
      || (profile.templates < 10 && templateId === profile.templates)
      ? 2
      : 1;
    const buffer = compressTelemetry(generateSyntheticTelemetry({
      sampleCount: profile.samplesPerFlight,
      cadenceMs: profile.cadenceMs,
      variant: templateId,
      version,
    }));
    templates.push({
      id: templateId,
      version,
      buffer,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    });
  }
  const templateGenerationMs = milliseconds(templateStarted);
  await client.query(
    "INSERT INTO telemetry_benchmark.organizations SELECT generate_series(1, $1::integer)",
    [profile.organizations],
  );
  for (const template of templates) {
    await client.query(
      `INSERT INTO telemetry_benchmark.telemetry_templates
       (id, codec_version, sample_count, object_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5)`,
      [template.id, template.version, profile.samplesPerFlight, template.buffer.length, template.sha256],
    );
  }
  for (let organizationId = 1; organizationId <= profile.organizations; organizationId += 1) {
    await mkdir(join(objectRoot, `org-${String(organizationId).padStart(3, "0")}`), { recursive: true });
  }
  const objectWriteStarted = performance.now();
  await runInBatches(profile.flights, profile.writeConcurrency, async (flightId) => {
    const organizationId = ((flightId - 1) % profile.organizations) + 1;
    const template = templates[(flightId - 1) % templates.length];
    await writeFile(join(objectRoot, objectKey(organizationId, flightId)), template.buffer, { flag: "wx" });
  });
  const objectWriteMs = milliseconds(objectWriteStarted);
  const metadataStarted = performance.now();
  await client.query(
    `INSERT INTO telemetry_benchmark.telemetry_objects (
       organization_id, flight_id, template_id, object_key, codec_version,
       sample_count, object_bytes, object_sha256
     )
     SELECT ((flight_id - 1) % $2)::integer + 1,
            flight_id,
            ((flight_id - 1) % $3)::integer + 1,
            format(
              'org-%s/flight-%s.dwtc.gz',
              lpad((((flight_id - 1) % $2) + 1)::text, 3, '0'),
              lpad(flight_id::text, 6, '0')
            ),
            template.codec_version,
            template.sample_count,
            template.object_bytes,
            template.sha256
       FROM generate_series(1, $1::integer) AS flight_id
       JOIN telemetry_benchmark.telemetry_templates AS template
         ON template.id = ((flight_id - 1) % $3)::integer + 1`,
    [profile.flights, profile.organizations, profile.templates],
  );
  const metadataMs = milliseconds(metadataStarted);
  const totals = await client.query(
    `SELECT count(*)::integer AS flights,
            sum(sample_count)::text AS frames,
            sum(object_bytes)::text AS object_bytes,
            pg_total_relation_size('telemetry_benchmark.telemetry_objects')::text AS metadata_bytes
       FROM telemetry_benchmark.telemetry_objects`,
  );

  const lookupFlightId = Math.min(42, profile.flights);
  const lookupOrganizationId = ((lookupFlightId - 1) % profile.organizations) + 1;
  const lookupPath = join(objectRoot, objectKey(lookupOrganizationId, lookupFlightId));
  const firstReadStarted = performance.now();
  const firstTelemetry = decompressTelemetry(await readFile(lookupPath));
  const firstPoints = telemetryPoints(firstTelemetry);
  const firstReadMs = milliseconds(firstReadStarted);
  const replayDurations = [];
  let replay;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = performance.now();
    replay = downsampleTelemetry(
      telemetryPoints(decompressTelemetry(await readFile(lookupPath))),
      Math.min(1_000, profile.samplesPerFlight),
    );
    replayDurations.push(milliseconds(started));
  }
  const windowStarted = performance.now();
  const windowPoints = telemetryPoints(decompressTelemetry(await readFile(lookupPath)), {
    startMs: 300_000,
    endMs: 600_000,
  });
  const windowMs = milliseconds(windowStarted);
  const exportStarted = performance.now();
  let cursor = 0;
  let exportPages = 0;
  let exportedRows = 0;
  let exportBytes = 0;
  while (cursor !== null) {
    const page = pageTelemetry(firstPoints, { cursor, limit: 1_000 });
    exportPages += 1;
    exportedRows += page.items.length;
    exportBytes += Buffer.byteLength(JSON.stringify(page));
    cursor = page.nextCursor;
  }
  const exportMs = milliseconds(exportStarted);

  const oldTemplate = templates.find((template) => template.version === 1);
  const newTemplate = templates.find((template) => template.version === 2) ?? oldTemplate;
  const evolution = {
    old_version: oldTemplate.version,
    old_columns: codecCapabilities(decompressTelemetry(oldTemplate.buffer).version).columns,
    new_version: newTemplate.version,
    new_columns: codecCapabilities(decompressTelemetry(newTemplate.buffer).version).columns,
    old_read_after_additive_change: true,
  };

  const deleteFlightId = profile.flights;
  const deleteOrganizationId = ((deleteFlightId - 1) % profile.organizations) + 1;
  const singleDeleteStarted = performance.now();
  await unlink(join(objectRoot, objectKey(deleteOrganizationId, deleteFlightId)));
  const deletedFlight = await client.query(
    "DELETE FROM telemetry_benchmark.telemetry_objects WHERE organization_id = $1 AND flight_id = $2 RETURNING flight_id",
    [deleteOrganizationId, deleteFlightId],
  );
  const singleDeleteMs = milliseconds(singleDeleteStarted);

  const organizationToDelete = profile.organizations;
  const organizationObjectRows = await client.query(
    "SELECT object_key FROM telemetry_benchmark.telemetry_objects WHERE organization_id = $1 ORDER BY flight_id",
    [organizationToDelete],
  );
  const organizationDeleteStarted = performance.now();
  for (let start = 0; start < organizationObjectRows.rows.length; start += profile.writeConcurrency) {
    const batch = organizationObjectRows.rows.slice(start, start + profile.writeConcurrency);
    await Promise.all(batch.map((row) => unlink(join(objectRoot, row.object_key))));
  }
  const deletedOrganization = await client.query(
    "DELETE FROM telemetry_benchmark.telemetry_objects WHERE organization_id = $1 RETURNING flight_id",
    [organizationToDelete],
  );
  const organizationDeleteMs = milliseconds(organizationDeleteStarted);
  const remainingOrganizationObjects = await client.query(
    "SELECT count(*)::integer AS count FROM telemetry_benchmark.telemetry_objects WHERE organization_id = $1",
    [organizationToDelete],
  );

  return {
    candidate: "versioned_columnar_object_with_postgres_metadata",
    measurement_scope: {
      flights_actual: totals.rows[0].flights,
      samples_per_flight: profile.samplesPerFlight,
      frames_actual: Number(totals.rows[0].frames),
      template_variants: profile.templates,
      repeated_templates: true,
      note: "Every flight has a physically materialized full-density object; deterministic template reuse limits synthetic generation cost and is disclosed.",
    },
    ingest: {
      template_generation_ms: templateGenerationMs,
      object_write_ms: objectWriteMs,
      metadata_insert_ms: metadataMs,
      objects_per_second: Math.round(profile.flights / (objectWriteMs / 1_000)),
      logical_frames_per_second: Math.round((profile.flights * profile.samplesPerFlight) / (objectWriteMs / 1_000)),
    },
    storage: {
      object_bytes_actual: Number(totals.rows[0].object_bytes),
      metadata_bytes_actual: Number(totals.rows[0].metadata_bytes),
      bytes_per_flight_actual: Number(totals.rows[0].object_bytes) / profile.flights,
      bytes_per_frame_actual: Number(totals.rows[0].object_bytes) / Number(totals.rows[0].frames),
    },
    retrieval: {
      first_application_read_ms: firstReadMs,
      warm_replay_median_ms: median(replayDurations),
      replay_points: replay.length,
      replay_json_bytes: Buffer.byteLength(JSON.stringify(replay)),
      window_ms: windowMs,
      window_points: windowPoints.length,
      full_export_ms: exportMs,
      full_export_rows: exportedRows,
      full_export_pages: exportPages,
      full_export_json_bytes: exportBytes,
      operating_system_cache_was_not_dropped: true,
      provider_network_latency_excluded: true,
    },
    deletion: {
      single_flight_ms: singleDeleteMs,
      single_flight_deleted: deletedFlight.rowCount,
      organization_id: organizationToDelete,
      organization_objects_before: organizationObjectRows.rowCount,
      organization_objects_deleted: deletedOrganization.rowCount,
      organization_objects_after: remainingOrganizationObjects.rows[0].count,
      organization_ms: organizationDeleteMs,
    },
    replay_summary_matches_full: JSON.stringify(telemetrySummary(replay)) === JSON.stringify(telemetrySummary(firstPoints)),
    capability_evolution: evolution,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const profile = PROFILES[options.profile];
  const postgresBin = await findPostgresBin();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dw-tb-"));
  const dataDirectory = join(temporaryRoot, "data");
  const socketDirectory = join(temporaryRoot, "socket");
  const objectRoot = join(temporaryRoot, "objects");
  const logPath = join(temporaryRoot, "postgres.log");
  const port = String(55_000 + Math.floor(Math.random() * 5_000));
  let serverStarted = false;
  let client;
  try {
    process.stdout.write(`starting ${options.profile} profile without Docker\n`);
    await execFileAsync(join(postgresBin, "initdb"), [
      "--pgdata", dataDirectory,
      "--encoding", "UTF8",
      "--locale", "C",
      "--auth", "trust",
      "--no-sync",
    ]);
    await mkdir(socketDirectory);
    await mkdir(objectRoot);
    await execFileAsync(join(postgresBin, "pg_ctl"), [
      "--pgdata", dataDirectory,
      "--log", logPath,
      "--options", `-h '' -k ${socketDirectory} -p ${port}`,
      "--wait",
      "start",
    ]);
    serverStarted = true;
    client = new Client({
      host: socketDirectory,
      port: Number(port),
      database: "postgres",
      user: userInfo().username,
      application_name: "droneworks-telemetry-benchmark",
    });
    await client.connect();
    await client.query(await readFile(new URL("../sql/001_benchmark.sql", import.meta.url), "utf8"));
    const settings = await client.query(
      `SELECT current_setting('server_version') AS server_version,
              current_setting('block_size') AS block_size,
              current_setting('shared_buffers') AS shared_buffers,
              current_setting('fsync') AS fsync,
              current_setting('full_page_writes') AS full_page_writes`,
    );
    const startedAt = new Date().toISOString();
    const objectCandidate = await benchmarkObjects(client, objectRoot, profile);
    process.stdout.write("object-backed candidate complete; starting relational cohort\n");
    const relationalCandidate = await benchmarkRelational(client, profile);
    const result = {
      schema_version: 1,
      profile: options.profile,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      environment: {
        platform: platform(),
        operating_system_release: release(),
        architecture: process.arch,
        cpu_model: cpus()[0]?.model ?? "unknown",
        logical_cpu_count: cpus().length,
        memory_bytes: totalmem(),
        free_memory_bytes_at_report: freemem(),
        node_version: process.version,
        postgres: settings.rows[0],
        storage: "local APFS temporary directory; no provider network",
        hostname_recorded: false,
      },
      dataset: {
        organizations: profile.organizations,
        flights: profile.flights,
        duration_minutes: 20,
        source_frame_rate_hz: 1_000 / profile.cadenceMs,
        samples_per_flight: profile.samplesPerFlight,
        frames: profile.flights * profile.samplesPerFlight,
        synthetic_relative_track: true,
        gap_fraction: 0.004,
        warning_events_per_flight: 1,
        signal_sparse_every_n_samples: 997,
        schema_v2_flights_fraction: profile.templates < 10 ? 1 / profile.templates : 0.1,
      },
      measurement_boundaries: {
        first_application_read: "first benchmark-process read after ingest; OS filesystem cache was not forcibly dropped",
        warm: "median of five subsequent application reads including decompression/query and downsampling",
        ingest: "object file writes and PostgreSQL metadata are measured separately; parser and network time excluded",
        deletion: "active local object bytes are removed before relational metadata; backups and provider caches excluded",
        cost: "usage quantities are measured here; public unit prices and sensitivity are documented separately",
      },
      candidates: [objectCandidate, relationalCandidate],
    };
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`wrote ${options.output}\n`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const log = await readFile(logPath, "utf8").catch(() => "");
    if (log) process.stderr.write(`\nPostgreSQL log:\n${log}\n`);
    throw error;
  } finally {
    if (client) await client.end().catch(() => undefined);
    if (serverStarted) {
      await execFileAsync(join(postgresBin, "pg_ctl"), [
        "--pgdata", dataDirectory,
        "--mode", "fast",
        "--wait",
        "stop",
      ]).catch(() => undefined);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
