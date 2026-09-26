/**
 * Where the US is, at the app's own granularity: for every z10 cell, is it wholly inside the US, wholly outside
 * it, or on a coast or border — and for those, exactly which part is US land.
 *
 * The data (assets/us/us-cells.json, built by tools/build_us_outline.mjs from the Census Bureau's 1:500,000
 * boundaries) is what keeps "likely private" off the ocean, Canada and Mexico, and stops the app fetching cells
 * that hold no US land at all. Everything here is pure (no native modules) so the pack builders share it.
 *
 * Size: cells wholly inside are stored as runs per row; coast/border cells store their US part on a GRID_STEPS
 * grid laid over the cell (about 8 m a step), delta-coded. The grid's ends are the cell's own edges, so a vertex
 * on an edge of the cell decodes back onto it exactly.
 */

import { cellBounds, lonLatToCell } from '../downloads/cells.ts';
import type { Bounds } from './types.ts';

/** One ring, closed implicitly: `[x0, y0, dx1, dy1, ...]` in grid steps from the cell's west / south edge. */
export type EncodedRing = number[];
/** A MultiPolygon: polygons, each a list of rings (outer first, then holes). */
export type EncodedMultiPolygon = EncodedRing[][];

export interface UsCellData {
  version: 1;
  source: string;
  /** Cells wholly inside the US: per cell row `cy`, `[cxStart, cxEnd, cxStart, cxEnd, ...]` inclusive runs. */
  rows: Record<string, number[]>;
  /** Cells only partly inside (`"<cx>_<cy>"`): their US part. Cells in neither list are outside. */
  edges: Record<string, EncodedMultiPolygon>;
}

export type UsCellStatus = 'inside' | 'edge' | 'outside';

/** Steps across a cell, each way (~8 m at 43 N): far finer than the 1:500,000 source the shapes come from. */
export const GRID_STEPS = 4096;

type Ring = [number, number][];
export type UsLand = { type: 'MultiPolygon'; coordinates: Ring[][] };

/**
 * Encodes polygons on the cell's GRID_STEPS grid. Vertices that land on the same step are merged, and a ring (or
 * polygon) that collapses to a sliver is dropped.
 */
export function encodeMultiPolygon(
  polygons: [number, number][][][],
  [west, south, east, north]: Bounds
): EncodedMultiPolygon {
  const width = east - west;
  const height = north - south;
  const out: EncodedMultiPolygon = [];
  for (const rings of polygons) {
    const encoded: EncodedRing[] = [];
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      const points: [number, number][] = [];
      for (const [lon, lat] of ring) {
        const point: [number, number] = [
          Math.min(GRID_STEPS, Math.max(0, Math.round(((lon - west) / width) * GRID_STEPS))),
          Math.min(GRID_STEPS, Math.max(0, Math.round(((lat - south) / height) * GRID_STEPS))),
        ];
        const last = points[points.length - 1];
        if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
      }
      // The closing vertex repeats the first; it is implied.
      if (
        points.length > 1 &&
        points[0][0] === points[points.length - 1][0] &&
        points[0][1] === points[points.length - 1][1]
      ) {
        points.pop();
      }
      if (points.length < 3) {
        if (r === 0) break; // no outer ring left: drop the polygon
        continue;
      }
      const flat: number[] = [];
      let px = 0;
      let py = 0;
      for (const [x, y] of points) {
        flat.push(x - px, y - py);
        px = x;
        py = y;
      }
      encoded.push(flat);
    }
    if (encoded.length > 0) out.push(encoded);
  }
  return out;
}

function decodeMultiPolygon(encoded: EncodedMultiPolygon, [west, south, east, north]: Bounds): Ring[][] {
  return encoded.map((rings) =>
    rings.map((flat) => {
      const ring: Ring = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < flat.length; i += 2) {
        x += flat[i];
        y += flat[i + 1];
        // The grid's last step is the cell's own edge, exactly (not west + width * 1, which can be off by a rounding).
        ring.push([
          x >= GRID_STEPS ? east : west + (x / GRID_STEPS) * (east - west),
          y >= GRID_STEPS ? north : south + (y / GRID_STEPS) * (north - south),
        ]);
      }
      ring.push([ring[0][0], ring[0][1]]);
      return ring;
    })
  );
}

function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface UsCoverage {
  /** Whether the cell is wholly US, wholly not, or part of each. */
  status(cx: number, cy: number): UsCellStatus;
  /** True when the cell holds any US land (inside or edge). */
  hasLand(cx: number, cy: number): boolean;
  /** The US part of a coast / border cell; null for cells that are wholly inside or outside. */
  edgeLand(cx: number, cy: number): UsLand | null;
  /** Whether a point is on US land (a point in a cell wholly outside the US never is). */
  contains(lon: number, lat: number): boolean;
}

/** Builds lookups over the data. Cheap to create; rows and decoded cells are indexed on first use. */
export function createUsCoverage(data: UsCellData): UsCoverage {
  const rowRuns = new Map<number, number[]>();
  for (const [cy, runs] of Object.entries(data.rows)) rowRuns.set(Number(cy), runs);
  const decoded = new Map<string, UsLand>();

  const status = (cx: number, cy: number): UsCellStatus => {
    if (`${cx}_${cy}` in data.edges) return 'edge';
    const runs = rowRuns.get(cy);
    if (runs) {
      for (let i = 0; i < runs.length; i += 2) if (cx >= runs[i] && cx <= runs[i + 1]) return 'inside';
    }
    return 'outside';
  };

  const edgeLand = (cx: number, cy: number): UsLand | null => {
    const key = `${cx}_${cy}`;
    const encoded = data.edges[key];
    if (!encoded) return null;
    let land = decoded.get(key);
    if (!land) {
      land = { type: 'MultiPolygon', coordinates: decodeMultiPolygon(encoded, cellBounds(cx, cy)) };
      decoded.set(key, land);
    }
    return land;
  };

  return {
    status,
    hasLand: (cx, cy) => status(cx, cy) !== 'outside',
    edgeLand,
    contains(lon, lat) {
      const { cx, cy } = lonLatToCell(lon, lat);
      const s = status(cx, cy);
      if (s !== 'edge') return s === 'inside';
      const land = edgeLand(cx, cy);
      if (!land) return false;
      return land.coordinates.some(
        ([outer, ...holes]) => inRing(outer, lon, lat) && !holes.some((hole) => inRing(hole, lon, lat))
      );
    },
  };
}

/**
 * The cell a pack fetch is for, when `bounds` is exactly that cell's rectangle (how the app and the pack builders
 * always call the fetchers); null for any other box, e.g. an ad-hoc bbox given to tools/fetch_pack.mjs, which then
 * isn't restricted to the US.
 */
export function cellOfBounds(bounds: Bounds): { cx: number; cy: number } | null {
  const { cx, cy } = lonLatToCell((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
  const box = cellBounds(cx, cy);
  const EPS = 1e-9;
  return box.every((v, i) => Math.abs(v - bounds[i]) <= EPS) ? { cx, cy } : null;
}
