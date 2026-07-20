import { createHash } from 'node:crypto';

import pg from '../../packages/database/node_modules/pg/esm/index.mjs';

import { encodeTelemetryV1 } from '../../packages/telemetry/dist/index.js';

import { withOrganizationTransaction } from '../../packages/database/dist/index.js';
import { generatedOrganizations } from '../../packages/database/test/generated-seed.mjs';

const { Pool } = pg;
const pool = new Pool({
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  max: 1,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
});
const telemetryCapabilities = [
  'telemetry.altitude',
  'telemetry.battery',
  'telemetry.gps',
  'telemetry.position',
  'telemetry.signal',
  'telemetry.velocity',
];

function fact(value) {
  return {
    base_preference: ['imported'],
    derived: null,
    effective: {
      origin: value === null ? 'unavailable' : 'imported',
      value,
    },
    imported:
      value === null ? null : { value, provenance: { origin: 'generated' } },
    user_override: null,
  };
}

function facts(input) {
  return {
    aircraft_model: fact('Synthetic'),
    aircraft_name: fact(input.aircraftName),
    application_platform: fact('Drone.Works demo generator'),
    application_version: fact('1'),
    distance_m: fact(input.distanceM),
    duration_ms: fact(input.durationMs),
    max_height_m: fact(input.maxHeightM),
    max_horizontal_speed_mps: fact(input.speedMps),
    max_vertical_speed_mps: fact(null),
    takeoff_time_utc: fact(input.takeoffAt),
  };
}

function telemetrySamples(marker) {
  const offset = marker === 'a' ? 0 : 0.006;
  return Array.from({ length: 241 }, (_, index) => ({
    elapsed_ms: index * 500,
    position:
      index >= 112 && index <= 115
        ? null
        : {
            latitude_deg: 0.01 + offset + index * 0.000004,
            longitude_deg: 0.02 + offset + Math.sin(index / 28) * 0.0007,
          },
    altitude_msl_m: 18 + Math.sin(index / 18) * 9,
    height_agl_m: Math.max(0, Math.sin(index / 30) * 24),
    velocity: { x_mps: 7, y_mps: 2, z_mps: 0.2 },
    attitude: { pitch_deg: 0, roll_deg: 0, yaw_deg: index % 360 },
    battery: {
      charge_percent: Math.max(42, 100 - index / 4),
      current_a: null,
      temperature_c: 27,
      voltage_v: 15.8,
    },
    gps: {
      position_used: !(index >= 112 && index <= 115),
      satellites: 15,
      signal_level: 5,
    },
    signal: { downlink_percent: 96, uplink_percent: 94 },
  }));
}

async function storeTelemetry(seed) {
  const encoded = encodeTelemetryV1(telemetrySamples(seed.marker));
  const key = `organizations/${seed.organizationId}/flight-revisions/${seed.revisionId}/telemetry-v1`;
  const response = await fetch(
    new URL(
      `/objects/${encodeURIComponent(key)}`,
      process.env.OBJECT_INTERNAL_URL,
    ),
    {
      body: new Uint8Array(encoded.bytes),
      headers: {
        'content-type': encoded.mediaType,
        'x-content-sha256': encoded.contentSha256,
      },
      method: 'PUT',
    },
  );
  if (!response.ok) throw new Error('Generated telemetry could not be stored.');
  const versionId = response.headers.get('x-version-id');
  if (!versionId) throw new Error('Generated telemetry version is missing.');
  return { encoded, versionId };
}

async function storeGeneratedRawSource(seed) {
  const content = Buffer.from(
    `Drone.Works generated local source ${seed.marker.toUpperCase()}`,
  );
  const contentSha256 = createHash('sha256').update(content).digest('hex');
  const key = `organizations/${seed.organizationId}/raw-sources/${seed.rawSourceId}/revisions/${seed.rawSourceId}`;
  const response = await fetch(
    new URL(
      `/objects/${encodeURIComponent(key)}`,
      process.env.OBJECT_INTERNAL_URL,
    ),
    {
      body: content,
      headers: {
        'content-type': 'application/octet-stream',
        'x-content-sha256': contentSha256,
      },
      method: 'PUT',
    },
  );
  if (!response.ok)
    throw new Error('Generated raw source could not be stored.');
  const versionId = response.headers.get('x-version-id');
  if (!versionId) throw new Error('Generated raw source version is missing.');
  return { byteSize: content.byteLength, contentSha256, versionId };
}

