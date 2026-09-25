import JSZip from 'jszip';
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { abortError, throwIfAborted } from '../packs/http.ts';
import { writePackCellText } from '../packs/packStorage.ts';
import {
  cellEntryName,
  REGION_PACK_MANIFEST_URL,
  regionPackUrl,
  type RegionEntry,
  type RegionPackFile,
} from '../packs/regionPacks.ts';
import { isCellBundled } from '../packs/region.ts';
import { listCoverage, upsertCoverage } from './coverageRepo';

/** Share of the progress bar the download takes; unzipping and writing thousands of cell files is the slow part. */
const DOWNLOAD_SHARE = 0.4;
/** Cells written per DB transaction (and per breath handed back to the UI thread). */
const BATCH_SIZE = 20;

export interface InstallRegionPackOptions {
  appDb: SQLiteDatabase;
  region: RegionEntry;
  pack: RegionPackFile;
  /** Where the manifest was fetched from; the zip is resolved next to it. */
  manifestUrl?: string;
  signal?: AbortSignal;
  /** Fraction complete, 0..1. */
  onProgress?: (fraction: number) => void;
}

export interface InstallRegionPackResult {
  /** Cells now covered for this layer (written, bundled or already fresher on the device). */
  cells: number;
  /** Bytes written to the device. */
  bytes: number;
  /** Cells left alone because the device already had newer data for them. */
  keptNewer: number;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Downloads one region pack (one layer of one region) and unzips it into the per-cell layout the map reads
 * (src/packs/packStorage.ts), recording each cell as `complete`. Nothing is written until the whole zip has
 * downloaded, parsed and turned out to hold every cell of the region, so a bad download changes nothing.
 * After that, cells are written in batches; an abort between batches keeps what was already installed.
 *
 * Two kinds of cell are left alone: bundled starter cells (their data ships in the app and would be drawn
 * twice) and cells the device fetched itself more recently than the pack was built.
 */
export async function installRegionPack(options: InstallRegionPackOptions): Promise<InstallRegionPackResult> {
  const { appDb, region, pack, signal, onProgress } = options;
  const url = regionPackUrl(options.manifestUrl ?? REGION_PACK_MANIFEST_URL, pack.file);
  const zipFile = new File(Paths.cache, `region-${region.id}-${pack.layer}.zip`);

  try {
    if (zipFile.exists) zipFile.delete();
    throwIfAborted(signal);
    onProgress?.(0);

    await File.downloadFileAsync(url, zipFile, {
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : pack.bytes;
        if (total > 0) onProgress?.(DOWNLOAD_SHARE * Math.min(1, bytesWritten / total));
      },
    });
    throwIfAborted(signal);

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await zipFile.bytes(), { checkCRC32: true });
    } catch {
      throw new Error(`${region.name} ${pack.layer} pack didn't download correctly — try again`);
    }
    const missing = region.cells.filter(([cx, cy]) => !zip.file(cellEntryName(cx, cy))).length;
    if (missing > 0) {
      throw new Error(`${region.name} ${pack.layer} pack is incomplete (${missing} cells missing) — try again later`);
    }

    // Newer-than-the-pack data already on the device wins over the pack's copy of that cell.
    const builtAt = Date.parse(pack.version);
    const freshOnDevice = new Set<string>();
    for (const row of await listCoverage(appDb)) {
      if (row.layer === pack.layer && row.status === 'complete' && row.bytes > 0 && row.updated_at > builtAt) {
        freshOnDevice.add(`${row.cell_x}_${row.cell_y}`);
      }
    }

    let bytes = 0;
    let keptNewer = 0;
    for (let start = 0; start < region.cells.length; start += BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = region.cells.slice(start, start + BATCH_SIZE);
      const rows: { cx: number; cy: number; bytes: number }[] = [];
      for (const [cx, cy] of batch) {
        if (isCellBundled(pack.layer, cx, cy)) {
          rows.push({ cx, cy, bytes: 0 });
        } else if (freshOnDevice.has(`${cx}_${cy}`)) {
          keptNewer++;
        } else {
          const json = await zip.file(cellEntryName(cx, cy))!.async('string');
          const written = writePackCellText(pack.layer, cx, cy, json);
          bytes += written;
          rows.push({ cx, cy, bytes: written });
        }
      }
      await appDb.withTransactionAsync(async () => {
        for (const { cx, cy, bytes: cellBytes } of rows) {
          await upsertCoverage(appDb, { layer: pack.layer, cx, cy, maxZoom: 0, status: 'complete', bytes: cellBytes });
        }
      });
      onProgress?.(DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * Math.min(1, (start + batch.length) / region.cells.length));
      await yieldToUi();
    }

    onProgress?.(1);
    return { cells: region.cells.length, bytes, keptNewer };
  } catch (err) {
    // The download library's own abort error isn't guaranteed to be named AbortError.
    if (signal?.aborted) throw abortError();
    throw err;
  } finally {
    try {
      if (zipFile.exists) zipFile.delete();
    } catch {
      // A leftover in the cache directory is harmless; the OS clears it eventually.
    }
  }
}
