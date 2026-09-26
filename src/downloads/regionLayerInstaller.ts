import type { SQLiteDatabase } from 'expo-sqlite';

import type { RegionEntry, RegionLayerPacks } from '../packs/regionPacks.ts';
import { installRegionPack } from './regionPackInstaller';

export interface InstallRegionLayerOptions {
  appDb: SQLiteDatabase;
  region: RegionEntry;
  /** One layer of the region: its zip(s). */
  packs: RegionLayerPacks;
  manifestUrl?: string;
  signal?: AbortSignal;
  /** Fraction of the whole layer, 0..1 (parts weighted by their size). */
  onProgress?: (fraction: number) => void;
}

/**
 * Installs every part of one layer of a region, one after another, as a single download. A big layer is split into
 * several zips because the app unzips a file in memory; callers see one job with one progress bar.
 */
export async function installRegionLayer({
  appDb,
  region,
  packs,
  manifestUrl,
  signal,
  onProgress,
}: InstallRegionLayerOptions): Promise<void> {
  let doneBytes = 0;
  for (const file of packs.files) {
    await installRegionPack({
      appDb,
      region,
      pack: file,
      manifestUrl,
      signal,
      onProgress: (fraction) =>
        onProgress?.(packs.bytes > 0 ? (doneBytes + fraction * file.bytes) / packs.bytes : fraction),
    });
    doneBytes += file.bytes;
  }
}
