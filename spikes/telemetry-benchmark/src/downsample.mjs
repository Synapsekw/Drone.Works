import { FLAG_GAP, FLAG_WARNING } from "./codec.mjs";

const EXTREMA_FIELDS = Object.freeze([
  "altitude_m",
  "horizontal_speed_mps",
  "vertical_speed_mps",
  "battery_percent",
]);

function addExtrema(points, start, end, indexes) {
  for (const field of EXTREMA_FIELDS) {
    let minimumIndex;
    let maximumIndex;
    for (let index = start; index < end; index += 1) {
      const value = points[index][field];
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      if (minimumIndex === undefined || value < points[minimumIndex][field]) minimumIndex = index;
      if (maximumIndex === undefined || value > points[maximumIndex][field]) maximumIndex = index;
    }
    if (minimumIndex !== undefined) indexes.add(minimumIndex);
    if (maximumIndex !== undefined) indexes.add(maximumIndex);
  }
}

function anchorIndexes(points) {
  const anchors = new Set([0, points.length - 1]);
  addExtrema(points, 0, points.length, anchors);
  for (let index = 0; index < points.length; index += 1) {
    const flags = points[index].flags ?? 0;
    if ((flags & FLAG_WARNING) !== 0 || points[index].warning_code !== null) anchors.add(index);
    if ((flags & FLAG_GAP) !== 0) {
      anchors.add(index);
      if (index > 0) anchors.add(index - 1);
      if (index + 1 < points.length) anchors.add(index + 1);
    }
  }
  return anchors;
}

export function downsampleTelemetry(points, targetPoints = 1_000) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (!Number.isInteger(targetPoints) || targetPoints < 2) {
    throw new TypeError("targetPoints must be an integer >= 2");
  }
  if (points.length <= targetPoints) return points.map((point) => ({ ...point }));

  const selected = anchorIndexes(points);
  if (selected.size > targetPoints) {
    throw new RangeError("targetPoints cannot retain every endpoint, warning, extrema, and gap boundary");
  }

  const extremaPerBucket = EXTREMA_FIELDS.length * 2;
  const bucketCount = Math.max(1, Math.floor((targetPoints - selected.size) / extremaPerBucket));
  const bucketWidth = points.length / bucketCount;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketWidth);
    const end = Math.min(points.length, Math.max(start + 1, Math.floor((bucket + 1) * bucketWidth)));
    addExtrema(points, start, end, selected);
  }

  if (selected.size < targetPoints) {
    const remaining = targetPoints - selected.size;
    const stride = (points.length - 1) / (remaining + 1);
    for (let slot = 1; slot <= remaining && selected.size < targetPoints; slot += 1) {
      selected.add(Math.round(slot * stride));
    }
  }
  if (selected.size < targetPoints) {
    for (let index = 1; index < points.length - 1 && selected.size < targetPoints; index += 1) {
      selected.add(index);
    }
  }

  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, targetPoints)
    .map((index) => ({ ...points[index] }));
}

export function telemetrySummary(points) {
  const summary = {};
  for (const field of EXTREMA_FIELDS) {
    const values = points.map((point) => point[field]).filter(Number.isFinite);
    summary[field] = values.length === 0
      ? { minimum: null, maximum: null }
      : { minimum: Math.min(...values), maximum: Math.max(...values) };
  }
  summary.warning_codes = [...new Set(points.map((point) => point.warning_code).filter(Number.isInteger))].sort((a, b) => a - b);
  summary.gap_points = points.filter((point) => ((point.flags ?? 0) & FLAG_GAP) !== 0).length;
  return summary;
}

export function pageTelemetry(points, { cursor = 0, limit = 1_000, maximumLimit = 2_000 } = {}) {
  if (!Number.isInteger(cursor) || cursor < 0) throw new TypeError("cursor must be a non-negative integer");
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new RangeError(`limit must be between 1 and ${maximumLimit}`);
  }
  const items = points.slice(cursor, cursor + limit).map((point) => ({ ...point }));
  const nextCursor = cursor + items.length < points.length ? cursor + items.length : null;
  return { items, nextCursor };
}
