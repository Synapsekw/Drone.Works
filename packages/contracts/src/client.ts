import type { operations } from './generated/openapi.js';

type HealthOperation = operations['getApiHealth'];
type FlightSummaryOperation = operations['getFlightSummary'];
type FlightTrackOperation = operations['getFlightTrack'];

export type ApiHealth =
  HealthOperation['responses'][200]['content']['application/json'];
export type ApiProblem =
  HealthOperation['responses']['4XX']['content']['application/problem+json'];
export type ApiFlightSummary =
  FlightSummaryOperation['responses'][200]['content']['application/json'];
export type ApiFlightTrack =
  FlightTrackOperation['responses'][200]['content']['application/json'];

export async function getApiHealth(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ApiHealth> {
  const response = await fetch(new URL('/api/v1/health', baseUrl), {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}.`);
  }

  return (await response.json()) as ApiHealth;
}
