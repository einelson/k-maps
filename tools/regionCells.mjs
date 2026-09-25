/**
 * Regions the pack builder (tools/build_region_pack.mjs) knows about, and the z10 cells each one covers.
 *
 * A region is a bounding box plus an optional outline (GeoJSON polygons). With an outline, only cells that
 * touch it are kept — so a state's rectangle doesn't drag in half of Montana and Oregon. Border cells are
 * kept whole, which is what you want for hunting near a state line. To add a region, add an entry here.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { bbox as turfBbox, bboxPolygon, booleanIntersects } from '@turf/turf';

import { cellBounds, cellsInBounds } from '../src/downloads/cells.ts';

const repoRoot = path.join(import.meta.dirname, '..');

export const REGIONS = {
  idaho: {
    id: 'idaho',
    name: 'Idaho',
    /** [west, south, east, north] */
    bbox: [-117.25, 41.98, -111.04, 49.01],
    /** The IDFG game-unit polygons tile the whole state, so together they are Idaho's outline. */
    outline: 'assets/idfg/game-units.json',
  },
};

/** Sorted `[cx, cy]` list of the cells a region covers (row-major, north to south). */
export async function regionCells(region) {
  const candidates = cellsInBounds(region.bbox);
  if (!region.outline) return candidates.map(({ cx, cy }) => [cx, cy]);

  const outline = JSON.parse(await readFile(path.join(repoRoot, region.outline), 'utf8'));
  const parts = outline.features.map((feature) => ({ feature, box: turfBbox(feature) }));
  const cells = [];
  for (const { cx, cy } of candidates) {
    const cellBox = cellBounds(cx, cy);
    const cell = bboxPolygon(cellBox);
    const touches = parts.some(({ feature, box }) => {
      // Cheap rectangle test first; the polygon test only runs for the few units near the cell.
      if (box[2] < cellBox[0] || box[0] > cellBox[2] || box[3] < cellBox[1] || box[1] > cellBox[3]) return false;
      return booleanIntersects(cell, feature);
    });
    if (touches) cells.push([cx, cy]);
  }
  return cells;
}
