import type { CoverageRow } from '../data/types';
import { isCellBundled } from '../packs/region.ts';
import type { RegionEntry, RegionPackFile } from '../packs/regionPacks.ts';

export type RegionPackState =
  /** Nothing of this pack's cells is on the device. */
  | 'none'
  /** Some cells are (e.g. loaded while panning, or an install was cancelled). */
  | 'partial'
  /** Every cell is on the device and matches the published version (or came from somewhere other than a pack). */
  | 'installed'
  /** Every cell is on the device but a newer pack has been published. */
  | 'update';

export interface RegionPackStatus {
  state: RegionPackState;
  /** Region cells with data on the device for this layer (bundled starter cells count). */
  covered: number;
  total: number;
}

/**
 * What the Downloads screen shows for one pack, derived from the coverage table — so cells loaded while
 * panning count toward it — plus the version recorded when the pack was last installed.
 */
export function regionPackStatus(
  region: RegionEntry,
  pack: RegionPackFile,
  coverage: readonly CoverageRow[],
  installedVersion: string | undefined
): RegionPackStatus {
  const complete = new Set<string>();
  for (const row of coverage) {
    if (row.layer === pack.layer && row.status === 'complete') complete.add(`${row.cell_x}_${row.cell_y}`);
  }
  const covered = region.cells.filter(([cx, cy]) => isCellBundled(pack.layer, cx, cy) || complete.has(`${cx}_${cy}`)).length;
  const total = region.cells.length;

  let state: RegionPackState;
  if (covered === 0) state = 'none';
  else if (covered < total) state = 'partial';
  else state = installedVersion !== undefined && installedVersion !== pack.version ? 'update' : 'installed';
  return { state, covered, total };
}
