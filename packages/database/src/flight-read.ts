import {
  downsampleTelemetryV1,
  telemetryCodec,
  telemetryCodecVersion,
  telemetryGapTransitionIndexesV1,
  telemetryReplaySamplesV1,
  verifyTelemetryV1,
  type TelemetryReplaySampleV1,
  type TelemetryReplayStatisticsV1,
} from '@drone-works/telemetry';

import {
  OrganizationAccessDeniedError,
  type AppIdentity,
} from './organization-authorization.js';
import {
  withOrganizationTransaction,
  type OrganizationPool,
  type OrganizationTransaction,
} from './organization-transaction.js';

export const flightFactNames = [
  'aircraft_model',
  'aircraft_name',
  'application_platform',
  'application_version',
  'distance_m',
  'duration_ms',
  'max_height_m',
  'max_horizontal_speed_mps',
  'max_vertical_speed_mps',
  'takeoff_time_utc',
] as const;

export type FlightFactName = (typeof flightFactNames)[number];
export type FlightFactOrigin =
  'derived' | 'imported' | 'unavailable' | 'user_override';

export interface FlightFactSummary {
  readonly origin: FlightFactOrigin;
  readonly value: number | string | null;
}

export interface FlightTelemetrySummary {
  readonly firstElapsedMs: number | null;
  readonly lastElapsedMs: number | null;
  readonly sampleCount: number;
}

export interface FlightSummary {
  readonly aircraftId: string | null;
  readonly aircraftDisplayName: string | null;
  readonly assignmentStatus:
    | 'ambiguous_aircraft'
    | 'assigned'
    | 'awaiting_aircraft'
    | 'awaiting_multiple'
    | 'awaiting_pilot'
    | 'awaiting_time';
  readonly capabilities: readonly string[];
  readonly facts: Readonly<Record<FlightFactName, FlightFactSummary>>;
  readonly flightId: string;
  readonly pilotProfileId: string | null;
  readonly pilotDisplayName: string | null;
  readonly proposedPilotProfileId: string | null;
  readonly revisionNumber: number;
  readonly sourceKind: 'imported' | 'manual';
  readonly state: 'active' | 'awaiting_review';
  readonly takeoffTimezone: string;
  readonly telemetry: FlightTelemetrySummary | null;
}

export interface FlightListRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly search?: string;
  readonly state?: 'active' | 'awaiting_review';
}

export interface FlightListTotals {
  readonly activeFlights: number;
  readonly awaitingReview: number;
  readonly totalDistanceM: number;
  readonly totalDurationMs: number;
}

export interface FlightListResult {
  readonly items: readonly FlightSummary[];
  readonly nextCursor: string | null;
  readonly totals: FlightListTotals;
}

export interface FlightTrackRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly mode: 'default' | 'full';
}

export interface FlightTrackResult {
  readonly capabilities: readonly string[];
  readonly flightId: string;
  readonly gapTransitionCount: number;
  readonly mode: 'default' | 'full';
  readonly nextCursor: string | null;
  readonly preservedGapTransitionCount: number;
  readonly returnedSampleCount: number;
  readonly revisionNumber: number;
  readonly samples: readonly TelemetryReplaySampleV1[];
  readonly sourceSampleCount: number;
  readonly statistics: TelemetryReplayStatisticsV1;
}

export interface FlightReadMetric {
  readonly durationMs: number;
  readonly objectOutcome:
    'error' | 'invalid' | 'missing' | 'not_read' | 'verified';
  readonly operation: 'list' | 'summary' | 'track';
  readonly replayMode: 'default' | 'full' | null;
  readonly returnedSampleCount: number;
  readonly schemaVersion: 1;
}

export interface FlightReadMetricsSink {
  observe(metric: FlightReadMetric): void;
}

export interface ReadableTelemetryObjectStore {
  getExact(key: string, versionId: string): Promise<Buffer | null>;
}

export class FlightTrackCursorError extends Error {
  readonly statusCode = 400;

  constructor() {
    super('The track cursor is invalid or stale.');
    this.name = 'FlightTrackCursorError';
  }
}

export class FlightListQueryError extends Error {
  readonly statusCode = 400;

