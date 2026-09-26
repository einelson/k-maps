import type { SQLiteDatabase } from 'expo-sqlite';

import { fetchLandPack } from '../packs/land.ts';
import { abortError, isAbortError } from '../packs/http.ts';
import { fetchMvumPack } from '../packs/mvum.ts';
import { fetchOsmRoadsPack } from '../packs/osm.ts';
import { deletePackCell, deletePackLayer, writePackCell } from '../packs/packStorage.ts';
import { fetchPoiPack } from '../packs/poi.ts';
import { fetchTrailsPack } from '../packs/trails.ts';
import { isCellBundled } from '../packs/region.ts';
import type { Bounds, PackContext, PackFeatureCollection, PackLayerId } from '../packs/types.ts';
import { cellBounds } from './cells';
import { US_COVERAGE } from './usCells';
import { deleteCoverage, getCoverage, upsertCoverage } from './coverageRepo';

/**
 * Vector data packs (land / mvum / trails / poi / osm) are downloaded per z10 cell
 * straight from the public services — see src/packs/. Unlike raster layers
 * there is one JSON file per cell (src/packs/packStorage.ts) and no zoom
 * range, so coverage rows use max_zoom 0.
 */
const FETCHERS: Record<PackLayerId, (bounds: Bounds, ctx: PackContext) => Promise<PackFeatureCollection>> = {
  land: (bounds, ctx) => fetchLandPack(bounds, ctx),
  mvum: fetchMvumPack,
  trails: fetchTrailsPack,
  poi: fetchPoiPack,
  osm: fetchOsmRoadsPack,
};

export interface DownloadPackCellOptions {
  appDb: SQLiteDatabase;
  layer: PackLayerId;
  cx: number;
  cy: number;
  signal?: AbortSignal;
  /** Fraction complete, 0..1. */
  onProgress?: (fraction: number) => void;
}

/**
 * Downloads one cell of one pack layer and records coverage:
 * `downloading` -> `complete` (with the file size). On abort the row becomes
 * `partial`, on any other error `failed` (and the error is rethrown) — unless
 * the cell was already `complete`, in which case the old file is still intact
 * (the new one is only written after a fully successful fetch) and that row
 * is restored. Cells inside the bundled starter region are marked complete
 * without fetching.
 */
export async function downloadPackCell(options: DownloadPackCellOptions): Promise<void> {
  const { appDb, layer, cx, cy, signal, onProgress } = options;

  if (isCellBundled(layer, cx, cy)) {
    await upsertCoverage(appDb, { layer, cx, cy, maxZoom: 0, status: 'complete', bytes: 0 });
    onProgress?.(1);
    return;
  }

  const prior = await getCoverage(appDb, layer, cx, cy);
  await upsertCoverage(appDb, { layer, cx, cy, maxZoom: 0, status: 'downloading', bytes: 0 });

  try {
    if (signal?.aborted) throw abortError();
    const collection = await FETCHERS[layer](cellBounds(cx, cy), {
      signal,
      us: US_COVERAGE,
      // Leave the last sliver for writing the file.
      onProgress: (fraction) => onProgress?.(Math.min(0.95, fraction * 0.95)),
    });
    if (signal?.aborted) throw abortError();
    const bytes = writePackCell(layer, cx, cy, collection);
    await upsertCoverage(appDb, { layer, cx, cy, maxZoom: 0, status: 'complete', bytes });
    onProgress?.(1);
  } catch (err) {
    if (prior?.status === 'complete') {
      await upsertCoverage(appDb, {
        layer,
        cx,
        cy,
        maxZoom: 0,
        status: 'complete',
        bytes: prior.bytes,
      });
    } else {
      await upsertCoverage(appDb, {
        layer,
        cx,
        cy,
        maxZoom: 0,
        status: isAbortError(err) || signal?.aborted ? 'partial' : 'failed',
        bytes: 0,
      });
    }
    if (isAbortError(err)) return;
    throw err;
  }
}

/** Deletes one downloaded cell's file and coverage row. */
export async function deletePackCellData(
  appDb: SQLiteDatabase,
  layer: PackLayerId,
  cx: number,
  cy: number
): Promise<void> {
  deletePackCell(layer, cx, cy);
  await deleteCoverage(appDb, layer, cx, cy);
}

/** Deletes every downloaded file of a pack layer and all of its coverage rows (bundled data is unaffected). */
export async function deletePackData(appDb: SQLiteDatabase, layer: PackLayerId): Promise<void> {
  deletePackLayer(layer);
  await appDb.runAsync('DELETE FROM coverage WHERE layer = ?', layer);
}
