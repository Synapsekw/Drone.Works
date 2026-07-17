import { createHash } from 'node:crypto';

import {
  exactNormalizedFingerprintVersion,
  normalizeCanonicalFlightV1,
  type CanonicalFlightV1,
} from '@drone-works/domain';
import {
  validatePrivateIntermediate,
  type PrivateParserIntermediate,
  type PrivateIntermediateValue,
} from '@drone-works/parser';
import {
  encodeTelemetryV1,
  type EncodedTelemetryV1,
} from '@drone-works/telemetry';

import {
  withOrganizationTransaction,
  type OrganizationPool,
  type OrganizationTransaction,
} from './organization-transaction.js';

export interface StoredImmutableObject {
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly mediaType: string;
  readonly versionId: string;
}

export interface TelemetryObjectStore {
  deleteExact(key: string, versionId: string): Promise<void>;
  putIfAbsent(
    key: string,
    content: Buffer,
    mediaType: string,
    expectedSha256: string,
  ): Promise<StoredImmutableObject>;
}

export type NormalizationOutcome =
  'awaiting_review' | 'completed' | 'skipped_duplicate';

export interface NormalizationResult {
  readonly assignmentStatus:
    | 'assigned'
    | 'awaiting_aircraft'
    | 'awaiting_pilot'
    | 'awaiting_time'
    | 'ambiguous_aircraft'
    | null;
  readonly canonicalFlightId: string;
  readonly outcome: NormalizationOutcome;
  readonly reason:
    | 'assignments_resolved'
    | 'exact_normalized'
    | 'exact_source'
    | 'review_required';
}

export interface NormalizationMetric {
  readonly normalizationMs: number;
  readonly outcome: NormalizationOutcome;
  readonly parserMs: number;
  readonly persistMs: number;
  readonly sampleCount: number;
  readonly schemaVersion: 1;
}

export interface NormalizationMetricsSink {
  observe(metric: NormalizationMetric): void;
}

interface ProcessingContext {
  readonly byteSize: number;
  readonly defaultTimezone: string;
  readonly exactSourceFlightId: string | null;
  readonly existing: NormalizationResult | null;
  readonly rawSourceId: string;
  readonly sourceSha256: string;
  readonly uploadedByUserId: string;
}

interface PersistenceResult extends NormalizationResult {
  readonly telemetryReferenced: boolean;
}

interface AircraftResolution {
  readonly aircraftId: string | null;
  readonly assignmentStatus:
    'awaiting_aircraft' | 'ambiguous_aircraft' | 'assigned';
  readonly provenance: Readonly<Record<string, unknown>> | null;
}

interface FlightRow {
  readonly assignment_status: NormalizationResult['assignmentStatus'];
  readonly id: string;
  readonly state: 'active' | 'awaiting_review';
}