  constructor() {
    super('The flight list query is invalid or stale.');
    this.name = 'FlightListQueryError';
  }
}

export class FlightTelemetryUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('The flight telemetry is temporarily unavailable.');
    this.name = 'FlightTelemetryUnavailableError';
  }
}

interface FlightReadRow {
  readonly aircraft_id: string | null;
  readonly aircraft_display_name: string | null;
  readonly assignment_status: FlightSummary['assignmentStatus'];
  readonly capabilities: string[];
  readonly codec: string | null;
  readonly codec_version: number | null;
  readonly content_sha256: string | null;
  readonly facts: unknown;
  readonly first_elapsed_ms: string | null;
  readonly flight_id: string;
  readonly last_elapsed_ms: string | null;
  readonly object_revision_id: string | null;
  readonly pilot_profile_id: string | null;
  readonly pilot_display_name: string | null;
  readonly proposed_pilot_profile_id: string | null;
  readonly revision_id: string;
  readonly revision_number: number;
  readonly sample_count: number | null;
  readonly source_kind: FlightSummary['sourceKind'];
  readonly state: FlightSummary['state'];
  readonly takeoff_timezone: string;
  readonly telemetry_capabilities: string[] | null;
}

interface FlightListTotalsRow {
  readonly active_flights: string;
  readonly awaiting_review: string;
  readonly total_distance_m: string;
  readonly total_duration_ms: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorPattern = /^[A-Za-z0-9_-]{1,200}$/;
const stringFacts = new Set<FlightFactName>([
  'aircraft_model',
  'aircraft_name',
  'application_platform',
  'application_version',
  'takeoff_time_utc',
]);

function requireUuid(value: string): string {
  if (!uuidPattern.test(value)) throw new OrganizationAccessDeniedError();
  return value.toLowerCase();
}

function objectKey(organizationId: string, revisionId: string): string {
  return `organizations/${organizationId}/flight-revisions/${revisionId}/telemetry-v1`;
}

function integer(value: number | string | null, name: string): number | null {
  if (value === null) return null;
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new TypeError(`Stored ${name} is invalid.`);
  }
  return converted;
}

async function requireMembership(
  transaction: OrganizationTransaction,
  userId: string,
): Promise<void> {
  const result = await transaction.query(
    `SELECT 1
       FROM droneworks.memberships
      WHERE organization_id = $1
        AND user_id = $2`,
    [transaction.organizationId, userId],
  );
  if (result.rowCount !== 1) throw new OrganizationAccessDeniedError();
}

async function loadFlight(
  pool: OrganizationPool,
  identity: AppIdentity,
  organizationId: string,
  flightId: string,
): Promise<FlightReadRow> {
  return withOrganizationTransaction(
    pool,
    requireUuid(organizationId),
    async (transaction) => {
      await requireMembership(transaction, requireUuid(identity.userId));
      const result = await transaction.query<FlightReadRow>(
        `SELECT flight.id AS flight_id,
                flight.source_kind,
                flight.state,
                flight.assignment_status,
                flight.pilot_profile_id,
                flight.proposed_pilot_profile_id,
                flight.aircraft_id,
                pilot.display_name AS pilot_display_name,
                aircraft.display_name AS aircraft_display_name,
                flight.takeoff_timezone,
                revision.id AS revision_id,
                revision.revision_number,
                revision.facts,
                revision.capabilities,
                telemetry.object_revision_id,
                telemetry.codec,
                telemetry.codec_version,
                telemetry.content_sha256,
                telemetry.sample_count,
                telemetry.first_elapsed_ms,
                telemetry.last_elapsed_ms,
                telemetry.capabilities AS telemetry_capabilities
           FROM droneworks.canonical_flights AS flight
           JOIN LATERAL (
             SELECT current_revision.id,
                    current_revision.revision_number,
                    current_revision.facts,
                    current_revision.capabilities
               FROM droneworks.flight_revisions AS current_revision
              WHERE current_revision.organization_id = flight.organization_id
                AND current_revision.canonical_flight_id = flight.id
              ORDER BY current_revision.revision_number DESC
              LIMIT 1
           ) AS revision ON true
           LEFT JOIN droneworks.telemetry_objects AS telemetry
             ON (telemetry.organization_id, telemetry.flight_revision_id) =
                (flight.organization_id, revision.id)
           LEFT JOIN droneworks.pilot_profiles AS pilot
             ON (pilot.organization_id, pilot.id) =
                (flight.organization_id, flight.pilot_profile_id)
           LEFT JOIN droneworks.aircraft AS aircraft
             ON (aircraft.organization_id, aircraft.id) =
                (flight.organization_id, flight.aircraft_id)
          WHERE flight.organization_id = $1
            AND flight.id = $2
            AND flight.state <> 'deleted'`,
        [transaction.organizationId, requireUuid(flightId)],
      );
      const row = result.rows[0];
      if (!row) throw new OrganizationAccessDeniedError();
      return row;
    },
  );
}

function listOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  if (!cursorPattern.test(cursor)) throw new FlightListQueryError();
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new FlightListQueryError();
  }
  const match = /^1:(\d+)$/.exec(decoded);
  const offset = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(offset) || offset < 0) {
    throw new FlightListQueryError();
  }
  return offset;
}

function listCursor(offset: number): string {
  return Buffer.from(`1:${offset}`, 'utf8').toString('base64url');
}

function searchPattern(search: string | undefined): string | null {
  const normalized = search?.trim() ?? '';
  if (normalized.length > 100) throw new FlightListQueryError();
  if (!normalized) return null;
  return `%${normalized.replace(/[\\%_]/g, '\\$&')}%`;
}

async function loadFlightList(
  pool: OrganizationPool,
  identity: AppIdentity,
  organizationId: string,
  request: FlightListRequest,
): Promise<FlightListResult> {
  const limit = request.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new FlightListQueryError();
  }
  const offset = listOffset(request.cursor);
  const pattern = searchPattern(request.search);
  return withOrganizationTransaction(
    pool,
    requireUuid(organizationId),
    async (transaction) => {
      await requireMembership(transaction, requireUuid(identity.userId));
      const result = await transaction.query<FlightReadRow>(
        `SELECT flight.id AS flight_id,
                flight.source_kind,
                flight.state,
                flight.assignment_status,
                flight.pilot_profile_id,
                flight.proposed_pilot_profile_id,
                flight.aircraft_id,
                pilot.display_name AS pilot_display_name,
                aircraft.display_name AS aircraft_display_name,
                flight.takeoff_timezone,
                revision.id AS revision_id,
                revision.revision_number,
                revision.facts,
                revision.capabilities,
                telemetry.object_revision_id,
                telemetry.codec,
                telemetry.codec_version,
                telemetry.content_sha256,
                telemetry.sample_count,
                telemetry.first_elapsed_ms,
                telemetry.last_elapsed_ms,
                telemetry.capabilities AS telemetry_capabilities
           FROM droneworks.canonical_flights AS flight
           JOIN LATERAL (
             SELECT current_revision.id,
                    current_revision.revision_number,
                    current_revision.facts,
                    current_revision.capabilities
               FROM droneworks.flight_revisions AS current_revision
              WHERE current_revision.organization_id = flight.organization_id
                AND current_revision.canonical_flight_id = flight.id
              ORDER BY current_revision.revision_number DESC
              LIMIT 1
           ) AS revision ON true
           LEFT JOIN droneworks.telemetry_objects AS telemetry
             ON (telemetry.organization_id, telemetry.flight_revision_id) =
                (flight.organization_id, revision.id)
           LEFT JOIN droneworks.pilot_profiles AS pilot
             ON (pilot.organization_id, pilot.id) =
                (flight.organization_id, flight.pilot_profile_id)
           LEFT JOIN droneworks.aircraft AS aircraft
             ON (aircraft.organization_id, aircraft.id) =
                (flight.organization_id, flight.aircraft_id)
          WHERE flight.organization_id = $1
            AND flight.state <> 'deleted'
            AND ($2::text IS NULL OR flight.state = $2)
            AND (
              $3::text IS NULL
              OR flight.id::text ILIKE $3 ESCAPE '\\'
              OR COALESCE(pilot.display_name, '') ILIKE $3 ESCAPE '\\'
              OR COALESCE(aircraft.display_name, '') ILIKE $3 ESCAPE '\\'
              OR COALESCE(
                   revision.facts->'aircraft_model'->'effective'->>'value',
                   ''
                 ) ILIKE $3 ESCAPE '\\'
            )
          ORDER BY flight.takeoff_at DESC NULLS LAST, flight.id DESC
          LIMIT $4 OFFSET $5`,
        [
          transaction.organizationId,
          request.state ?? null,
          pattern,
          limit + 1,
          offset,
        ],
      );
      const totalsResult = await transaction.query<FlightListTotalsRow>(
        `SELECT count(*) FILTER (WHERE flight.state = 'active')::text
                  AS active_flights,
                count(*) FILTER (WHERE flight.state = 'awaiting_review')::text
                  AS awaiting_review,
                COALESCE(sum(
                  CASE
                    WHEN jsonb_typeof(
                      revision.facts->'duration_ms'->'effective'->'value'
                    ) = 'number'
                    THEN (
                      revision.facts->'duration_ms'->'effective'->>'value'
                    )::numeric
                    ELSE 0
                  END
                ), 0)::text AS total_duration_ms,
                COALESCE(sum(
                  CASE
                    WHEN jsonb_typeof(
                      revision.facts->'distance_m'->'effective'->'value'
                    ) = 'number'
                    THEN (
                      revision.facts->'distance_m'->'effective'->>'value'
                    )::numeric
                    ELSE 0
                  END
                ), 0)::text AS total_distance_m
           FROM droneworks.canonical_flights AS flight
           JOIN LATERAL (
             SELECT current_revision.facts
               FROM droneworks.flight_revisions AS current_revision
              WHERE current_revision.organization_id = flight.organization_id
                AND current_revision.canonical_flight_id = flight.id
              ORDER BY current_revision.revision_number DESC
              LIMIT 1
           ) AS revision ON true
          WHERE flight.organization_id = $1
            AND flight.state <> 'deleted'`,
        [transaction.organizationId],
      );
      const totals = totalsResult.rows[0];
      if (!totals) throw new TypeError('Flight totals were unavailable.');
      const hasNextPage = result.rows.length > limit;
      return Object.freeze({
        items: Object.freeze(result.rows.slice(0, limit).map(summary)),
        nextCursor: hasNextPage ? listCursor(offset + limit) : null,
        totals: Object.freeze({
          activeFlights: Number(totals.active_flights),
          awaitingReview: Number(totals.awaiting_review),
          totalDistanceM: Number(totals.total_distance_m),
          totalDurationMs: Number(totals.total_duration_ms),
        }),
      });
    },
  );
}

