import { createHash, randomUUID } from 'node:crypto';

import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createApplicationPool,
  FlightNormalizationRepository,
  ImportProcessingRepository,
  withOrganizationTransaction,
} from '@drone-works/database';
import { processingQueueName, ProcessingQueue } from '@drone-works/jobs';
import {
  PrivateParserIntermediate,
  validatePrivateIntermediate,
} from '@drone-works/parser';
import { encodeTelemetryV1, verifyTelemetryV1 } from '@drone-works/telemetry';

const alpha = {
  aircraftId: '00000000-0000-4000-8000-0000000000a4',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  pilotId: '00000000-0000-4000-8000-0000000000a3',
  userId: '00000000-0000-4000-8000-0000000000a2',
};
const beta = {
  organizationId: '00000000-0000-4000-8000-0000000000b1',
  pilotId: '00000000-0000-4000-8000-0000000000b3',
  userId: '00000000-0000-4000-8000-0000000000b2',
};

class GeneratedObjectStore {
  failNextPut = false;
  deleted = 0;
  puts = 0;
  objects = new Map();

  async putIfAbsent(key, content, mediaType, expectedSha256) {
    this.puts += 1;
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('generated object write failure');
    }
    const actual = createHash('sha256').update(content).digest('hex');
    if (actual !== expectedSha256)
      throw new Error('generated checksum mismatch');
    const existing = this.objects.get(key);
    if (existing) {
      if (existing.contentSha256 !== expectedSha256) {
        throw new Error('generated immutable key conflict');
      }
      return existing;
    }
    const stored = {
      body: Buffer.from(content),
      byteSize: content.byteLength,
      contentSha256: expectedSha256,
      mediaType,
      versionId: randomUUID(),
    };
    this.objects.set(key, stored);
    return stored;
  }

  async deleteExact(key, versionId) {
    const existing = this.objects.get(key);
    if (existing?.versionId === versionId) {
      this.objects.delete(key);
      this.deleted += 1;
    }
  }

  byVersion(versionId) {
    return [...this.objects.values()].find(
      (object) => object.versionId === versionId,
    );
  }
}