const demoRows = [
  {
    suffix: '1',
    state: 'active',
    takeoffAt: '2026-07-15T05:40:00.000Z',
    durationMs: 742_000,
    distanceM: 3_210.8,
    maxHeightM: 96.2,
    speedMps: 14.1,
  },
  {
    suffix: '2',
    state: 'awaiting_review',
    takeoffAt: '2026-07-14T14:15:00.000Z',
    durationMs: 315_000,
    distanceM: 812.4,
    maxHeightM: 35.6,
    speedMps: 8.4,
  },
];

try {
  for (const seed of Object.values(generatedOrganizations)) {
    const [stored, rawSource] = await Promise.all([
      storeTelemetry(seed),
      storeGeneratedRawSource(seed),
    ]);
    await withOrganizationTransaction(
      pool,
      seed.organizationId,
      async (transaction) => {
        await transaction.query(
          `UPDATE droneworks.raw_sources
              SET object_revision_id = $3,
                  content_sha256 = $4,
                  byte_size = $5
            WHERE organization_id = $1 AND id = $2`,
          [
            seed.organizationId,
            seed.rawSourceId,
            rawSource.versionId,
            rawSource.contentSha256,
            rawSource.byteSize,
          ],
        );
        await transaction.query(
          `UPDATE droneworks.telemetry_objects
              SET object_revision_id = $3,
                  codec = $4,
                  codec_version = $5,
                  content_sha256 = $6,
                  sample_count = $7,
                  first_elapsed_ms = $8,
                  last_elapsed_ms = $9,
                  capabilities = $10
            WHERE organization_id = $1 AND flight_revision_id = $2`,
          [
            seed.organizationId,
            seed.revisionId,
            stored.versionId,
            stored.encoded.codec,
            stored.encoded.codecVersion,
            stored.encoded.contentSha256,
            stored.encoded.sampleCount,
            stored.encoded.firstElapsedMs,
            stored.encoded.lastElapsedMs,
            telemetryCapabilities,
          ],
        );

        for (const demo of demoRows) {
          const flightId = `30000000-0000-4000-8000-0000000000${seed.marker}${demo.suffix}`;
          const revisionId = `31000000-0000-4000-8000-0000000000${seed.marker}${demo.suffix}`;
          await transaction.query(
            `INSERT INTO droneworks.canonical_flights (
               organization_id, id, import_item_id, pilot_profile_id, aircraft_id,
               source_kind, state, takeoff_at, takeoff_timezone, duration_ms,
               assignment_status, created_at, updated_at
             ) VALUES (
               $1, $2, NULL, $3, $4, 'manual', $5, $6, 'Asia/Dubai', $7,
               'assigned', $6, $6
             )`,
            [
              seed.organizationId,
              flightId,
              seed.pilotId,
              seed.aircraftId,
              demo.state,
              demo.takeoffAt,
              demo.durationMs,
            ],
          );
          await transaction.query(
            `INSERT INTO droneworks.flight_revisions (
               organization_id, id, canonical_flight_id, import_attempt_id,
               revision_number, canonical_schema_version, facts, capabilities,
               exact_normalized_fingerprint, exact_normalized_version,
               fingerprint_status, provenance, created_at
             ) VALUES (
               $1, $2, $3, NULL, 1, 1, $4, '{}', NULL,
               'exact-normalized-v1', 'insufficient_evidence', $5, $6
             )`,
            [
              seed.organizationId,
              revisionId,
              flightId,
              facts({
                ...demo,
                aircraftName: `Generated Aircraft ${seed.marker.toUpperCase()}`,
              }),
              { origin: 'generated_demo' },
              demo.takeoffAt,
            ],
          );
        }

        await transaction.query(
          `UPDATE droneworks.import_items
              SET result_flight_id = $3
            WHERE organization_id = $1 AND id = $2`,
          [seed.organizationId, seed.itemId, seed.flightId],
        );

        const reviewBatchId = `40000000-0000-4000-8000-0000000000${seed.marker}0`;
        const candidateFlightId = `30000000-0000-4000-8000-0000000000${seed.marker}2`;
        const createdAt = '2026-07-20T08:00:00.000Z';
        await transaction.query(
          `INSERT INTO droneworks.import_batches (
             organization_id, id, uploaded_by_user_id, state, created_at,
             completed_at
           ) VALUES ($1, $2, $3, 'completed', $4, $4)`,
          [seed.organizationId, reviewBatchId, seed.userId, createdAt],
        );
        const outcomes = [
          {
            suffix: '1',
            filename: 'generated-supported.txt',
            state: 'completed',
            failureCode: null,
            duplicateKind: null,
            resultFlightId: seed.flightId,
            duplicateFlightId: null,
            reviewFlightId: null,
            attemptState: 'succeeded',
          },
          {
            suffix: '2',
            filename: 'generated-unsupported.dat',
            state: 'failed',
            failureCode: 'unsupported_format',
            duplicateKind: null,
            resultFlightId: null,
            duplicateFlightId: null,
            reviewFlightId: null,
            attemptState: 'failed',
          },
          {
            suffix: '3',
            filename: 'generated-corrupt.txt',
            state: 'failed',
            failureCode: 'invalid_source',
            duplicateKind: null,
            resultFlightId: null,
            duplicateFlightId: null,
            reviewFlightId: null,
            attemptState: 'failed',
          },
          {
            suffix: '4',
            filename: 'generated-truncated.txt',
            state: 'failed',
            failureCode: 'truncated_source',
            duplicateKind: null,
            resultFlightId: null,
            duplicateFlightId: null,
            reviewFlightId: null,
            attemptState: 'failed',
          },
          {
            suffix: '5',
            filename: 'generated-key-unavailable.txt',
            state: 'failed',
            failureCode: 'key_service_unavailable',
            duplicateKind: null,
            resultFlightId: null,
            duplicateFlightId: null,
            reviewFlightId: null,
            attemptState: 'failed',
          },
          {
            suffix: '6',
            filename: 'generated-cancelled.txt',
            state: 'cancelled',
            failureCode: null,
            duplicateKind: null,
            resultFlightId: null,
            duplicateFlightId: null,
            reviewFlightId: null,
            attemptState: 'cancelled',
          },
          {
            suffix: '7',
            filename: 'generated-exact-duplicate.txt',
            state: 'skipped_duplicate',
            failureCode: null,
            duplicateKind: 'exact_file',
            resultFlightId: null,
            duplicateFlightId: seed.flightId,
            reviewFlightId: null,
            attemptState: 'succeeded',
          },
          {
            suffix: '8',
            filename: 'generated-probable-duplicate.txt',
            state: 'awaiting_review',
            failureCode: null,
            duplicateKind: 'probable',
            resultFlightId: candidateFlightId,
            duplicateFlightId: null,
            reviewFlightId: seed.flightId,
            attemptState: 'succeeded',
          },
        ];
        for (const outcome of outcomes) {
          const itemId = `40000000-0000-4000-8000-0000000000${seed.marker}${outcome.suffix}`;
          const attemptId = `41000000-0000-4000-8000-0000000000${seed.marker}${outcome.suffix}`;
          await transaction.query(
            `INSERT INTO droneworks.import_items (
               organization_id, id, import_batch_id, raw_source_id, client_file_id,
               original_filename, state, failure_code, result_flight_id,
               duplicate_of_flight_id, duplicate_kind, review_flight_id,
               outcome_reason, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               'generated_local_review', $13, $13
             )`,
            [
              seed.organizationId,
              itemId,
              reviewBatchId,
              outcome.suffix === '5' ? seed.rawSourceId : null,
              `generated-review-${outcome.suffix}`,
              outcome.filename,
              outcome.state,
              outcome.failureCode,
              outcome.resultFlightId,
              outcome.duplicateFlightId,
              outcome.duplicateKind,
              outcome.reviewFlightId,
              createdAt,
            ],
          );
          await transaction.query(
            `INSERT INTO droneworks.import_attempts (
               organization_id, id, import_item_id, attempt_number, state,
               parser_revision, failure_code, started_at, finished_at
             ) VALUES ($1, $2, $3, 1, $4, 'generated-review-v1', $5, $6, $6)`,
            [
              seed.organizationId,
              attemptId,
              itemId,
              outcome.attemptState,
              outcome.failureCode,
              createdAt,
            ],
          );
        }
        const retryItemId = `40000000-0000-4000-8000-0000000000${seed.marker}5`;
        await transaction.query(
          `INSERT INTO droneworks_jobs.outbox (
             organization_id, id, job_type, payload_version, resource_id,
             state, available_at, created_at, attempt_count, queue_job_id,
             dispatched_at
           ) VALUES (
             $1, $2, 'raw-source-processing-v1', 1, $3, 'dispatched',
             $4, $4, 1, $5, $4
           )`,
          [
            seed.organizationId,
            `42000000-0000-4000-8000-0000000000${seed.marker}5`,
            retryItemId,
            createdAt,
            `43000000-0000-4000-8000-0000000000${seed.marker}5`,
          ],
        );
      },
    );
  }
} finally {
  await pool.end();
}