function factSummary(facts: unknown, name: FlightFactName): FlightFactSummary {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    return { origin: 'unavailable', value: null };
  }
  const fact = (facts as Record<string, unknown>)[name];
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
    return { origin: 'unavailable', value: null };
  }
  const effective = (fact as Record<string, unknown>).effective;
  if (!effective || typeof effective !== 'object' || Array.isArray(effective)) {
    return { origin: 'unavailable', value: null };
  }
  const origin = (effective as Record<string, unknown>).origin;
  const value = (effective as Record<string, unknown>).value;
  if (
    !['derived', 'imported', 'unavailable', 'user_override'].includes(
      String(origin),
    )
  ) {
    throw new TypeError('Stored effective fact origin is invalid.');
  }
  if (value !== null) {
    const expectedType = stringFacts.has(name) ? 'string' : 'number';
    if (
      typeof value !== expectedType ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new TypeError('Stored effective fact value is invalid.');
    }
    if (typeof value === 'string' && value.length > 500) {
      throw new TypeError('Stored effective fact value is too large.');
    }
  }
  return {
    origin: origin as FlightFactOrigin,
    value: value as number | string | null,
  };
}

function summary(row: FlightReadRow): FlightSummary {
  const facts = Object.fromEntries(
    flightFactNames.map((name) => [name, factSummary(row.facts, name)]),
  ) as unknown as Readonly<Record<FlightFactName, FlightFactSummary>>;
  return Object.freeze({
    aircraftId: row.aircraft_id,
    aircraftDisplayName: row.aircraft_display_name,
    assignmentStatus: row.assignment_status,
    capabilities: Object.freeze([...row.capabilities].sort()),
    facts: Object.freeze(facts),
    flightId: row.flight_id,
    pilotProfileId: row.pilot_profile_id,
    pilotDisplayName: row.pilot_display_name,
    proposedPilotProfileId: row.proposed_pilot_profile_id,
    revisionNumber: row.revision_number,
    sourceKind: row.source_kind,
    state: row.state,
    takeoffTimezone: row.takeoff_timezone,
    telemetry:
      row.object_revision_id === null
        ? null
        : Object.freeze({
            firstElapsedMs: integer(row.first_elapsed_ms, 'first elapsed time'),
            lastElapsedMs: integer(row.last_elapsed_ms, 'last elapsed time'),
            sampleCount:
              integer(row.sample_count, 'telemetry sample count') ?? 0,
          }),
  });
}

