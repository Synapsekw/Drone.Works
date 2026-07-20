import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createApplicationPool,
  FlightReadRepository,
  withOrganizationTransaction,
} from '@drone-works/database';
import {
  downsampleTelemetryV1,
  encodeTelemetryV1,
  verifyTelemetryV1,
} from '@drone-works/telemetry';

import { buildApi } from '../src/app.js';
import {
  generatedPersonas,
  GeneratedPersonaIdentitySource,
} from '../src/identity.js';
import { LoopbackImmutableObjectStore } from '../src/loopback-object-store.js';

const alpha = {
  flightId: '00000000-0000-4000-8000-0000000000aa',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  revisionId: '20000000-0000-4000-8000-0000000000ab',
  telemetryId: '20000000-0000-4000-8000-0000000000ac',
};
const beta = {
  organizationId: '00000000-0000-4000-8000-0000000000b1',
};
const alphaReview = {
  flightId: '40000000-0000-4000-8000-0000000000aa',
  revisionId: '40000000-0000-4000-8000-0000000000ab',
};
const privateMarker = 'generated-private-provenance-marker';
const telemetryCapabilities = [
  'telemetry.altitude',
  'telemetry.battery',
  'telemetry.gps',
  'telemetry.position',
  'telemetry.signal',
  'telemetry.velocity',
];

const databaseConfiguration = () => ({
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
});

function fact(value) {
  return {
    base_preference: ['imported'],
    derived: null,
    effective: {
      origin: value === null ? 'unavailable' : 'imported',
      value,
    },
    imported: {
      value,
      provenance: {
        origin: 'imported',
        raw_source_id: privateMarker,
        source_sha256: '9'.repeat(64),
        intermediate_path: privateMarker,
        parser: { id: privateMarker, version: privateMarker },
      },
    },
    user_override: null,
  };
}

function generatedSamples() {
  return Array.from({ length: 2_505 }, (_, index) => {
    const positionGap = index >= 1_200 && index <= 1_202;
    const signalGap = index >= 800 && index <= 805;
    return {
      elapsed_ms: index * 200,
      position: positionGap
        ? null
        : {
            latitude_deg: 0.01 + index / 1_000_000,
            longitude_deg: 0.02 + index / 1_000_000,
          },
      altitude_msl_m: index === 123 ? 500 : 10 + (index % 50),
      height_agl_m: index % 100,
      velocity: {
        x_mps: index % 20,
        y_mps: index % 7,
        z_mps: index === 1_500 ? -8 : (index % 5) - 2,
      },
      attitude: { pitch_deg: 0, roll_deg: 0, yaw_deg: index % 360 },
      battery: {
        charge_percent: index === 1_777 ? 5 : 100 - (index % 80),
        current_a: null,
        temperature_c: 25,
        voltage_v: 16,
      },
      gps: { position_used: !positionGap, satellites: 12, signal_level: 5 },
      signal: signalGap ? null : { downlink_percent: 99, uplink_percent: 98 },
    };
  });
}

function tokenHeader(token) {
  return { 'x-drone-works-local-persona-token': token };
}

let api;
let appPool;
let encoded;
let metrics;
let objectReads = 0;
let ownerToken;
let betaToken;
let corruptNextRead = false;
let removedToken;
const roleTokens = new Map();

