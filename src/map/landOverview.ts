/**
 * The land layer when zoomed out. Downloaded cells draw one MapLibre source (plus layers) each, and only from zoom 9 in
 * (cellWindow.ts) — a state-sized view would be hundreds of cells. So below zoom 9 a downloaded state simply vanished,
 * and only the bundled starter region (one source, always drawn) showed public land and the "likely private" tint.
 *
 * The fix is an *overview*: the land fills of every downloaded cell in an 8 x 8 block, boiled down (only what the fills
 * need, vertices thinned to what is visible at these zooms) and joined into one file per block, so a whole state is a
 * handful of small sources instead of hundreds of big ones. Two levels of thinning — a coarse one for state-sized views
 * (zoom 5-7.5, ~5 KB a cell) and a finer one for county-sized views (7.5-9, ~24 KB a cell) — keep what is mounted at
 * once to a few MB. Built on the device from the cells it already has, cached, and rebuilt when a block's cells change.
 *
 * Pure (no React, no native modules) so it is unit-testable; the file work is landOverviewBuild.ts, the hook is
 * useLandOverview.ts.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

import { cellRangeInBounds } from '../downloads/cells';
import { CELL_WINDOW_MIN_ZOOM, type MapView } from './cellWindow';

/** Cells per block side. */
export const OVERVIEW_BLOCK_CELLS = 8;
/** Below this a phone view spans more blocks than can be mounted, so a partial overview would only mislead. */
export const OVERVIEW_MIN_ZOOM = 5;
/** From here downloaded cells draw in full detail (cellWindow.ts), so the overview steps aside. */
export const OVERVIEW_MAX_ZOOM = CELL_WINDOW_MIN_ZOOM;

export type OverviewLevel = 'coarse' | 'fine';

export interface OverviewLevelSpec {
  /**
   * Degrees: vertices closer than this to the last one kept are dropped. 0.03 is ~3 km, about a screen pixel at zoom
   * 5-6; 0.006 is ~650 m, about a pixel at zoom 7-8. Measured on the bundled starter region, one of the most
   * fragmented stretches of public land there is: about 5 KB and 24 KB a cell.
   */
  tolerance: number;
  minZoom: number;
  maxZoom: number;
  /** The most blocks mounted at once — a phone view at the level's lowest zoom, margin included. */
  maxBlocks: number;
}

export const OVERVIEW_LEVELS: Record<OverviewLevel, OverviewLevelSpec> = {
  coarse: { tolerance: 0.03, minZoom: OVERVIEW_MIN_ZOOM, maxZoom: 7.5, maxBlocks: 24 },
  fine: { tolerance: 0.006, minZoom: 7.5, maxZoom: OVERVIEW_MAX_ZOOM, maxBlocks: 12 },
};

/** Which level draws at a zoom, or null when the overview is not used (too far out, or detailed cells draw instead). */
export function overviewLevelFor(zoom: number): OverviewLevel | null {
  if (!Number.isFinite(zoom)) return null;
  for (const level of ['fine', 'coarse'] as const) {
    const { minZoom, maxZoom } = OVERVIEW_LEVELS[level];
    if (zoom >= minZoom && zoom < maxZoom) return level;
  }
  return null;
}

export interface OverviewBlock {
  bx: number;
  by: number;
}

/** A downloaded land cell, with when it was last written (for knowing a block's file is out of date). */
export interface LandCellRef {
  cx: number;
  cy: number;
  updatedAt: number;
}

export const overviewBlockKey = ({ bx, by }: OverviewBlock) => `${bx}_${by}`;

export const overviewBlockOf = (cx: number, cy: number): OverviewBlock => ({
  bx: Math.floor(cx / OVERVIEW_BLOCK_CELLS),
  by: Math.floor(cy / OVERVIEW_BLOCK_CELLS),
});

/**
 * A short fingerprint of the cells a block was built from: a different count (cells added or deleted) or a newer cell
 * (one fetched again) means the file no longer matches what is on the phone.
 */
