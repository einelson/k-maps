/**
 * Regions the pack builder (tools/build_region_pack.mjs) knows about — the 50 states — and the z10 cells each covers.
 *
 * A state's cells are every cell its outline touches (assets/us/us-state-cells.json, written by
 * tools/build_us_outline.mjs from the Census Bureau's 1:500,000 state boundaries). Border cells are kept whole,
 * which is what you want near a state line, so a cell on a border is in both states' packs; its contents are the
 * same either way (a cell's data doesn't depend on which state asked for it).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { US_STATES } from '../src/packs/usStates.ts';

const repoRoot = path.join(import.meta.dirname, '..');
const STATE_CELLS_FILE = path.join(repoRoot, 'assets', 'us', 'us-state-cells.json');

/** `{ idaho: { id: 'idaho', name: 'Idaho', state: 'ID' }, 'new-york': ... }` */
export const REGIONS = Object.fromEntries(US_STATES.map(({ code, name, id }) => [id, { id, name, state: code }]));

let stateCells = null;

/** Sorted `[cx, cy]` list of the cells a region covers (row-major, north to south). */
export async function regionCells(region) {
  stateCells ??= JSON.parse(await readFile(STATE_CELLS_FILE, 'utf8'));
  const cells = stateCells[region.state];
  if (!cells) throw new Error(`No cells for ${region.state} — run node tools/build_us_outline.mjs`);
  return cells;
}