beforeAll(async () => {
  appPool = createApplicationPool({
    ...databaseConfiguration(),
    max: 1,
    user: 'droneworks_app',
  });
  encoded = encodeTelemetryV1(generatedSamples());
  const baseStore = new LoopbackImmutableObjectStore(
    process.env.OBJECT_INTERNAL_URL,
  );
  const key = `organizations/${alpha.organizationId}/flight-revisions/${alpha.revisionId}/telemetry-v1`;
  const stored = await baseStore.putIfAbsent(
    key,
    encoded.bytes,
    encoded.mediaType,
    encoded.contentSha256,
  );
  await withOrganizationTransaction(
    appPool,
    alpha.organizationId,
    async (transaction) => {
      for (const [persona, role] of [
        ['alpha_admin', 'admin'],
        ['alpha_pilot', 'pilot'],
        ['alpha_viewer', 'viewer'],
      ]) {
        await transaction.query(
          `INSERT INTO droneworks.memberships (
             organization_id, user_id, role, created_at
           ) VALUES ($1, $2, $3, now())`,
          [alpha.organizationId, generatedPersonas[persona].userId, role],
        );
      }
      await transaction.query(
        `INSERT INTO droneworks.flight_revisions (
           organization_id, id, canonical_flight_id, import_attempt_id,
           revision_number, canonical_schema_version, facts, capabilities,
           exact_normalized_fingerprint, exact_normalized_version,
           fingerprint_status, provenance, created_at
         ) VALUES (
           $1, $2, $3, NULL, 2, 1, $4, $5, $6,
           'exact-normalized-v1', 'eligible', $7, now()
         )`,
        [
          alpha.organizationId,
          alpha.revisionId,
          alpha.flightId,
          {
            aircraft_model: fact('Generated Model'),
            aircraft_name: fact('Generated Aircraft'),
            application_platform: fact('generated'),
            application_version: fact('1.0'),
            distance_m: fact(400.5),
            duration_ms: fact(500_800),
            max_height_m: fact(500),
            max_horizontal_speed_mps: fact(20),
            max_vertical_speed_mps: fact(8),
            takeoff_time_utc: fact('2026-07-16T01:00:00.000Z'),
          },
          telemetryCapabilities,
          createHash('sha256').update('generated-a11-current').digest('hex'),
          {
            object_key: privateMarker,
            parser: privateMarker,
            raw_source_id: privateMarker,
          },
        ],
      );
      await transaction.query(
        `INSERT INTO droneworks.telemetry_objects (
           organization_id, id, flight_revision_id, object_revision_id,
           codec, codec_version, content_sha256, sample_count,
           first_elapsed_ms, last_elapsed_ms, capabilities, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [
          alpha.organizationId,
          alpha.telemetryId,
          alpha.revisionId,
          stored.versionId,
          encoded.codec,
          encoded.codecVersion,
          encoded.contentSha256,
          encoded.sampleCount,
          encoded.firstElapsedMs,
          encoded.lastElapsedMs,
          telemetryCapabilities,
        ],
      );
      await transaction.query(
        `INSERT INTO droneworks.canonical_flights (
           organization_id, id, import_item_id, pilot_profile_id, aircraft_id,
           source_kind, state, takeoff_at, takeoff_timezone, duration_ms,
           assignment_status, created_at, updated_at
         ) VALUES (
           $1, $2, NULL, $3, NULL, 'manual', 'awaiting_review', $4,
           'Asia/Dubai', 120000, 'awaiting_aircraft', $4, $4
         )`,
        [
          alpha.organizationId,
          alphaReview.flightId,
          '00000000-0000-4000-8000-0000000000a3',
          '2026-07-17T01:00:00.000Z',
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
           'exact-normalized-v1', 'insufficient_evidence', '{}', $5
         )`,
        [
          alpha.organizationId,
          alphaReview.revisionId,
          alphaReview.flightId,
          {
            aircraft_model: fact('Needs assignment'),
            aircraft_name: fact(null),
            application_platform: fact('manual'),
            application_version: fact(null),
            distance_m: fact(50),
            duration_ms: fact(120_000),
            max_height_m: fact(10),
            max_horizontal_speed_mps: fact(null),
            max_vertical_speed_mps: fact(null),
            takeoff_time_utc: fact('2026-07-17T01:00:00.000Z'),
          },
          '2026-07-17T01:00:00.000Z',
        ],
      );
    },
  );

  metrics = [];
  const readStore = {
    async getExact(objectKey, versionId) {
      objectReads += 1;
      const body = await baseStore.getExact(objectKey, versionId);
      if (!body || !corruptNextRead) return body;
      corruptNextRead = false;
      const corrupted = Buffer.from(body);
      corrupted[corrupted.length - 1] ^= 1;
      return corrupted;
    },
  };
  const identitySource = new GeneratedPersonaIdentitySource();
  ownerToken = identitySource.issue('alpha_owner');
  betaToken = identitySource.issue('beta_owner');
  removedToken = identitySource.issue('alpha_removed_member');
  for (const persona of ['alpha_admin', 'alpha_pilot', 'alpha_viewer']) {
    roleTokens.set(persona, identitySource.issue(persona));
  }
  const built = await buildApi({
    environment: {
      DRONE_WORKS_ENV: 'test',
      HOST: '127.0.0.1',
      LOCAL_IDENTITY_ENABLED: true,
      PORT: 1,
    },
    flights: new FlightReadRepository({
      metrics: { observe: (metric) => metrics.push(metric) },
      objectStore: readStore,
      pool: appPool,
    }),
    identitySource,
  });
  api = built.app;
});

afterAll(async () => {
  await api?.close();
  await appPool?.end();
});

