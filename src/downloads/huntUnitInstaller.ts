import JSZip from 'jszip';
import { File, Paths } from 'expo-file-system';

import { writeHuntUnits } from '../huntUnits/storage';
import { abortError, throwIfAborted } from '../packs/http.ts';
import {
  HUNT_UNITS_ENTRY_NAME,
  REGION_PACK_MANIFEST_URL,
  regionPackUrl,
  type HuntUnitPackEntry,
} from '../packs/regionPacks.ts';

/** Share of the progress bar the download takes; the rest is unzipping, checking and writing. */
const DOWNLOAD_SHARE = 0.75;

export interface InstallHuntUnitPackOptions {
  pack: HuntUnitPackEntry;
  /** Where the manifest was fetched from; the zip is resolved next to it. */
  manifestUrl?: string;
  signal?: AbortSignal;
  /** Fraction complete, 0..1. */
  onProgress?: (fraction: number) => void;
}

/**
 * Downloads one state's hunting units and stores them on the device as a single file the map reads with no network.
 * Nothing is written until the zip has downloaded, passed its checksums, and its contents match what the manifest
 * promised (right number of units, only the sets it lists) — so a bad or truncated download changes nothing.
 * Returns the bytes now stored.
 */
export async function installHuntUnitPack(options: InstallHuntUnitPackOptions): Promise<number> {
  const { pack, signal, onProgress } = options;
  const url = regionPackUrl(options.manifestUrl ?? REGION_PACK_MANIFEST_URL, pack.file);
  const zipFile = new File(Paths.cache, `huntunits-${pack.state}.zip`);
  const bad = () => new Error(`${pack.name} hunting units didn't download correctly — try again`);

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

    let json: string;
    try {
      const zip = await JSZip.loadAsync(await zipFile.bytes(), { checkCRC32: true });
      const entry = zip.file(HUNT_UNITS_ENTRY_NAME);
      if (!entry) throw bad();
      json = await entry.async('string');
    } catch {
      throw bad();
    }
    throwIfAborted(signal);

    // Parse once to check it is what the manifest says it is; the map itself loads the file natively.
    let collection: { type?: unknown; features?: unknown };
    try {
      collection = JSON.parse(json);
    } catch {
      throw bad();
    }
    const features = Array.isArray(collection.features) ? (collection.features as { properties?: { set?: unknown } }[]) : null;
    const knownSets = new Set(pack.sets.map((s) => s.id));
    if (
      collection.type !== 'FeatureCollection' ||
      !features ||
      features.length !== pack.unitCount ||
      !features.every((f) => typeof f.properties?.set === 'string' && knownSets.has(f.properties.set))
    ) {
      throw bad();
    }

    onProgress?.(DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) / 2);
    const bytes = writeHuntUnits(pack.state, json);
    onProgress?.(1);
    return bytes;
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
