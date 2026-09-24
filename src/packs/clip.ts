/**
 * Geometry helpers shared by the pack fetchers: clip service geometry to a
 * cell, drop degenerate output, and derive boundary-free outlines.
 *
 * ArcGIS query endpoints return each intersecting feature's FULL geometry,
 * not clipped to the query envelope, so everything must be clipped locally.
 */

import { bboxClip } from '@turf/turf';
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';

import type { Bounds } from './types.ts';

export type PolygonGeometry = Polygon | MultiPolygon;
export type LineGeometry = LineString | MultiLineString;

/** Tolerance (degrees) when deciding a vertex lies on the clip rectangle. */
export const BOUNDARY_EPS = 1e-9;

function ringArea2(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum);
}

/** Drops rings with < 4 positions or (near) zero area; a polygon needs a valid outer ring. */
function cleanPolygonCoords(rings: Position[][]): Position[][] | null {
  const kept: Position[][] = [];
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    if (ring.length < 4 || ringArea2(ring) < 1e-16) {
      if (i === 0) return null;
      continue;
    }
    kept.push(ring);
  }
  return kept.length ? kept : null;
}

/**
 * Clips a Polygon/MultiPolygon to `bounds` with turf bboxClip, one polygon at
 * a time (bboxClip throws on a ring that collapses to < 4 points, which
 * happens for features that merely touch the envelope), and removes
 * degenerate rings. Returns null when nothing is left.
 */
export function clipPolygonGeometry(geometry: PolygonGeometry, bounds: Bounds): PolygonGeometry | null {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const out: Position[][][] = [];
  for (const rings of polys) {
    if (!rings.length) continue;
    let clipped: Position[][] | null = null;
    try {
      const f = bboxClip({ type: 'Polygon', coordinates: rings }, bounds) as Feature<Polygon>;
      clipped = cleanPolygonCoords(f.geometry.coordinates);
    } catch {
      clipped = null;
    }
    if (clipped) out.push(clipped);
  }
  if (out.length === 0) return null;
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}

/** Clips a LineString/MultiLineString to `bounds`; returns null when nothing is left. */
export function clipLineGeometry(geometry: LineGeometry, bounds: Bounds): LineGeometry | null {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  const out: Position[][] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    let clipped: Position[][];
    try {
      const f = bboxClip({ type: 'LineString', coordinates: line }, bounds) as Feature<LineGeometry>;
      clipped = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    } catch {
      continue;
    }
    for (const part of clipped) {
      // lineclip can emit a 1-point (or zero-length) part where a line just touches the box.
      if (part.length >= 2 && !(part.length === 2 && samePoint(part[0], part[1]))) out.push(part);
    }
  }
  if (out.length === 0) return null;
  return out.length === 1 ? { type: 'LineString', coordinates: out[0] } : { type: 'MultiLineString', coordinates: out };
}

function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** True when segment a-b lies along one edge of the clip rectangle. */
export function segmentOnBoundary(a: Position, b: Position, bounds: Bounds, eps = BOUNDARY_EPS): boolean {
  const [w, s, e, n] = bounds;
  return (
    (Math.abs(a[0] - w) <= eps && Math.abs(b[0] - w) <= eps) ||
    (Math.abs(a[0] - e) <= eps && Math.abs(b[0] - e) <= eps) ||
    (Math.abs(a[1] - s) <= eps && Math.abs(b[1] - s) <= eps) ||
    (Math.abs(a[1] - n) <= eps && Math.abs(b[1] - n) <= eps)
  );
}

/**
 * The runs of one closed ring that do NOT lie on the clip rectangle. A ring
 * with no boundary segments comes back whole (a closed loop). Runs are
 * open lines, split wherever a boundary segment was removed.
 */
export function ringOutlineRuns(ring: Position[], bounds: Bounds): Position[][] {
  const n = ring.length - 1; // segments; ring[n] === ring[0]
  if (n < 1) return [];
  const onBoundary: boolean[] = [];
  let firstBoundary = -1;
  for (let i = 0; i < n; i++) {
    const on = segmentOnBoundary(ring[i], ring[i + 1], bounds);
    onBoundary.push(on);
    if (on && firstBoundary < 0) firstBoundary = i;
  }
  if (firstBoundary < 0) return [ring];

  // Walk the ring starting just after a boundary segment so no run wraps around the seam.
  const runs: Position[][] = [];
  let current: Position[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (firstBoundary + k) % n;
    if (onBoundary[i]) {
      if (current.length >= 2) runs.push(current);
      current = [];
    } else {
      if (current.length === 0) current.push(ring[i]);
      current.push(ring[i + 1]);
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

/** All non-boundary outline runs of a (already clipped) Polygon/MultiPolygon. */
export function polygonOutlineRuns(geometry: PolygonGeometry, bounds: Bounds): Position[][] {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const runs: Position[][] = [];
  for (const rings of polys) {
    for (const ring of rings) runs.push(...ringOutlineRuns(ring, bounds));
  }
  return runs;
}

export function linesToGeometry(lines: Position[][]): LineGeometry | null {
  if (lines.length === 0) return null;
  return lines.length === 1
    ? { type: 'LineString', coordinates: lines[0] }
    : { type: 'MultiLineString', coordinates: lines };
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Rounds a line to `decimals` places and drops consecutive duplicates; null if < 2 points remain. */
export function roundLine(line: Position[], decimals: number): Position[] | null {
  const out: Position[] = [];
  for (const p of line) {
    const q: Position = [round(p[0], decimals), round(p[1], decimals)];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out.length >= 2 ? out : null;
}

export function boundsToPolygon([w, s, e, n]: Bounds): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

/**
 * Rounds ring coordinates to `decimals` places but keeps every coordinate that
 * lies on the clip rectangle EXACTLY on it, so cell edges stay bit-identical
 * between adjacent packs. Drops consecutive duplicates; null if the outer
 * ring collapses.
 */
export function roundRings(rings: Position[][], bounds: Bounds, decimals: number): Position[][] | null {
  const [w, s, e, n] = bounds;
  const snapX = (x: number) =>
    Math.abs(x - w) <= BOUNDARY_EPS ? w : Math.abs(x - e) <= BOUNDARY_EPS ? e : round(x, decimals);
  const snapY = (y: number) =>
    Math.abs(y - s) <= BOUNDARY_EPS ? s : Math.abs(y - n) <= BOUNDARY_EPS ? n : round(y, decimals);
  const out: Position[][] = [];
  for (let r = 0; r < rings.length; r++) {
    const ring: Position[] = [];
    for (const p of rings[r]) {
      const q: Position = [snapX(p[0]), snapY(p[1])];
      const last = ring[ring.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) ring.push(q);
    }
    if (ring.length < 4 || ringArea2(ring) < 1e-16) {
      if (r === 0) return null;
      continue;
    }
    out.push(ring);
  }
  return out;
}