describe.sequential('A11 organization-authorized flight API', () => {
  it('lists current flights with totals, search, filters, and bounded cursor pages', async () => {
    const first = await api.inject({
      headers: tokenHeader(ownerToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights?limit=1`,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.json()).toMatchObject({
      items: [
        {
          flight_id: alphaReview.flightId,
          state: 'awaiting_review',
          pilot_display_name: 'Generated Pilot A',
          aircraft_display_name: null,
        },
      ],
      totals: {
        active_flights: 1,
        awaiting_review: 1,
        total_distance_m: 450.5,
        total_duration_ms: 620_800,
      },
    });
    expect(first.json().next_cursor).not.toBeNull();

    const second = await api.inject({
      headers: tokenHeader(ownerToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights?limit=1&cursor=${first.json().next_cursor}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().items[0]).toMatchObject({
      flight_id: alpha.flightId,
      state: 'active',
      pilot_display_name: 'Generated Pilot A',
      aircraft_display_name: 'Generated Aircraft A',
    });
    expect(second.json().next_cursor).toBeNull();

    const filtered = await api.inject({
      headers: tokenHeader(ownerToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights?state=active&search=Aircraft`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items.map((item) => item.flight_id)).toEqual([
      alpha.flightId,
    ]);
    expect(JSON.stringify(metrics)).not.toContain(alpha.organizationId);
    expect(objectReads).toBe(0);
  });

  it('serves the current revision summary to every organization role without private metadata', async () => {
    const tokens = [ownerToken, ...roleTokens.values()];
    for (const token of tokens) {
      const response = await api.inject({
        headers: tokenHeader(token),
        method: 'GET',
        url: `/api/v1/organizations/${alpha.organizationId}/flights/${alpha.flightId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.json()).toMatchObject({
        flight_id: alpha.flightId,
        revision_number: 2,
        capabilities: telemetryCapabilities,
        facts: {
          distance_m: { origin: 'imported', value: 400.5 },
          duration_ms: { origin: 'imported', value: 500_800 },
          takeoff_time_utc: {
            origin: 'imported',
            value: '2026-07-16T01:00:00.000Z',
          },
        },
        telemetry: {
          sample_count: 2_505,
          first_elapsed_ms: 0,
          last_elapsed_ms: 500_800,
        },
      });
      const publicJson = response.body;
      for (const forbidden of [
        privateMarker,
        'object_revision_id',
        'content_sha256',
        'codec_version',
        'raw_source_id',
        'source_sha256',
        'intermediate_path',
        'provenance',
      ]) {
        expect(publicJson).not.toContain(forbidden);
      }
    }
    expect(objectReads).toBe(0);
  });

  it('makes Alpha exact-ID denial indistinguishable in Beta and removed-member contexts', async () => {
    const beforeReads = objectReads;
    const betaList = await api.inject({
      headers: tokenHeader(betaToken),
      method: 'GET',
      url: `/api/v1/organizations/${beta.organizationId}/flights`,
    });
    expect(betaList.statusCode).toBe(200);
    expect(betaList.body).not.toContain(alpha.flightId);
    expect(betaList.body).not.toContain(alphaReview.flightId);
    const betaSummary = await api.inject({
      headers: tokenHeader(betaToken),
      method: 'GET',
      url: `/api/v1/organizations/${beta.organizationId}/flights/${alpha.flightId}`,
    });
    const betaExact = await api.inject({
      headers: tokenHeader(betaToken),
      method: 'GET',
      url: `/api/v1/organizations/${beta.organizationId}/flights/${alpha.flightId}/track`,
    });
    const betaUnknown = await api.inject({
      headers: tokenHeader(betaToken),
      method: 'GET',
      url: `/api/v1/organizations/${beta.organizationId}/flights/30000000-0000-4000-8000-000000000001/track`,
    });
    expect(betaSummary.statusCode).toBe(404);
    expect(betaExact.statusCode).toBe(404);
    expect(betaExact.json()).toMatchObject({
      title: 'Not Found',
      status: 404,
      detail: 'The requested organization resource was not found.',
    });
    expect(betaUnknown.json()).toMatchObject({
      title: 'Not Found',
      status: 404,
      detail: 'The requested organization resource was not found.',
    });
    expect(objectReads).toBe(beforeReads);

    const removed = await api.inject({
      headers: tokenHeader(removedToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights/${alpha.flightId}`,
    });
    expect(removed.statusCode).toBe(404);
    const removedList = await api.inject({
      headers: tokenHeader(removedToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights`,
    });
    expect(removedList.statusCode).toBe(404);
  });

  it('returns one deterministic significant track with endpoints, extrema, and explicit gap boundaries', async () => {
    const request = {
      headers: tokenHeader(ownerToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights/${alpha.flightId}/track`,
    };
    const first = await api.inject(request);
    const second = await api.inject(request);
    expect(first.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
    expect(first.headers['cache-control']).toBe('private, no-store');
    const body = first.json();
    expect(body.mode).toBe('default');
    expect(body.source_sample_count).toBe(2_505);
    expect(body.returned_sample_count).toBeLessThanOrEqual(1_000);
    expect(body.samples[0].sample_index).toBe(0);
    expect(body.samples.at(-1).sample_index).toBe(2_504);
    const indexes = new Set(body.samples.map((sample) => sample.sample_index));
    for (const significantIndex of [123, 1_199, 1_200, 1_202, 1_203, 1_777]) {
      expect(indexes.has(significantIndex)).toBe(true);
    }
    expect(
      body.samples.find((sample) => sample.sample_index === 1_200).position,
    ).toBeNull();
    expect(body.statistics.altitude_msl_m.maximum).toBe(500);
    expect(body.statistics.battery_charge_percent.minimum).toBe(5);
    expect(body.preserved_gap_transition_count).toBe(body.gap_transition_count);
    const publicJson = first.body;
    expect(publicJson).not.toContain('content_sha256');
    expect(publicJson).not.toContain('object_revision_id');
  });

  it('pages the full exact object deterministically within the 2,000-sample ceiling', async () => {
    const page = async (suffix) =>
      api.inject({
        headers: tokenHeader(ownerToken),
        method: 'GET',
        url: `/api/v1/organizations/${alpha.organizationId}/flights/${alpha.flightId}/track?mode=full&limit=1000${suffix}`,
      });
    const first = await page('');
    expect(first.statusCode).toBe(200);
    expect(first.json().samples).toHaveLength(1_000);
    expect(first.json().samples[0].sample_index).toBe(0);
    expect(first.json().gap_transition_count).toBe(4);
    expect(first.json().preserved_gap_transition_count).toBe(2);
    const second = await page(`&cursor=${first.json().next_cursor}`);
    expect(second.json().samples).toHaveLength(1_000);
    expect(second.json().samples[0].sample_index).toBe(1_000);
    expect(second.json().preserved_gap_transition_count).toBe(2);
    const third = await page(`&cursor=${second.json().next_cursor}`);
    expect(third.json().samples).toHaveLength(505);
    expect(third.json().samples.at(-1).sample_index).toBe(2_504);
    expect(third.json().next_cursor).toBeNull();

    const repeated = await page(`&cursor=${first.json().next_cursor}`);
    expect(repeated.body).toBe(second.body);
    const oversized = await api.inject({
      headers: tokenHeader(ownerToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights/${alpha.flightId}/track?mode=full&limit=2001`,
    });
    expect(oversized.statusCode).toBe(400);
    const staleCursor = Buffer.from('1:1:1000').toString('base64url');
    const stale = await page(`&cursor=${staleCursor}`);
    expect(stale.statusCode).toBe(400);
  });

  it('rejects checksum drift with one redacted service error and payload-free metrics', async () => {
    corruptNextRead = true;
    const response = await api.inject({
      headers: tokenHeader(ownerToken),
      method: 'GET',
      url: `/api/v1/organizations/${alpha.organizationId}/flights/${alpha.flightId}/track`,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      title: 'Service Unavailable',
      status: 503,
      detail: 'The flight telemetry is temporarily unavailable.',
    });
    expect(response.body).not.toContain('checksum');
    expect(response.json().detail).not.toContain(alpha.organizationId);
    expect(JSON.stringify(metrics)).not.toContain(alpha.organizationId);
    expect(JSON.stringify(metrics)).not.toContain(alpha.flightId);
    expect(metrics.some((metric) => metric.objectOutcome === 'invalid')).toBe(
      true,
    );
  });

  it('retains reference downsampling behavior and clears organization context on the reused backend', async () => {
    const decoded = verifyTelemetryV1(encoded.bytes, encoded.contentSha256);
    const selected = downsampleTelemetryV1(decoded);
    expect(selected.version).toBe('significant-v1');
    expect(selected.samples).toHaveLength(1_000);
    expect(selected.statistics.altitude_msl_m.maximum).toBe(500);
    expect(selected.statistics.battery_charge_percent.minimum).toBe(5);
    expect(selected.samples[0].sample_index).toBe(0);
    expect(selected.samples.at(-1).sample_index).toBe(2_504);

    const context = await appPool.query(
      "SELECT current_setting('app.organization_id', true) AS organization_id",
    );
    expect(context.rows[0].organization_id).toBe('');
  });
});
