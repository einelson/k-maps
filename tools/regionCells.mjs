/**
 * Regions the pack builder (tools/build_region_pack.mjs) knows about — the 50 states — and the z10 cells each covers.
 *
 * A state's cells are every cell its outline touches (tools/data/us-state-cells.json, written by
 * tools/build_us_outline.mjs from the Census Bureau's 1:500,000 state boundaries). Border cells are kept whole,
 * which is what you want near a state line, so a cell on a border is in both states' packs; its contents are the
 * same either way (a cell's data doesn't depend on which state asked for it).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.join(import.meta.dirname, '..');
const STATE_CELLS_FILE = path.join(repoRoot, 'tools', 'data', 'us-state-cells.json');

/** The 50 states. DC is only a few cells, all of them shared with Maryland and Virginia. */
const STATE_NAMES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

/** `{ idaho: { id: 'idaho', name: 'Idaho', state: 'ID' }, 'new-york': ... }` */
export const REGIONS = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([state, name]) => {
    const id = name.toLowerCase().replaceAll(' ', '-');
    return [id, { id, name, state }];
  })
);

let stateCells = null;

/** Sorted `[cx, cy]` list of the cells a region covers (row-major, north to south). */
export async function regionCells(region) {
  stateCells ??= JSON.parse(await readFile(STATE_CELLS_FILE, 'utf8'));
  const cells = stateCells[region.state];
  if (!cells) throw new Error(`No cells for ${region.state} — run node tools/build_us_outline.mjs`);
  return cells;
}