interface ImportRow {
  readonly byte_size: string;
  readonly default_timezone: string;
  readonly duplicate_of_flight_id: string | null;
  readonly outcome_reason: string | null;
  readonly raw_source_id: string;
  readonly result_flight_id: string | null;
  readonly source_sha256: string;
  readonly state: string;
  readonly uploaded_by_user_id: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stableUuid(namespace: string, ...values: readonly string[]): string {
  const bytes = createHash('sha256')
    .update([namespace, ...values].join('\0'))
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireUuid(value: string, name: string): string {
  if (!uuidPattern.test(value)) throw new TypeError(`${name} must be a UUID.`);
  return value.toLowerCase();
}

function objectKey(organizationId: string, revisionId: string): string {
  return `organizations/${organizationId}/flight-revisions/${revisionId}/telemetry-v1`;
}

function importedValue(flight: CanonicalFlightV1, name: string): unknown {
  return flight.facts[name]?.imported.value ?? null;
}

function existingResult(row: ImportRow): NormalizationResult | null {
  const canonicalFlightId = row.result_flight_id ?? row.duplicate_of_flight_id;
  if (!canonicalFlightId) return null;
  if (row.state === 'skipped_duplicate') {
    return {
      assignmentStatus: null,
      canonicalFlightId,
      outcome: 'skipped_duplicate',
      reason:
        row.outcome_reason === 'exact_source'
          ? 'exact_source'
          : 'exact_normalized',
    };
  }
  return null;
}

async function importRow(
  transaction: OrganizationTransaction,
  importItemId: string,
): Promise<ImportRow> {
  const result = await transaction.query<ImportRow>(
    `SELECT item.state,
            item.raw_source_id,
            item.result_flight_id,
            item.duplicate_of_flight_id,
            item.outcome_reason,
            source.content_sha256 AS source_sha256,
            source.byte_size,
            batch.uploaded_by_user_id,
            organization.default_timezone
       FROM droneworks.import_items AS item
       JOIN droneworks.raw_sources AS source
         ON (source.organization_id, source.id) =
            (item.organization_id, item.raw_source_id)
       JOIN droneworks.import_batches AS batch
         ON (batch.organization_id, batch.id) =
            (item.organization_id, item.import_batch_id)
       JOIN droneworks.organizations AS organization
         ON organization.id = item.organization_id
      WHERE item.organization_id = $1
        AND item.id = $2`,
    [transaction.organizationId, importItemId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The organization-owned import is unavailable.');
  return row;
}

async function exactSourceFlight(
  transaction: OrganizationTransaction,
  importItemId: string,
  rawSourceId: string,
): Promise<string | null> {
  const result = await transaction.query<{ readonly id: string }>(
    `SELECT flight.id
       FROM droneworks.canonical_flights AS flight
       JOIN droneworks.import_items AS retained_item
         ON (retained_item.organization_id, retained_item.id) =
            (flight.organization_id, flight.import_item_id)
      WHERE flight.organization_id = $1
        AND retained_item.raw_source_id = $2
        AND retained_item.id <> $3
        AND flight.state <> 'deleted'
      ORDER BY flight.created_at, flight.id
      LIMIT 1`,
    [transaction.organizationId, rawSourceId, importItemId],
  );
  return result.rows[0]?.id ?? null;
}

async function loadContext(
  pool: OrganizationPool,
  organizationId: string,
  importItemId: string,
): Promise<ProcessingContext> {
  return withOrganizationTransaction(
    pool,
    organizationId,
    async (transaction) => {
      const row = await importRow(transaction, importItemId);
      let existing = existingResult(row);
      if (row.result_flight_id) {
        const result = await transaction.query<FlightRow>(
          `SELECT id, state, assignment_status
           FROM droneworks.canonical_flights
          WHERE organization_id = $1
            AND id = $2`,
          [transaction.organizationId, row.result_flight_id],
        );
        const flight = result.rows[0];
        if (flight) {
          existing = {
            assignmentStatus: flight.assignment_status,
            canonicalFlightId: flight.id,
            outcome:
              flight.state === 'active' ? 'completed' : 'awaiting_review',
            reason:
              flight.state === 'active'
                ? 'assignments_resolved'
                : 'review_required',
          };
        }
      }
      return {
        byteSize: Number(row.byte_size),
        defaultTimezone: row.default_timezone,
        exactSourceFlightId: await exactSourceFlight(
          transaction,
          importItemId,
          row.raw_source_id,
        ),
        existing,
        rawSourceId: row.raw_source_id,
        sourceSha256: row.source_sha256,
        uploadedByUserId: row.uploaded_by_user_id,
      };
    },
  );
}

async function recordExactSource(
  pool: OrganizationPool,
  organizationId: string,
  importItemId: string,
  flightId: string,
): Promise<NormalizationResult> {
  return withOrganizationTransaction(
    pool,
    organizationId,
    async (transaction) => {
      await transaction.query(
        `UPDATE droneworks.import_items
          SET state = 'skipped_duplicate',
              duplicate_of_flight_id = $3,
              outcome_reason = 'exact_source',
              updated_at = now()
        WHERE organization_id = $1
          AND id = $2`,
        [transaction.organizationId, importItemId, flightId],
      );
      await writeAudit(transaction, importItemId, 'skipped_duplicate', {
        outcome: 'skipped_duplicate',
        reason: 'exact_source',
        schema_version: 1,
      });
      return {
        assignmentStatus: null,
        canonicalFlightId: flightId,
        outcome: 'skipped_duplicate',
        reason: 'exact_source',
      };
    },
  );
}

async function resolveAircraft(
  transaction: OrganizationTransaction,
  flight: CanonicalFlightV1,
  now: Date,
): Promise<AircraftResolution> {
  const values = flight.aircraft_identifiers.map((item) => item.value).sort();
  if (values.length === 0) {
    return {
      aircraftId: null,
      assignmentStatus: 'awaiting_aircraft',
      provenance: null,
    };
  }
  await transaction.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [
      `${transaction.organizationId}:aircraft-identifiers:${JSON.stringify(values)}`,
    ],
  );
  const matches = await transaction.query<{ readonly aircraft_id: string }>(
    `SELECT DISTINCT aircraft_id
       FROM droneworks.aircraft_identifiers
      WHERE organization_id = $1
        AND identifier_type = 'manufacturer_serial'
        AND identifier_value = ANY($2::text[])
      ORDER BY aircraft_id`,
    [transaction.organizationId, values],
  );
  if (matches.rows.length > 1) {
    return {
      aircraftId: null,
      assignmentStatus: 'ambiguous_aircraft',
      provenance: null,
    };
  }
  if (matches.rows[0]) {
    return {
      aircraftId: matches.rows[0].aircraft_id,
      assignmentStatus: 'assigned',
      provenance: {
        evidence_count: values.length,
        matcher_version: 'aircraft-serial-v1',
        origin: 'asset_match',
        result: 'known_aircraft',
      },
    };
  }

  const aircraftId = stableUuid(
    'droneworks-aircraft-v1',
    transaction.organizationId,
    ...values,
  );
  const importedName = importedValue(flight, 'aircraft_name');
  const importedModel = importedValue(flight, 'aircraft_model');
  const displayName =
    typeof importedName === 'string' && importedName.trim()
      ? importedName.trim()
      : typeof importedModel === 'string' && importedModel.trim()
        ? importedModel.trim()
        : 'Imported aircraft';
  await transaction.query(
    `INSERT INTO droneworks.aircraft (
       organization_id, id, display_name, manufacturer, model, created_at
     ) VALUES ($1, $2, $3, 'DJI', $4, $5)`,
    [
      transaction.organizationId,
      aircraftId,
      displayName,
      typeof importedModel === 'string' ? importedModel : null,
      now,
    ],
  );
  for (const identifier of flight.aircraft_identifiers) {
    await transaction.query(
      `INSERT INTO droneworks.aircraft_identifiers (
         organization_id, id, aircraft_id, identifier_type,
         identifier_value, reliability, provenance, created_at
       ) VALUES ($1, $2, $3, 'manufacturer_serial', $4, 'stable', $5, $6)`,
      [
        transaction.organizationId,
        stableUuid(
          'droneworks-aircraft-identifier-v1',
          transaction.organizationId,
          identifier.value,
        ),
        aircraftId,
        identifier.value,
        identifier.provenance,
        now,
      ],
    );
  }
  return {
    aircraftId,
    assignmentStatus: 'assigned',
    provenance: {
      evidence_count: values.length,
      matcher_version: 'aircraft-serial-v1',
      origin: 'asset_match',
      result: 'created_from_stable_identifier',
    },
  };
}

async function pilotProposal(
  transaction: OrganizationTransaction,
  uploadedByUserId: string,
): Promise<string | null> {
  const result = await transaction.query<{ readonly id: string }>(
    `SELECT id
       FROM droneworks.pilot_profiles
      WHERE organization_id = $1
        AND membership_user_id = $2
        AND active = true`,
    [transaction.organizationId, uploadedByUserId],
  );
  return result.rows[0]?.id ?? null;
}

async function writeAudit(
  transaction: OrganizationTransaction,
  resourceId: string,
  action: string,
  metadata: Readonly<Record<string, unknown>>,
): Promise<void> {
  await transaction.query(
    `INSERT INTO droneworks.audit_events (
       organization_id, id, actor_kind, action, resource_type, resource_id,
       changed_fields, metadata, occurred_at
     ) VALUES ($1, $2, 'system', $3, 'import_item', $4, $5, $6, now())
     ON CONFLICT (organization_id, id) DO NOTHING`,
    [
      transaction.organizationId,
      stableUuid(
        'droneworks-normalization-audit-v1',
        transaction.organizationId,
        resourceId,
        action,
      ),
      action,
      resourceId,
      ['state'],
      metadata,
    ],
  );
}

async function telemetryVersionReferenced(
  pool: OrganizationPool,
  organizationId: string,
  versionId: string,
): Promise<boolean> {
  return withOrganizationTransaction(
    pool,
    organizationId,
    async (transaction) => {
      const result = await transaction.query(
        `SELECT 1
         FROM droneworks.telemetry_objects
        WHERE organization_id = $1
          AND object_revision_id = $2`,
        [transaction.organizationId, versionId],
      );
      return result.rowCount === 1;
    },
  );
}

function processingIdentity(
  organizationId: string,
  importItemId: string,
  intermediate: PrivateIntermediateValue,
): {
  attemptId: string;
  canonicalFlightId: string;
  processingRevisionId: string;
  revisionId: string;
  telemetryId: string;
} {
  const parser = `${intermediate.parser.id}:${intermediate.parser.version}:${intermediate.parser.source_commit}`;
  const attemptId = stableUuid(
    'droneworks-processing-attempt-v1',
    organizationId,
    importItemId,
    parser,
    intermediate.source.sha256,
  );
  const processingRevisionId = stableUuid(
    'droneworks-processing-revision-v1',
    attemptId,
  );
  const canonicalFlightId = stableUuid(
    'droneworks-canonical-flight-v1',
    organizationId,
    importItemId,
    '0',
  );
  const revisionId = stableUuid(
    'droneworks-flight-revision-v1',
    canonicalFlightId,
    processingRevisionId,
  );
  return {
    attemptId,
    canonicalFlightId,
    processingRevisionId,
    revisionId,
    telemetryId: stableUuid('droneworks-telemetry-v1', revisionId),
  };
}

export class FlightNormalizationRepository {
  readonly #beforeCommit: (() => Promise<void>) | undefined;
  readonly #metrics: NormalizationMetricsSink | undefined;
  readonly #objectStore: TelemetryObjectStore;
  readonly #pool: OrganizationPool;

  constructor(
    input: Readonly<{
      beforeCommit?: () => Promise<void>;
      metrics?: NormalizationMetricsSink;
      objectStore: TelemetryObjectStore;
      pool: OrganizationPool;
    }>,
  ) {
    this.#beforeCommit = input.beforeCommit;
    this.#metrics = input.metrics;
    this.#objectStore = input.objectStore;
    this.#pool = input.pool;
  }

  async process(
    organizationId: string,
    importItemId: string,
    intermediate: PrivateParserIntermediate,
  ): Promise<NormalizationResult> {
    const requiredOrganizationId = requireUuid(
      organizationId,
      'organizationId',
    );
    const requiredImportItemId = requireUuid(importItemId, 'importItemId');
    const context = await loadContext(
      this.#pool,
      requiredOrganizationId,
      requiredImportItemId,
    );
    if (context.existing && context.existing.outcome !== 'skipped_duplicate') {
      intermediate.destroy();
      return context.existing;
    }
    if (context.exactSourceFlightId) {
      intermediate.destroy();
      return recordExactSource(
        this.#pool,
        requiredOrganizationId,
        requiredImportItemId,
        context.exactSourceFlightId,
      );
    }

    const normalizationStarted = performance.now();
    const prepared: {
      readonly encoded: EncodedTelemetryV1;
      readonly flight: CanonicalFlightV1;
      readonly identity: ReturnType<typeof processingIdentity>;
      readonly parserRevision: string;
    } = await intermediate.withValue(async (value) => {
      validatePrivateIntermediate(value, {
        bytes: context.byteSize,
        sha256: context.sourceSha256,
      });
      if (value.flights.length !== 1) {
        throw new TypeError(
          'A10 processing requires exactly one parsed flight.',
        );
      }
      const identity = processingIdentity(
        requiredOrganizationId,
        requiredImportItemId,
        value,
      );
      const flight = normalizeCanonicalFlightV1(value, 0, {
        canonicalFlightId: identity.canonicalFlightId,
        displayTimezone: context.defaultTimezone,
        importItemId: requiredImportItemId,
        organizationId: requiredOrganizationId,
        processingAttemptId: identity.attemptId,
        processingRevisionId: identity.processingRevisionId,
        rawSourceId: context.rawSourceId,
      });
      return {
        encoded: encodeTelemetryV1(flight.telemetry),
        flight,
        identity,
        parserRevision: `${value.parser.id}@${value.parser.version}:${value.parser.source_commit}`,
      };
    });
    const normalizationMs = performance.now() - normalizationStarted;
    const key = objectKey(requiredOrganizationId, prepared.identity.revisionId);
    const stored = await this.#objectStore.putIfAbsent(
      key,
      prepared.encoded.bytes,
      prepared.encoded.mediaType,
      prepared.encoded.contentSha256,
    );
    if (
      stored.contentSha256 !== prepared.encoded.contentSha256 ||
      stored.byteSize !== prepared.encoded.bytes.byteLength ||
      stored.mediaType !== prepared.encoded.mediaType
    ) {
      await this.#objectStore.deleteExact(key, stored.versionId);
      throw new Error(
        'The telemetry object store returned mismatched metadata.',
      );
    }

    const persistStarted = performance.now();
    let persisted: PersistenceResult;
    try {
      persisted = await this.#persist(
        requiredOrganizationId,
        requiredImportItemId,
        context,
        prepared,
        stored.versionId,
      );
    } catch (error) {
      const referenced = await telemetryVersionReferenced(
        this.#pool,
        requiredOrganizationId,
        stored.versionId,
      );
      if (!referenced)
        await this.#objectStore.deleteExact(key, stored.versionId);
      throw error;
    }
    if (!persisted.telemetryReferenced) {
      await this.#objectStore.deleteExact(key, stored.versionId);
    }
    this.#metrics?.observe({
      normalizationMs,
      outcome: persisted.outcome,
      parserMs: intermediate.summary.process.wallMs,
      persistMs: performance.now() - persistStarted,
      sampleCount: prepared.encoded.sampleCount,
      schemaVersion: 1,
    });
    return {
      assignmentStatus: persisted.assignmentStatus,
      canonicalFlightId: persisted.canonicalFlightId,
      outcome: persisted.outcome,
      reason: persisted.reason,
    };
  }

  async #persist(
    organizationId: string,
    importItemId: string,
    context: ProcessingContext,
    prepared: Readonly<{
      encoded: EncodedTelemetryV1;
      flight: CanonicalFlightV1;
      identity: ReturnType<typeof processingIdentity>;
      parserRevision: string;
    }>,
    objectVersionId: string,
  ): Promise<PersistenceResult> {
    return withOrganizationTransaction(
      this.#pool,
      organizationId,
      async (transaction) => {
        await transaction.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${transaction.organizationId}:normalize:${importItemId}`],
        );
        const current = await importRow(transaction, importItemId);
        if (current.result_flight_id) {
          const result = await transaction.query<FlightRow>(
            `SELECT id, state, assignment_status
             FROM droneworks.canonical_flights
            WHERE organization_id = $1
              AND id = $2`,
            [transaction.organizationId, current.result_flight_id],
          );
          const row = result.rows[0];
          if (row) {
            return {
              assignmentStatus: row.assignment_status,
              canonicalFlightId: row.id,
              outcome: row.state === 'active' ? 'completed' : 'awaiting_review',
              reason:
                row.state === 'active'
                  ? 'assignments_resolved'
                  : 'review_required',
              telemetryReferenced: true,
            };
          }
        }

        const exactSource = await exactSourceFlight(
          transaction,
          importItemId,
          context.rawSourceId,
        );
        if (exactSource) {
          await transaction.query(
            `UPDATE droneworks.import_items
              SET state = 'skipped_duplicate',
                  duplicate_of_flight_id = $3,
                  outcome_reason = 'exact_source',
                  updated_at = now()
            WHERE organization_id = $1 AND id = $2`,
            [transaction.organizationId, importItemId, exactSource],
          );
          return {
            assignmentStatus: null,
            canonicalFlightId: exactSource,
            outcome: 'skipped_duplicate',
            reason: 'exact_source',
            telemetryReferenced: false,
          };
        }

        const now = new Date();
        await transaction.query(
          `INSERT INTO droneworks.import_attempts (
           organization_id, id, import_item_id, attempt_number, state,
           parser_revision, started_at, finished_at
         ) VALUES ($1, $2, $3, 1, 'succeeded', $4, $5, $5)
         ON CONFLICT (organization_id, id) DO NOTHING`,
          [
            transaction.organizationId,
            prepared.identity.attemptId,
            importItemId,
            prepared.parserRevision,
            now,
          ],
        );

        if (prepared.flight.fingerprint.digest) {
          await transaction.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [
              `${transaction.organizationId}:${exactNormalizedFingerprintVersion}:${prepared.flight.fingerprint.digest}`,
            ],
          );
          const duplicate = await transaction.query<{
            readonly canonical_flight_id: string;
          }>(
            `SELECT canonical_flight_id
             FROM droneworks.flight_revisions
            WHERE organization_id = $1
              AND exact_normalized_version = $2
              AND exact_normalized_fingerprint = $3
              AND fingerprint_status = 'eligible'
            ORDER BY created_at, id
            LIMIT 1`,
            [
              transaction.organizationId,
              exactNormalizedFingerprintVersion,
              prepared.flight.fingerprint.digest,
            ],
          );
          if (duplicate.rows[0]) {
            const flightId = duplicate.rows[0].canonical_flight_id;
            await transaction.query(
              `UPDATE droneworks.import_items
                SET state = 'skipped_duplicate',
                    duplicate_of_flight_id = $3,
                    outcome_reason = 'exact_normalized',
                    updated_at = now()
              WHERE organization_id = $1 AND id = $2`,
              [transaction.organizationId, importItemId, flightId],
            );
            await writeAudit(transaction, importItemId, 'skipped_duplicate', {
              outcome: 'skipped_duplicate',
              reason: 'exact_normalized',
              schema_version: 1,
            });
            if (this.#beforeCommit) await this.#beforeCommit();
            return {
              assignmentStatus: null,
              canonicalFlightId: flightId,
              outcome: 'skipped_duplicate',
              reason: 'exact_normalized',
              telemetryReferenced: false,
            };
          }
        }

        const aircraft = await resolveAircraft(
          transaction,
          prepared.flight,
          now,
        );
        const proposedPilotId = await pilotProposal(
          transaction,
          context.uploadedByUserId,
        );
        const assignmentStatus = prepared.flight.time_interpretation
          .review_required
          ? 'awaiting_time'
          : aircraft.assignmentStatus !== 'assigned'
            ? aircraft.assignmentStatus
            : 'awaiting_pilot';
        const state = 'awaiting_review' as const;
        const takeoff = importedValue(prepared.flight, 'takeoff_time_utc');
        const duration = importedValue(prepared.flight, 'duration_ms');

        await transaction.query(
          `INSERT INTO droneworks.canonical_flights (
           organization_id, id, import_item_id, pilot_profile_id,
           proposed_pilot_profile_id, aircraft_id, source_kind, state,
           assignment_status, pilot_assignment_provenance,
           aircraft_assignment_provenance, takeoff_at, takeoff_timezone,
           duration_ms, created_at, updated_at
         ) VALUES (
           $1, $2, $3, NULL, $4, $5, 'imported', $6, $7, NULL, $8,
           $9, $10, $11, $12, $12
         )`,
          [
            transaction.organizationId,
            prepared.identity.canonicalFlightId,
            importItemId,
            proposedPilotId,
            aircraft.aircraftId,
            state,
            assignmentStatus,
            aircraft.provenance,
            typeof takeoff === 'string' ? takeoff : null,
            context.defaultTimezone,
            typeof duration === 'number' ? duration : null,
            now,
          ],
        );
        await transaction.query(
          `INSERT INTO droneworks.flight_revisions (
           organization_id, id, canonical_flight_id, import_attempt_id,
           revision_number, canonical_schema_version, facts, capabilities,
           exact_normalized_fingerprint, exact_normalized_version,
           fingerprint_status, provenance, created_at
         ) VALUES ($1, $2, $3, $4, 1, 1, $5, $6, $7, $8, $9, $10, $11)`,
          [
            transaction.organizationId,
            prepared.identity.revisionId,
            prepared.identity.canonicalFlightId,
            prepared.identity.attemptId,
            prepared.flight.facts,
            prepared.flight.capabilities,
            prepared.flight.fingerprint.digest,
            prepared.flight.fingerprint.version,
            prepared.flight.fingerprint.status,
            {
              aircraft_identifiers: prepared.flight.aircraft_identifiers,
              battery_identifiers: prepared.flight.battery_identifiers,
              duplicate_evidence: prepared.flight.fingerprint,
              schema_version: 1,
              telemetry: prepared.flight.telemetry_provenance,
              time_interpretation: prepared.flight.time_interpretation,
            },
            now,
          ],
        );
        await transaction.query(
          `INSERT INTO droneworks.telemetry_objects (
           organization_id, id, flight_revision_id, object_revision_id,
           codec, codec_version, content_sha256, sample_count,
           first_elapsed_ms, last_elapsed_ms, capabilities, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            transaction.organizationId,
            prepared.identity.telemetryId,
            prepared.identity.revisionId,
            objectVersionId,
            prepared.encoded.codec,
            prepared.encoded.codecVersion,
            prepared.encoded.contentSha256,
            prepared.encoded.sampleCount,
            prepared.encoded.firstElapsedMs,
            prepared.encoded.lastElapsedMs,
            prepared.flight.capabilities,
            now,
          ],
        );
        await transaction.query(
          `UPDATE droneworks.import_items
            SET state = $3,
                result_flight_id = $4,
                outcome_reason = 'review_required',
                updated_at = $5
          WHERE organization_id = $1
            AND id = $2`,
          [
            transaction.organizationId,
            importItemId,
            state,
            prepared.identity.canonicalFlightId,
            now,
          ],
        );
        await writeAudit(transaction, importItemId, 'normalization_completed', {
          assignment_status: assignmentStatus,
          flight_count: 1,
          outcome: state,
          sample_count: prepared.encoded.sampleCount,
          schema_version: 1,
        });
        if (this.#beforeCommit) await this.#beforeCommit();
        return {
          assignmentStatus,
          canonicalFlightId: prepared.identity.canonicalFlightId,
          outcome: state,
          reason: 'review_required',
          telemetryReferenced: true,
        };
      },
    );
  }
}
