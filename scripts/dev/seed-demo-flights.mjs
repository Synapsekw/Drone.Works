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
    const stored = await storeTelemetry(seed);
    await withOrganizationTransaction(
      pool,
      seed.organizationId,
      async (transaction) => {
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
      },
    );
  }
} finally {
  await pool.end();
}
