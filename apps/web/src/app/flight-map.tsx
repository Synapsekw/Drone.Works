'use client';

import { useEffect, useRef } from 'react';

import type {
  ApiFlightSummary,
  ApiFlightTrack,
} from '@drone-works/contracts/client';
import type { Feature, GeoJsonProperties, MultiLineString } from 'geojson';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';

const localStyle: StyleSpecification = {
  version: 8,
  name: 'Drone.Works provider-free local canvas',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#e9ece8' },
    },
  ],
};

function trackFeature(
  track: ApiFlightTrack,
): Feature<MultiLineString, GeoJsonProperties> | null {
  const segments: number[][][] = [];
  let segment: number[][] = [];
  for (const sample of track.samples) {
    if (!sample.position) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
      continue;
    }
    segment.push([sample.position.longitude_deg, sample.position.latitude_deg]);
  }
  if (segment.length > 1) segments.push(segment);
  if (!segments.length) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiLineString', coordinates: segments },
  };
}

export function FlightMap({
  summary,
  track,
}: {
  readonly summary: ApiFlightSummary;
  readonly track: ApiFlightTrack | null;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const supportsPosition = summary.capabilities.includes('telemetry.position');
  const feature = track ? trackFeature(track) : null;

  useEffect(() => {
    if (!container.current || !supportsPosition || !feature) return;
    const map = new maplibregl.Map({
      attributionControl: false,
      center: feature.geometry.coordinates[0]?.[0] as [number, number],
      container: container.current,
      dragRotate: false,
      pitchWithRotate: false,
      style: localStyle,
      zoom: 13,
    });
    map.once('load', () => {
      map.addSource('flight-track', { type: 'geojson', data: feature });
      map.addLayer({
        id: 'flight-track-casing',
        type: 'line',
        source: 'flight-track',
        paint: {
          'line-color': '#ffffff',
          'line-width': 7,
          'line-opacity': 0.8,
        },
      });
      map.addLayer({
        id: 'flight-track',
        type: 'line',
        source: 'flight-track',
        paint: { 'line-color': '#d4512d', 'line-width': 4 },
      });
      const bounds = new maplibregl.LngLatBounds();
      for (const line of feature.geometry.coordinates) {
        for (const coordinate of line)
          bounds.extend(coordinate as [number, number]);
      }
      if (!bounds.isEmpty())
        map.fitBounds(bounds, { padding: 52, maxZoom: 16 });
      const canvas = map.getCanvas();
      canvas.setAttribute(
        'aria-label',
        'Capability-supported two-dimensional flight track',
      );
      canvas.setAttribute('role', 'img');
    });
    return () => map.remove();
  }, [feature, supportsPosition]);

  if (!supportsPosition) {
    return (
      <div className="map-empty" role="note">
        <strong>Track unavailable</strong>
        <span>
          The source did not declare position capability. No zero route was
          synthesized.
        </span>
      </div>
    );
  }
  if (!track || !feature) {
    return (
      <div className="map-empty" role="note">
        <strong>No drawable track</strong>
        <span>
          Position gaps or missing samples leave the map empty rather than
          inventing a path.
        </span>
      </div>
    );
  }

  return (
    <div className="map-panel">
      <div className="map-meta">
        <div>
          <strong>2D track</strong>
          <span>
            {track.returned_sample_count} of {track.source_sample_count} bounded
            samples
          </span>
        </div>
        <span>
          {track.preserved_gap_transition_count}/{track.gap_transition_count}{' '}
          gaps preserved
        </span>
      </div>
      <div className="map-canvas" ref={container} data-testid="flight-map" />
      <p className="map-privacy">
        Provider-free local canvas. No tile or style request receives flight
        coordinates.
      </p>
    </div>
  );
}
