import type { Position } from 'geojson';

/**
 * What a recorded (or imported) track knows about each point beyond where it was. Both arrays line up
 * one-to-one with the line's coordinates; either is null when the source had none of it.
 */
export interface TrackSamples {
  /** Epoch milliseconds of each fix. */
  times: number[] | null;
  /** GPS altitude in metres at each fix; null entries where the phone reported none. */
  elevations: (number | null)[] | null;
}

export interface ElevationStats {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
  startM: number;
  endM: number;
}

/** Per-point series, all the same length as the track's coordinates (chart input). */
export interface TrackSeries {
  /** Distance along the track from the start, in metres. */
  distanceM: number[];
  /** Seconds since the first fix; null when the track has no times. */
  elapsedS: number[] | null;
  /** Smoothed elevation in metres; null entries where unknown, or null overall when there's none. */
  elevationM: (number | null)[] | null;
}

export interface TrackStats {
  distanceM: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Last fix minus first fix. */
  elapsedMs: number | null;
  /** Elapsed time minus the stretches spent standing still. */
  movingMs: number | null;
  /** Distance over moving time, m/s. */
  avgSpeedMps: number | null;
  elevation: ElevationStats | null;
  series: TrackSeries;
  /** True when the stored samples no longer match the line (its vertices were edited), so they were ignored. */
  samplesMismatch: boolean;
}

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance between two [lon, lat] positions, in metres. */
export function haversineM(a: Position, b: Position): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Segments slower than this are standing still (GPS jitter alone can look like ~0.3 m/s). */
export const MOVING_SPEED_MPS = 0.5;
/** Elevation changes smaller than this are treated as noise when adding up gain and loss. */
export const ELEVATION_NOISE_M = 3;
/** Points each side of a fix that are averaged into its smoothed elevation. */
const SMOOTHING_RADIUS = 2;

/** Centred moving average over the known values; unknown entries stay unknown. */
export function smoothElevations(values: (number | null)[], radius = SMOOTHING_RADIUS): (number | null)[] {
  return values.map((value, i) => {
    if (value == null) return null;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      const v = values[j];
      if (v != null) {
        sum += v;
        count++;
      }
    }
    return sum / count;
  });
}

/**
 * Total climb and descent, ignoring wiggles under `threshold`: a running reference moves only once the
 * elevation has drifted that far from it, so GPS noise around a flat stretch adds nothing.
 */
export function gainAndLoss(values: number[], threshold = ELEVATION_NOISE_M): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  if (values.length === 0) return { gainM, lossM };
  let reference = values[0];
  for (const value of values) {
    if (value - reference >= threshold) {
      gainM += value - reference;
      reference = value;
    } else if (reference - value >= threshold) {
      lossM += reference - value;
      reference = value;
    }
  }
  return { gainM, lossM };
}

function usableSamples(samples: TrackSamples | null, pointCount: number): { samples: TrackSamples | null; mismatch: boolean } {
  if (!samples) return { samples: null, mismatch: false };
  const lengths = [samples.times?.length, samples.elevations?.length].filter((n): n is number => n != null);
  if (lengths.some((n) => n !== pointCount)) return { samples: null, mismatch: true };
  return { samples, mismatch: false };
}

/** Phones report altitude 0 (not null) when they have no altitude at all; a whole track of exactly 0 is that. */
function elevationsOrNull(elevations: (number | null)[] | null): (number | null)[] | null {
  if (!elevations || elevations.every((e) => e == null || e === 0)) return null;
  return elevations;
}

export function computeTrackStats(coordinates: Position[], rawSamples: TrackSamples | null): TrackStats {
  const { samples, mismatch } = usableSamples(rawSamples, coordinates.length);

  const distanceM: number[] = [0];
  for (let i = 1; i < coordinates.length; i++) {
    distanceM.push(distanceM[i - 1] + haversineM(coordinates[i - 1], coordinates[i]));
  }
  const totalM = distanceM[distanceM.length - 1] ?? 0;

  const times = samples?.times && samples.times.length >= 2 ? samples.times : null;
  let elapsedS: number[] | null = null;
  let elapsedMs: number | null = null;
  let movingMs: number | null = null;
  if (times) {
    elapsedS = times.map((t) => (t - times[0]) / 1000);
    elapsedMs = Math.max(0, times[times.length - 1] - times[0]);
    movingMs = 0;
    for (let i = 1; i < times.length; i++) {
      const dt = times[i] - times[i - 1];
      if (dt > 0 && (distanceM[i] - distanceM[i - 1]) / (dt / 1000) >= MOVING_SPEED_MPS) movingMs += dt;
    }
  }

  const rawElevations = elevationsOrNull(samples?.elevations ?? null);
  const elevationM = rawElevations ? smoothElevations(rawElevations) : null;
  let elevation: ElevationStats | null = null;
  const known = elevationM?.filter((e): e is number => e != null) ?? [];
  if (known.length >= 2) {
    elevation = {
      ...gainAndLoss(known),
      minM: Math.min(...known),
      maxM: Math.max(...known),
      startM: known[0],
      endM: known[known.length - 1],
    };
  }

  return {
    distanceM: totalM,
    startedAt: times ? times[0] : null,
    endedAt: times ? times[times.length - 1] : null,
    elapsedMs,
    movingMs,
    avgSpeedMps: movingMs != null && movingMs > 0 ? totalM / (movingMs / 1000) : null,
    elevation,
    series: { distanceM, elapsedS, elevationM },
    samplesMismatch: mismatch,
  };
}