function encodeCursor(revisionNumber: number, offset: number): string {
  return Buffer.from(`1:${revisionNumber}:${offset}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string, revisionNumber: number): number {
  if (!cursorPattern.test(cursor)) throw new FlightTrackCursorError();
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new FlightTrackCursorError();
  }
  const match = decoded.match(/^(\d+):(\d+):(\d+)$/);
  if (!match || match[1] !== '1' || Number(match[2]) !== revisionNumber) {
    throw new FlightTrackCursorError();
  }
  const offset = Number(match[3]);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new FlightTrackCursorError();
  }
  return offset;
}

function compatibleTelemetry(row: FlightReadRow): row is FlightReadRow & {
  readonly codec: typeof telemetryCodec;
  readonly codec_version: typeof telemetryCodecVersion;
  readonly content_sha256: string;
  readonly object_revision_id: string;
  readonly sample_count: number;
  readonly telemetry_capabilities: string[];
} {
  return (
    row.object_revision_id !== null &&
    row.codec === telemetryCodec &&
    row.codec_version === telemetryCodecVersion &&
    typeof row.content_sha256 === 'string' &&
    row.sample_count !== null &&
    row.telemetry_capabilities !== null
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

export class FlightReadRepository {
  readonly #metrics: FlightReadMetricsSink | undefined;
  readonly #objectStore: ReadableTelemetryObjectStore;
  readonly #pool: OrganizationPool;

  constructor(
    input: Readonly<{
      metrics?: FlightReadMetricsSink;
      objectStore: ReadableTelemetryObjectStore;
      pool: OrganizationPool;
    }>,
  ) {
    this.#metrics = input.metrics;
    this.#objectStore = input.objectStore;
    this.#pool = input.pool;
  }

  async listFlights(
    identity: AppIdentity,
    organizationId: string,
    request: FlightListRequest,
  ): Promise<FlightListResult> {
    const started = performance.now();
    const result = await loadFlightList(
      this.#pool,
      identity,
      organizationId,
      request,
    );
    this.#metrics?.observe({
      durationMs: performance.now() - started,
      objectOutcome: 'not_read',
      operation: 'list',
      replayMode: null,
      returnedSampleCount: result.items.length,
      schemaVersion: 1,
    });
    return result;
  }

  async getSummary(
    identity: AppIdentity,
    organizationId: string,
    flightId: string,
  ): Promise<FlightSummary> {
    const started = performance.now();
    const result = summary(
      await loadFlight(this.#pool, identity, organizationId, flightId),
    );
    this.#metrics?.observe({
      durationMs: performance.now() - started,
      objectOutcome: 'not_read',
      operation: 'summary',
      replayMode: null,
      returnedSampleCount: 0,
      schemaVersion: 1,
    });
    return result;
  }

  async getTrack(
    identity: AppIdentity,
    organizationId: string,
    flightId: string,
    request: FlightTrackRequest,
  ): Promise<FlightTrackResult> {
    const started = performance.now();
    const requiredOrganizationId = requireUuid(organizationId);
    const row = await loadFlight(
      this.#pool,
      identity,
      requiredOrganizationId,
      flightId,
    );
    if (!compatibleTelemetry(row)) {
      this.#observeTrack(started, request.mode, 0, 'invalid');
      throw new FlightTelemetryUnavailableError();
    }
    const expectedSampleCount = integer(
      row.sample_count,
      'telemetry sample count',
    );
    const expectedFirstElapsed = integer(
      row.first_elapsed_ms,
      'first elapsed time',
    );
    const expectedLastElapsed = integer(
      row.last_elapsed_ms,
      'last elapsed time',
    );
    let bytes: Buffer | null;
    try {
      bytes = await this.#objectStore.getExact(
        objectKey(requiredOrganizationId, row.revision_id),
        row.object_revision_id,
      );
    } catch {
      this.#observeTrack(started, request.mode, 0, 'error');
      throw new FlightTelemetryUnavailableError();
    }
    if (!bytes) {
      this.#observeTrack(started, request.mode, 0, 'missing');
      throw new FlightTelemetryUnavailableError();
    }

    try {
      const telemetry = verifyTelemetryV1(bytes, row.content_sha256);
      if (
        telemetry.sample_count !== expectedSampleCount ||
        !sameStrings(row.capabilities, row.telemetry_capabilities)
      ) {
        throw new TypeError('Telemetry metadata does not match the object.');
      }
      const replaySamples = telemetryReplaySamplesV1(telemetry);
      const elapsed = replaySamples
        .map((sample) => sample.elapsed_ms)
        .filter((value): value is number => value !== null);
      if (
        (elapsed[0] ?? null) !== expectedFirstElapsed ||
        (elapsed.at(-1) ?? null) !== expectedLastElapsed
      ) {
        throw new TypeError('Telemetry elapsed bounds do not match metadata.');
      }
      const selected = downsampleTelemetryV1(telemetry, 1_000);
      let samples: readonly TelemetryReplaySampleV1[] = selected.samples;
      let nextCursor: string | null = null;
      let preservedGapTransitionCount = selected.preservedGapTransitionCount;
      if (request.mode === 'full') {
        const limit = request.limit ?? 2_000;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_000) {
          throw new FlightTrackCursorError();
        }
        const offset = request.cursor
          ? decodeCursor(request.cursor, row.revision_number)
          : 0;
        if (offset >= replaySamples.length && replaySamples.length !== 0) {
          throw new FlightTrackCursorError();
        }
        samples = Object.freeze(replaySamples.slice(offset, offset + limit));
        const pageEnd = offset + samples.length;
        preservedGapTransitionCount = telemetryGapTransitionIndexesV1(
          replaySamples,
        ).filter(
          (transition) => transition - 1 >= offset && transition < pageEnd,
        ).length;
        const nextOffset = offset + samples.length;
        nextCursor =
          nextOffset < replaySamples.length
            ? encodeCursor(row.revision_number, nextOffset)
            : null;
      } else if (request.cursor !== undefined || request.limit !== undefined) {
        throw new FlightTrackCursorError();
      }
      const result: FlightTrackResult = Object.freeze({
        capabilities: Object.freeze([...row.capabilities].sort()),
        flightId: row.flight_id,
        gapTransitionCount: selected.gapTransitionCount,
        mode: request.mode,
        nextCursor,
        preservedGapTransitionCount,
        returnedSampleCount: samples.length,
        revisionNumber: row.revision_number,
        samples,
        sourceSampleCount: replaySamples.length,
        statistics: selected.statistics,
      });
      this.#observeTrack(
        started,
        request.mode,
        result.returnedSampleCount,
        'verified',
      );
      return result;
    } catch (error) {
      if (error instanceof FlightTrackCursorError) throw error;
      this.#observeTrack(started, request.mode, 0, 'invalid');
      throw new FlightTelemetryUnavailableError();
    }
  }

  #observeTrack(
    started: number,
    replayMode: 'default' | 'full',
    returnedSampleCount: number,
    objectOutcome: FlightReadMetric['objectOutcome'],
  ): void {
    this.#metrics?.observe({
      durationMs: performance.now() - started,
      objectOutcome,
      operation: 'track',
      replayMode,
      returnedSampleCount,
      schemaVersion: 1,
    });
  }
}
