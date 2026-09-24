/**
 * The bundled starter region (Treasure Valley / southwest Idaho, matching the
 * app's default map center), snapped to z10 cells so it never overlaps a
 * downloaded cell: the smallest set of cells covering STARTER_BBOX_WSEN.
 * Land, MVUM and POI ship bundled for this rectangle (assets/land,
 * assets/mvum, assets/poi); OSM roads are never bundled.
 */

import { cellBounds, lonLatToCell } from '../downloads/cells.ts';
import type { Bounds, PackLayerId } from './types.ts';

/** The region the bundled data was originally scoped to: [west, south, east, north]. */
export const STARTER_BBOX_WSEN: Bounds = [-117.0, 43.0, -115.5, 44.2];

export interface CellRect {
  cxMin: number;
  cxMax: number;
  cyMin: number;
  cyMax: number;
}

/** Smallest cell rectangle covering `bounds` (an east/south edge exactly on a cell border doesn't pull in the next cell). */
export function cellRectCovering([west, south, east, north]: Bounds): CellRect {
  const EPS = 1e-9;
  const nw = lonLatToCell(west, north);
  const se = lonLatToCell(east - EPS, south + EPS);
  return { cxMin: nw.cx, cxMax: se.cx, cyMin: nw.cy, cyMax: se.cy };
}

/** cx 179..183, cy 371..376 (5 x 6 = 30 cells). Asserted against cellRectCovering(STARTER_BBOX_WSEN) in region.test.ts. */
export const BUNDLED_CELL_RECT: CellRect = { cxMin: 179, cxMax: 183, cyMin: 371, cyMax: 376 };

/** Union bounds [west, south, east, north] of BUNDLED_CELL_RECT. */
export function bundledBounds(): Bounds {
  const northwest = cellBounds(BUNDLED_CELL_RECT.cxMin, BUNDLED_CELL_RECT.cyMin);
  const southeast = cellBounds(BUNDLED_CELL_RECT.cxMax, BUNDLED_CELL_RECT.cyMax);
  return [northwest[0], southeast[1], southeast[2], northwest[3]];
}

const BUNDLED_LAYERS: readonly PackLayerId[] = ['land', 'mvum', 'poi'];

/** True when this layer's data for the cell already ships with the app (never true for `osm`). */
export function isCellBundled(layer: PackLayerId, cx: number, cy: number): boolean {
  if (!BUNDLED_LAYERS.includes(layer)) return false;
  const r = BUNDLED_CELL_RECT;
  return cx >= r.cxMin && cx <= r.cxMax && cy >= r.cyMin && cy <= r.cyMax;
}
