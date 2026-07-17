import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  flightPathSchema,
  flightSummarySchema,
  flightTrackQuerySchema,
  flightTrackSchema,
  problemDetailSchema,
  type FlightPath,
  type FlightTrackQuery,
} from '@drone-works/contracts/server';
import type {
  AppIdentity,
  FlightSummary,
  FlightTrackRequest,
  FlightTrackResult,
} from '@drone-works/database';

import type { IdentitySource } from './identity.js';
import { requireIdentity } from './organization-routes.js';

const problemResponses = {
  '4xx': {
    description: 'The flight was denied or the request was invalid.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
  '5xx': {
    description: 'The flight read could not be completed.',
    content: {
      'application/problem+json': { schema: problemDetailSchema },
    },
  },
} as const;

function privateCache(reply: FastifyReply): void {
  reply.header('cache-control', 'private, no-store');
  reply.header('vary', 'x-drone-works-local-persona-token, authorization');
}

function summaryResponse(summary: FlightSummary) {
  return {
    flight_id: summary.flightId,
    state: summary.state,
    assignment_status: summary.assignmentStatus,
    source_kind: summary.sourceKind,
    pilot_profile_id: summary.pilotProfileId,
    proposed_pilot_profile_id: summary.proposedPilotProfileId,
    aircraft_id: summary.aircraftId,
    takeoff_timezone: summary.takeoffTimezone,
    revision_number: summary.revisionNumber,
    capabilities: summary.capabilities,
    facts: summary.facts,
    telemetry: summary.telemetry
      ? {
          sample_count: summary.telemetry.sampleCount,
          first_elapsed_ms: summary.telemetry.firstElapsedMs,
          last_elapsed_ms: summary.telemetry.lastElapsedMs,
        }
      : null,
  };
}

function horizontalSpeed(
  velocity: Readonly<{ x_mps: number | null; y_mps: number | null }>,
): number | null {
  return velocity.x_mps === null || velocity.y_mps === null
    ? null
    : Math.hypot(velocity.x_mps, velocity.y_mps);
}

function trackResponse(track: FlightTrackResult) {
  const capabilities = new Set(track.capabilities);
  const hasAltitude = capabilities.has('telemetry.altitude');
  const hasBattery = capabilities.has('telemetry.battery');
  const hasGps = capabilities.has('telemetry.gps');
  const hasPosition = capabilities.has('telemetry.position');
  const hasSignal = capabilities.has('telemetry.signal');
  const hasVelocity = capabilities.has('telemetry.velocity');
  const unavailableRange = () => ({ minimum: null, maximum: null });
  return {
    flight_id: track.flightId,
    revision_number: track.revisionNumber,
    mode: track.mode,
    capabilities: track.capabilities,
    source_sample_count: track.sourceSampleCount,
    returned_sample_count: track.returnedSampleCount,
    next_cursor: track.nextCursor,
    gap_transition_count: track.gapTransitionCount,
    preserved_gap_transition_count: track.preservedGapTransitionCount,
    statistics: {
      altitude_msl_m: hasAltitude
        ? track.statistics.altitude_msl_m
        : unavailableRange(),
      battery_charge_percent: hasBattery
        ? track.statistics.battery_charge_percent
        : unavailableRange(),
      height_agl_m: hasAltitude
        ? track.statistics.height_agl_m
        : unavailableRange(),
      horizontal_speed_mps: hasVelocity
        ? track.statistics.horizontal_speed_mps
        : unavailableRange(),
      vertical_speed_mps: hasVelocity
        ? track.statistics.vertical_speed_mps
        : unavailableRange(),
    },
    samples: track.samples.map((sample) => ({
      sample_index: sample.sample_index,
      elapsed_ms: sample.elapsed_ms,
      position: hasPosition ? sample.position : null,
      altitude_msl_m: hasAltitude ? sample.altitude_msl_m : null,
      height_agl_m: hasAltitude ? sample.height_agl_m : null,
      horizontal_speed_mps: hasVelocity
        ? horizontalSpeed(sample.velocity)
        : null,
      vertical_speed_mps: hasVelocity ? sample.velocity.z_mps : null,
      battery_charge_percent: hasBattery
        ? (sample.battery?.charge_percent ?? null)
        : null,
      gps_satellites: hasGps ? sample.gps.satellites : null,
      gps_signal_level: hasGps ? sample.gps.signal_level : null,
      signal_downlink_percent: hasSignal
        ? (sample.signal?.downlink_percent ?? null)
        : null,
      signal_uplink_percent: hasSignal
        ? (sample.signal?.uplink_percent ?? null)
        : null,
    })),
  };
}

export interface FlightRouteDependencies {
  readonly identitySource: IdentitySource;
  readonly flights: {
    getSummary(
      identity: AppIdentity,
      organizationId: string,
      flightId: string,
    ): Promise<FlightSummary>;
    getTrack(
      identity: AppIdentity,
      organizationId: string,
      flightId: string,
      request: FlightTrackRequest,
    ): Promise<FlightTrackResult>;
  };
}

export function registerFlightRoutes(
  app: FastifyInstance,
  dependencies: FlightRouteDependencies,
): void {
  app.get<{ Params: FlightPath }>(
    '/api/v1/organizations/:organization_id/flights/:flight_id',
    {
      schema: {
        operationId: 'getFlightSummary',
        params: flightPathSchema,
        response: {
          200: {
            description:
              'The authorized current flight summary with public provenance origins.',
            content: { 'application/json': { schema: flightSummarySchema } },
          },
          ...problemResponses,
        },
        summary: 'Get a flight summary',
        tags: ['flights'],
      },
    },
    async (request, reply) => {
      const result = await dependencies.flights.getSummary(
        await requireIdentity(dependencies.identitySource, request),
        request.params.organization_id,
        request.params.flight_id,
      );
      privateCache(reply);
      return summaryResponse(result);
    },
  );

  app.get<{ Params: FlightPath; Querystring: FlightTrackQuery }>(
    '/api/v1/organizations/:organization_id/flights/:flight_id/track',
    {
      schema: {
        operationId: 'getFlightTrack',
        params: flightPathSchema,
        querystring: flightTrackQuerySchema,
        response: {
          200: {
            description:
              'A checksum-verified bounded track from the current telemetry revision.',
            content: { 'application/json': { schema: flightTrackSchema } },
          },
          ...problemResponses,
        },
        summary: 'Get a bounded flight track',
        tags: ['flights'],
      },
    },
    async (request, reply) => {
      const result = await dependencies.flights.getTrack(
        await requireIdentity(dependencies.identitySource, request),
        request.params.organization_id,
        request.params.flight_id,
        {
          mode: request.query.mode ?? 'default',
          ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
          ...(request.query.limit === undefined
            ? {}
            : { limit: request.query.limit }),
        },
      );
      privateCache(reply);
      return trackResponse(result);
    },
  );
}