export function overviewStamp(cells: readonly LandCellRef[]): string {
  let latest = 0;
  let sum = 0;
  for (const { updatedAt } of cells) {
    latest = Math.max(latest, updatedAt);
    sum += updatedAt;
  }
  return `${cells.length}:${latest}:${sum}`;
}

export interface WantedBlock {
  block: OverviewBlock;
  /** Downloaded land cells of the block, ordered so the stamp and the build are stable. */
  cells: LandCellRef[];
  stamp: string;
}

export interface Wanted {
  level: OverviewLevel;
  blocks: WantedBlock[];
}

/**
 * The blocks to draw for a view: those with downloaded land in or one block beyond it (so a short pan shows no gap),
 * nearest the centre first, at most the level's `maxBlocks`. Null outside the zoom range where the overview is used.
 */
export function overviewBlocksFor(view: MapView, landCells: readonly LandCellRef[]): Wanted | null {
  const level = overviewLevelFor(view.zoom);
  if (level === null) return null;
  const { cxMin, cxMax, cyMin, cyMax } = cellRangeInBounds(view.bounds);
  const bxMin = Math.floor(cxMin / OVERVIEW_BLOCK_CELLS) - 1;
  const bxMax = Math.floor(cxMax / OVERVIEW_BLOCK_CELLS) + 1;
  const byMin = Math.floor(cyMin / OVERVIEW_BLOCK_CELLS) - 1;
  const byMax = Math.floor(cyMax / OVERVIEW_BLOCK_CELLS) + 1;

  const groups = new Map<string, { block: OverviewBlock; cells: LandCellRef[] }>();
  for (const cell of landCells) {
    const block = overviewBlockOf(cell.cx, cell.cy);
    if (block.bx < bxMin || block.bx > bxMax || block.by < byMin || block.by > byMax) continue;
    const key = overviewBlockKey(block);
    const group = groups.get(key) ?? { block, cells: [] };
    group.cells.push(cell);
    groups.set(key, group);
  }

  // Distance in block units from the centre of the view to the middle of each block.
  const centre = {
    x: (cxMin + cxMax + 1) / 2 / OVERVIEW_BLOCK_CELLS,
    y: (cyMin + cyMax + 1) / 2 / OVERVIEW_BLOCK_CELLS,
  };
  const blocks = [...groups.values()]
    .map((group) => ({
      ...group,
      distance: (group.block.bx + 0.5 - centre.x) ** 2 + (group.block.by + 0.5 - centre.y) ** 2,
    }))
    .sort((a, b) => a.distance - b.distance || a.block.bx - b.block.bx || a.block.by - b.block.by)
    .slice(0, OVERVIEW_LEVELS[level].maxBlocks)
    .map(({ block, cells }) => {
      const ordered = [...cells].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
      return { block, cells: ordered, stamp: overviewStamp(ordered) };
    });
  return { level, blocks };
}

/** Whether two wanted lists ask for the same files, so a re-render can be skipped. */
export function sameWanted(a: Wanted | null, b: Wanted | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.level === b.level &&
    a.blocks.length === b.blocks.length &&
    a.blocks.every(
      (w, i) => overviewBlockKey(w.block) === overviewBlockKey(b.blocks[i].block) && w.stamp === b.blocks[i].stamp
    )
  );
}

// --- Thinning ------------------------------------------------------------------------------------------------------

/** Coordinates are rounded to 4 decimals (~11 m). */
const round = (value: number) => Number(value.toFixed(4));

/** `[west, south, east, north]` of the cell the geometry was clipped to. */
export type CellBox = [number, number, number, number];

/**
 * A lattice over one cell, about `tolerance` degrees between points, with the cell's own edges as lattice lines. Every
 * vertex is moved to its nearest lattice point. That matters more than it sounds: a public polygon and the "likely
 * private" polygon beside it share a border, and thinning each one on its own (dropping vertices by distance, say)
 * puts the same border in two different places and opens gaps. Snapping is the same for both, so shared borders stay
 * shared. Neighbouring cells share edges, and their lattices line up on them, so cells still meet with no seam.
 */