const databaseConfiguration = () => ({
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function intermediate(source, options = {}) {
  const operationalKey = options.operationalKey ?? source.sha256.slice(0, 8);
  const serials = options.serials ?? [`generated-aircraft-${operationalKey}`];
  const takeoff =
    options.takeoff ??
    `2026-01-${String(options.day ?? 2).padStart(2, '0')}T10:00:00+04:00`;
  const value = {
    schema_version: 1,
    kind: 'dji_parser_intermediate',
    parser: {
      id: 'dji-log-parser',
      version: '0.5.7-a10-generated',
      source_commit: '1'.repeat(40),
    },
    source: {
      sha256: source.sha256,
      bytes: source.bytes,
      format_family: 'dji_txt',
      format_version: 14,
    },
    flights: [
      {
        flight_index: 0,
        imported: {
          takeoff_time_utc: takeoff,
          declared_duration_ms: 60_000,
          declared_distance_m: 400.5,
          declared_max_height_m: 80.25,
          declared_max_horizontal_speed_mps: 12.5,
          declared_max_vertical_speed_mps: 3.25,
          aircraft_name: 'Generated Aircraft',
          aircraft_model: 'Generated Model',
          application_platform: 'generated',
          application_version: '1.0',
          identifiers: {
            aircraft_serials: [...serials].sort(),
            battery_serials: [`generated-battery-${operationalKey}`],
            camera_serials: [],
            controller_serials: [],
          },
        },
        capabilities: [
          'altitude',
          'attitude',
          'battery',
          'gps',
          'position',
          'signal',
          'velocity',
        ],
        sample_count: 2,
        samples: [
          {
            elapsed_ms: 0,
            position: { latitude_deg: 0.01, longitude_deg: 0.02 },
            altitude_msl_m: 10,
            height_agl_m: 0,
            velocity: { x_mps: 0, y_mps: 0, z_mps: 0 },
            attitude: { pitch_deg: 0, roll_deg: 0, yaw_deg: 0 },
            battery: {
              charge_percent: 100,
              current_a: null,
              temperature_c: 25,
              voltage_v: 16,
            },
            gps: { position_used: true, satellites: 12, signal_level: 5 },
            signal: { downlink_percent: 99, uplink_percent: 98 },
          },
          {
            elapsed_ms: 1_000,
            position: { latitude_deg: 0.011, longitude_deg: 0.021 },
            altitude_msl_m: 11,
            height_agl_m: 1,
            velocity: { x_mps: 1, y_mps: 0, z_mps: -0.1 },
            attitude: { pitch_deg: 1, roll_deg: 0, yaw_deg: 2 },
            battery: {
              charge_percent: 99,
              current_a: null,
              temperature_c: 25.1,
              voltage_v: 15.9,
            },
            gps: { position_used: true, satellites: 13, signal_level: 5 },
            signal: { downlink_percent: null, uplink_percent: 97 },
          },
        ],
      },
    ],
  };
  const validated = validatePrivateIntermediate(value, source);
  return new PrivateParserIntermediate(
    {
      boundary: {
        cpus: 1,
        memoryMb: 512,
        network: 'none',
        pidsLimit: 64,
        rootFilesystem: 'read_only',
        tmpfsMb: 32,
        user: '65532:65532',
        validated: true,
      },
      contract: { kind: 'dji_parser_intermediate', schemaVersion: 1 },
      material: {
        ...validated.shape,
        bytes: source.bytes,
        sha256: source.sha256,
        sourceHashVerified: true,
      },
      schemaVersion: 1,
      status: 'intermediate_ready',
      process: {
        exitCode: 0,
        oomKilled: false,
        stderrBytes: 0,
        stdoutBytes: 1_024,
        totalOutputBytes: 1_024,
        wallMs: 12,
      },
    },
    value,
  );
}

let appPool;
let store;
let sourceCounter = 0;
let retained;

async function createImport(organization, options = {}) {
  const itemId = randomUUID();
  const batchId = randomUUID();
  const rawSourceId = options.rawSourceId ?? randomUUID();
  const source = options.source ?? {
    bytes: 128,
    sha256: sha256(`generated-source-${sourceCounter++}`),
  };
  await withOrganizationTransaction(
    appPool,
    organization.organizationId,
    async (transaction) => {
      if (!options.rawSourceId) {
        await transaction.query(
          `INSERT INTO droneworks.raw_sources (
             organization_id, id, object_revision_id, content_sha256,
             byte_size, media_type, created_at
           ) VALUES ($1, $2, $3, $4, $5, 'application/octet-stream', now())`,
          [
            organization.organizationId,
            rawSourceId,
            randomUUID(),
            source.sha256,
            source.bytes,
          ],
        );
      }
      await transaction.query(
        `INSERT INTO droneworks.import_batches (
           organization_id, id, uploaded_by_user_id, state, created_at
         ) VALUES ($1, $2, $3, 'processing', now())`,
        [organization.organizationId, batchId, organization.userId],
      );
      await transaction.query(
        `INSERT INTO droneworks.import_items (
           organization_id, id, import_batch_id, raw_source_id,
           client_file_id, original_filename, state, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', now(), now())`,
        [
          organization.organizationId,
          itemId,
          batchId,
          rawSourceId,
          `generated-${itemId}`,
          'generated-flight.txt',
        ],
      );
    },
  );
  return { itemId, rawSourceId, source };
}

beforeAll(() => {
  appPool = createApplicationPool({
    ...databaseConfiguration(),
    max: 1,
    user: 'droneworks_app',
  });
  store = new GeneratedObjectStore();
});

afterAll(async () => {
  await appPool?.end();
});

describe.sequential('A10 canonical normalization and persistence', () => {
  it('encodes deterministic columnar telemetry and rejects checksum drift', () => {
    const source = { bytes: 128, sha256: 'a'.repeat(64) };
    const first = intermediate(source);
    let samples;
    return first.withValue((value) => {
      samples = value.flights[0].samples;
      const left = encodeTelemetryV1(samples);
      const right = encodeTelemetryV1(samples);
      expect(left.bytes.equals(right.bytes)).toBe(true);
      expect(left.bytes.readUInt32LE(4)).toBe(0);
      expect(left.bytes.readUInt8(9)).toBe(255);
      const decoded = verifyTelemetryV1(left.bytes, left.contentSha256);
      expect(decoded.columns.signal_downlink_percent).toEqual([99, null]);
      const tampered = Buffer.from(left.bytes);
      tampered[tampered.length - 1] ^= 1;
      expect(() => verifyTelemetryV1(tampered, left.contentSha256)).toThrow(
        'checksum',
      );
    });
  });

  it('persists one provenance-aware revision, creates an unseen stable aircraft, and converges on retry', async () => {
    const generated = await createImport(alpha);
    const metrics = [];
    const repository = new FlightNormalizationRepository({
      metrics: { observe: (metric) => metrics.push(metric) },
      objectStore: store,
      pool: appPool,
    });
    const result = await repository.process(
      alpha.organizationId,
      generated.itemId,
      intermediate(generated.source, {
        operationalKey: 'retained',
        serials: ['generated-unseen-stable'],
      }),
    );
    expect(result).toMatchObject({
      assignmentStatus: 'awaiting_pilot',
      outcome: 'awaiting_review',
      reason: 'review_required',
    });
    retained = { ...generated, flightId: result.canonicalFlightId };

    const evidence = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) => {
        const flight = await transaction.query(
          `SELECT pilot_profile_id, proposed_pilot_profile_id, aircraft_id,
                  assignment_status, state
             FROM droneworks.canonical_flights
            WHERE id = $1`,
          [result.canonicalFlightId],
        );
        const revision = await transaction.query(
          `SELECT facts, provenance, exact_normalized_version,
                  exact_normalized_fingerprint
             FROM droneworks.flight_revisions
            WHERE canonical_flight_id = $1`,
          [result.canonicalFlightId],
        );
        const telemetry = await transaction.query(
          `SELECT object_revision_id, content_sha256, codec, codec_version,
                  sample_count, first_elapsed_ms, last_elapsed_ms
             FROM droneworks.telemetry_objects
            WHERE flight_revision_id = (
              SELECT id FROM droneworks.flight_revisions
               WHERE canonical_flight_id = $1
            )`,
          [result.canonicalFlightId],
        );
        const identifiers = await transaction.query(
          `SELECT identifier_value, aircraft_id
             FROM droneworks.aircraft_identifiers
            WHERE identifier_value = 'generated-unseen-stable'`,
        );
        const audit = await transaction.query(
          `SELECT metadata
             FROM droneworks.audit_events
            WHERE resource_id = $1 AND action = 'normalization_completed'`,
          [generated.itemId],
        );
        return {
          audit: audit.rows[0],
          flight: flight.rows[0],
          identifiers: identifiers.rows,
          revision: revision.rows[0],
          telemetry: telemetry.rows[0],
        };
      },
    );
    expect(evidence.flight).toMatchObject({
      pilot_profile_id: null,
      proposed_pilot_profile_id: alpha.pilotId,
      assignment_status: 'awaiting_pilot',
      state: 'awaiting_review',
    });
    expect(evidence.identifiers).toHaveLength(1);
    expect(evidence.identifiers[0].aircraft_id).toBe(
      evidence.flight.aircraft_id,
    );
    expect(evidence.revision.exact_normalized_version).toBe(
      'exact-normalized-v1',
    );
    expect(evidence.revision.facts.duration_ms).toMatchObject({
      derived: null,
      user_override: null,
      effective: { origin: 'imported', value: 60_000 },
      imported: { value: 60_000 },
    });
    expect(evidence.revision.provenance.telemetry.origin).toBe('imported');
    const object = store.byVersion(evidence.telemetry.object_revision_id);
    expect(object).toBeDefined();
    expect(
      verifyTelemetryV1(object.body, evidence.telemetry.content_sha256)
        .sample_count,
    ).toBe(2);
    expect(evidence.telemetry).toMatchObject({
      codec: 'droneworks-columnar-json-gzip',
      codec_version: 1,
      sample_count: 2,
      first_elapsed_ms: '0',
      last_elapsed_ms: '1000',
    });
    const auditJson = JSON.stringify(evidence.audit.metadata);
    expect(auditJson).not.toContain('generated-unseen-stable');
    expect(auditJson).not.toContain(alpha.organizationId);
    expect(JSON.stringify(metrics)).not.toContain(alpha.organizationId);
    expect(metrics).toHaveLength(1);

    const beforeRetryPuts = store.puts;
    const retry = await repository.process(
      alpha.organizationId,
      generated.itemId,
      intermediate(generated.source, {
        operationalKey: 'retained',
        serials: ['generated-unseen-stable'],
      }),
    );
    expect(retry).toEqual(result);
    expect(store.puts).toBe(beforeRetryPuts);
  });

  it('uses known identity, waits on model-only evidence, and refuses ambiguous identity', async () => {
    const knownImport = await createImport(alpha);
    const repository = new FlightNormalizationRepository({
      objectStore: store,
      pool: appPool,
    });
    const known = await repository.process(
      alpha.organizationId,
      knownImport.itemId,
      intermediate(knownImport.source, {
        day: 3,
        operationalKey: 'known',
        serials: ['generated-aircraft-a'],
      }),
    );
    expect(known.assignmentStatus).toBe('awaiting_pilot');
    const knownAircraft = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) =>
        (
          await transaction.query(
            'SELECT aircraft_id FROM droneworks.canonical_flights WHERE id = $1',
            [known.canonicalFlightId],
          )
        ).rows[0].aircraft_id,
    );
    expect(knownAircraft).toBe(alpha.aircraftId);

    const modelOnlyImport = await createImport(alpha);
    const modelOnly = await repository.process(
      alpha.organizationId,
      modelOnlyImport.itemId,
      intermediate(modelOnlyImport.source, {
        day: 4,
        operationalKey: 'model-only',
        serials: [],
      }),
    );
    expect(modelOnly.assignmentStatus).toBe('awaiting_aircraft');

    const secondAircraftId = randomUUID();
    await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) => {
        await transaction.query(
          `INSERT INTO droneworks.aircraft (
             organization_id, id, display_name, created_at
           ) VALUES ($1, $2, 'Generated Ambiguous Aircraft', now())`,
          [alpha.organizationId, secondAircraftId],
        );
        await transaction.query(
          `INSERT INTO droneworks.aircraft_identifiers (
             organization_id, id, aircraft_id, identifier_type,
             identifier_value, reliability, provenance, created_at
           ) VALUES (
             $1, $2, $3, 'manufacturer_serial',
             'generated-ambiguous-second', 'stable', $4, now()
           )`,
          [
            alpha.organizationId,
            randomUUID(),
            secondAircraftId,
            { origin: 'generated' },
          ],
        );
      },
    );
    const ambiguousImport = await createImport(alpha);
    const ambiguous = await repository.process(
      alpha.organizationId,
      ambiguousImport.itemId,
      intermediate(ambiguousImport.source, {
        day: 5,
        operationalKey: 'ambiguous',
        serials: ['generated-aircraft-a', 'generated-ambiguous-second'],
      }),
    );
    expect(ambiguous.assignmentStatus).toBe('ambiguous_aircraft');
    const unresolved = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) =>
        (
          await transaction.query(
            'SELECT aircraft_id FROM droneworks.canonical_flights WHERE id = $1',
            [ambiguous.canonicalFlightId],
          )
        ).rows[0].aircraft_id,
    );
    expect(unresolved).toBeNull();
  });

  it('skips exact normalized and exact source re-uploads without a second flight', async () => {
    const repository = new FlightNormalizationRepository({
      objectStore: store,
      pool: appPool,
    });
    const normalizedImport = await createImport(alpha);
    const beforeNormalized = store.objects.size;
    const normalized = await repository.process(
      alpha.organizationId,
      normalizedImport.itemId,
      intermediate(normalizedImport.source, {
        operationalKey: 'retained',
        serials: ['generated-unseen-stable'],
      }),
    );
    expect(normalized).toEqual({
      assignmentStatus: null,
      canonicalFlightId: retained.flightId,
      outcome: 'skipped_duplicate',
      reason: 'exact_normalized',
    });
    expect(store.objects.size).toBe(beforeNormalized);
    const normalizedAttemptCount = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) =>
        (
          await transaction.query(
            `SELECT count(*)::integer AS count
               FROM droneworks.import_attempts
              WHERE import_item_id = $1
                AND state = 'succeeded'`,
            [normalizedImport.itemId],
          )
        ).rows[0].count,
    );
    expect(normalizedAttemptCount).toBe(1);

    const exactSourceImport = await createImport(alpha, {
      rawSourceId: retained.rawSourceId,
      source: retained.source,
    });
    const beforeSourcePuts = store.puts;
    const privateValue = intermediate(retained.source, {
      day: 20,
      operationalKey: 'unused-exact-source',
    });
    const exactSource = await repository.process(
      alpha.organizationId,
      exactSourceImport.itemId,
      privateValue,
    );
    expect(exactSource).toEqual({
      assignmentStatus: null,
      canonicalFlightId: retained.flightId,
      outcome: 'skipped_duplicate',
      reason: 'exact_source',
    });
    expect(privateValue.destroyed).toBe(true);
    expect(store.puts).toBe(beforeSourcePuts);
    const flightCount = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) =>
        (
          await transaction.query(
            `SELECT count(*)::integer AS count
               FROM droneworks.canonical_flights
              WHERE id = $1`,
            [retained.flightId],
          )
        ).rows[0].count,
    );
    expect(flightCount).toBe(1);
  });

  it('rolls back object and database work, then succeeds through the actual job retry', async () => {
    const generated = await createImport(alpha);
    const imports = new ImportProcessingRepository(appPool);
    let fail = true;
    const failingRepository = new FlightNormalizationRepository({
      beforeCommit: async () => {
        if (fail) {
          fail = false;
          throw new Error('generated transactional persistence failure');
        }
      },
      objectStore: store,
      pool: appPool,
    });
    const queue = await ProcessingQueue.start(databaseConfiguration(), {
      retryDelaySeconds: 0,
      retryLimit: 1,
      supervise: false,
    });
    const boss = new PgBoss({
      createSchema: false,
      ...databaseConfiguration(),
      schema: 'droneworks_jobs',
      schedule: false,
      supervise: false,
      user: 'droneworks_queue',
    });
    await boss.start();
    try {
      const jobId = await boss.send(
        processingQueueName,
        {
          importItemId: generated.itemId,
          organizationId: alpha.organizationId,
          schemaVersion: 1,
        },
        { retryDelay: 0, retryLimit: 1 },
      );
      const deletedBefore = store.deleted;
      await expect(
        queue.processNext(imports, async () =>
          failingRepository.process(
            alpha.organizationId,
            generated.itemId,
            intermediate(generated.source, {
              day: 6,
              operationalKey: 'job-retry',
            }),
          ),
        ),
      ).rejects.toThrow('transactional persistence failure');
      expect(store.deleted).toBe(deletedBefore + 1);
      const rolledBack = await withOrganizationTransaction(
        appPool,
        alpha.organizationId,
        async (transaction) =>
          (
            await transaction.query(
              'SELECT count(*)::integer AS count FROM droneworks.canonical_flights WHERE import_item_id = $1',
              [generated.itemId],
            )
          ).rows[0].count,
      );
      expect(rolledBack).toBe(0);

      let retried = null;
      for (let attempt = 0; attempt < 20 && !retried; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        retried = await queue.processNext(imports, async () =>
          failingRepository.process(
            alpha.organizationId,
            generated.itemId,
            intermediate(generated.source, {
              day: 6,
              operationalKey: 'job-retry',
            }),
          ),
        );
      }
      expect(retried).toEqual({ jobId, status: 'processed' });
      const persisted = await withOrganizationTransaction(
        appPool,
        alpha.organizationId,
        async (transaction) =>
          (
            await transaction.query(
              'SELECT count(*)::integer AS count FROM droneworks.canonical_flights WHERE import_item_id = $1',
              [generated.itemId],
            )
          ).rows[0].count,
      );
      expect(persisted).toBe(1);
    } finally {
      await boss.stop({ graceful: true, timeout: 5_000 });
      await queue.stop();
    }
  });

  it('retries a failed object write and keeps normalized identity organization-scoped on one pooled connection', async () => {
    const failedObjectImport = await createImport(alpha);
    const repository = new FlightNormalizationRepository({
      objectStore: store,
      pool: appPool,
    });
    store.failNextPut = true;
    await expect(
      repository.process(
        alpha.organizationId,
        failedObjectImport.itemId,
        intermediate(failedObjectImport.source, {
          day: 7,
          operationalKey: 'object-retry',
        }),
      ),
    ).rejects.toThrow('object write failure');
    const recovered = await repository.process(
      alpha.organizationId,
      failedObjectImport.itemId,
      intermediate(failedObjectImport.source, {
        day: 7,
        operationalKey: 'object-retry',
      }),
    );
    expect(recovered.outcome).toBe('awaiting_review');

    const betaImport = await createImport(beta);
    const betaResult = await repository.process(
      beta.organizationId,
      betaImport.itemId,
      intermediate(betaImport.source, {
        operationalKey: 'retained',
        serials: ['generated-unseen-stable'],
      }),
    );
    expect(betaResult.outcome).toBe('awaiting_review');
    expect(betaResult.canonicalFlightId).not.toBe(retained.flightId);
    const betaFlight = await withOrganizationTransaction(
      appPool,
      beta.organizationId,
      async (transaction) =>
        (
          await transaction.query(
            `SELECT proposed_pilot_profile_id, organization_id
               FROM droneworks.canonical_flights
              WHERE id = $1`,
            [betaResult.canonicalFlightId],
          )
        ).rows[0],
    );
    expect(betaFlight).toEqual({
      organization_id: beta.organizationId,
      proposed_pilot_profile_id: beta.pilotId,
    });
    const alphaCannotReadBeta = await withOrganizationTransaction(
      appPool,
      alpha.organizationId,
      async (transaction) =>
        (
          await transaction.query(
            'SELECT id FROM droneworks.canonical_flights WHERE id = $1',
            [betaResult.canonicalFlightId],
          )
        ).rowCount,
    );
    expect(alphaCannotReadBeta).toBe(0);
    const cleared = await appPool.query(
      `SELECT current_setting('app.organization_id', true) AS organization_id,
              (SELECT count(*)::integer FROM droneworks.canonical_flights) AS count`,
    );
    expect([null, '']).toContain(cleared.rows[0].organization_id);
    expect(cleared.rows[0].count).toBe(0);
  });
});
