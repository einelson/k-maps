/**
 * Shared region for the `tools/*` scripts — Treasure Valley / southwest
 * Idaho, matching the app's default map center (src/map/MapView.tsx).
 *
 * The bundled starter data is CELL-ALIGNED (z10 tiles, src/downloads/cells.ts)
 * so it never overlaps cells downloaded on-device: `BBOX_WSEN` is the union of
 * the smallest set of cells covering the original `STARTER_BBOX_WSEN`
 * [-117.0, 43.0, -115.5, 44.2]. The single source of truth is
 * src/packs/region.ts (loaded here with node's type stripping).
 *
 * [west, south, east, north] / EPSG:4326.
 */
import {
  BUNDLED_CELL_RECT,
  bundledBounds,
  STARTER_BBOX_WSEN,
} from '../src/packs/region.ts';

export { BUNDLED_CELL_RECT, STARTER_BBOX_WSEN };
export const BBOX_WSEN = bundledBounds();

export function bboxOverpass([west, south, east, north] = BBOX_WSEN) {
  return `${south},${west},${north},${east}`;
}

export function bboxArcGisEnvelope([west, south, east, north] = BBOX_WSEN) {
  return `${west},${south},${east},${north}`;
}