function latticeOf([west, south, east, north]: CellBox, tolerance: number) {
  const columns = Math.max(1, Math.round((east - west) / tolerance));
  const rows = Math.max(1, Math.round((north - south) / tolerance));
  return {
    columns,
    rows,
    /** Nearest lattice point as integer `[i, j]` (0 at the west / south edge). */
    snap: ([x, y]: Position): [number, number] => [
      Math.round(((x - west) / (east - west)) * columns),
      Math.round(((y - south) / (north - south)) * rows),
    ],
    /** The point back in degrees. */
    at: ([i, j]: [number, number]): Position => [
      round(i === columns ? east : west + (i / columns) * (east - west)),
      round(j === rows ? north : south + (j / rows) * (north - south)),
    ],
  };
}

type Lattice = ReturnType<typeof latticeOf>;
type Point = [number, number];

/** True when b lies on the straight line from a to c (integer lattice points, so this is exact). */
const collinear = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0;

/**
 * Snaps a ring to the lattice and removes what that leaves redundant: repeated points, points in the middle of a
 * straight run, and spikes that go out and come straight back. A ring left with fewer than 3 corners is nothing at this
 * scale and comes back null.
 */
function thinRing(ring: Position[], lattice: Lattice): Position[] | null {
  if (ring.length < 4) return null;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const points: Point[] = [];
  for (const position of closed ? ring.slice(0, -1) : ring) {
    const point = lattice.snap(position);
    const last = points[points.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }

  // Straight runs and spikes, repeated until nothing more goes (a spike's removal can expose a straight run). Around
  // the ring, so the join between the last point and the first is tidied too.
  let changed = true;
  while (changed && points.length >= 3) {
    changed = false;
    for (let i = 0; i < points.length && points.length >= 3; i++) {
      const previous = points[(i + points.length - 1) % points.length];
      const next = points[(i + 1) % points.length];
      const here = points[i];
      const spike = previous[0] === next[0] && previous[1] === next[1];
      if (spike || collinear(previous, here, next)) {
        points.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  if (points.length < 3) return null;
  const out = points.map((point) => lattice.at(point));
  out.push([out[0][0], out[0][1]]);
  return out;
}

function thinPolygon(rings: Position[][], lattice: Lattice): Position[][] | null {
  const outer = thinRing(rings[0] ?? [], lattice);
  if (!outer) return null;
  const holes = rings
    .slice(1)
    .map((ring) => thinRing(ring, lattice))
    .filter((ring): ring is Position[] => ring !== null);
  return [outer, ...holes];
}

/** The fills of one land cell, thinned: `public` (by access) and `private` polygons only — no outlines, no other properties. */
export function overviewFeatures(collection: FeatureCollection, box: CellBox, tolerance: number): Feature[] {
  const lattice = latticeOf(box, tolerance);
  const out: Feature[] = [];
  for (const feature of collection.features ?? []) {
    const kind = feature.properties?.kind;
    if (kind !== 'public' && kind !== 'private') continue;
    const geometry = feature.geometry as Geometry | null;
    let thinned: Geometry | null = null;
    if (geometry?.type === 'Polygon') {
      const coordinates = thinPolygon(geometry.coordinates, lattice);
      if (coordinates) thinned = { type: 'Polygon', coordinates };
    } else if (geometry?.type === 'MultiPolygon') {
      const coordinates = geometry.coordinates
        .map((polygon) => thinPolygon(polygon, lattice))
        .filter((polygon): polygon is Position[][] => polygon !== null);
      if (coordinates.length > 0) thinned = { type: 'MultiPolygon', coordinates };
    }
    if (!thinned) continue;
    const properties = kind === 'public' ? { kind, Pub_Access: feature.properties?.Pub_Access ?? 'UK' } : { kind };
    out.push({ type: 'Feature', properties, geometry: thinned });
  }
  return out;
}
