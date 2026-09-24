import type { SQLiteDatabase } from 'expo-sqlite';

import { CELL_ZOOM, childTiles, type Tile } from './cells';
import { upsertCoverage } from './coverageRepo';
import { hasTile, openMBTiles, putTile, setMetadata } from './mbtiles';
import { DOWNLOAD_CONCURRENCY, TILE_INSERT_BATCH_SIZE, USER_AGENT, type LayerId } from './types';

export interface DownloadCellOptions {
  appDb: SQLiteDatabase;
  layer: LayerId;
  cx: number;
  cy: number;
  maxZoom: number;
  /** `{z}/{x}/{y}` XYZ tile URL template, e.g. USGS_TOPO_TILE_URL from src/map/usgsSources.ts. */
  tileUrlTemplate: string;
  attribution?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

function tileUrl(template: string, tile: Tile): string {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}

async function fetchTileWithRetry(
  url: string,
  signal: AbortSignal | undefined,
  attempt = 0
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });
    if (res.status === 404) return null; // no data for this tile — not an error
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buffer = await res.arrayBuffer();
    // USGS returns a small transparent/placeholder image for blank areas; skip
    // anything implausibly tiny rather than storing thousands of empty tiles.
    if (buffer.byteLength < 150) return null;
    return new Uint8Array(buffer);
  } catch (err) {
    if (signal?.aborted || attempt >= 4) throw err;
    const backoffMs = 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return fetchTileWithRetry(url, signal, attempt + 1);
  }
}

/**
 * Downloads every tile for one z10 cell, zoom CELL_ZOOM..maxZoom, into that
 * layer's shared MBTiles file (§4.5 Option A), then records coverage.
 *
 * Resumable: tiles already present in the MBTiles file are skipped, so
 * re-running after a partial failure only fetches what's missing (§4.4).
 */
export async function downloadCell(options: DownloadCellOptions): Promise<void> {
  const { appDb, layer, cx, cy, maxZoom, tileUrlTemplate, attribution, signal, onProgress } =
    options;

  const tiles: Tile[] = [];
  for (let z = CELL_ZOOM; z <= maxZoom; z++) {
    tiles.push(...childTiles(cx, cy, z));
  }

  const mbtiles = await openMBTiles(layer);
  await setMetadata(mbtiles, {
    name: layer,
    format: 'jpg',
    type: 'baselayer',
    ...(attribution ? { attribution } : {}),
  });

  await upsertCoverage(appDb, { layer, cx, cy, maxZoom, status: 'downloading', bytes: 0 });

  let done = 0;
  let bytesTotal = 0;
  let failed = false;
  let pendingBatch: { tile: Tile; data: Uint8Array }[] = [];

  const flushBatch = async () => {
    if (pendingBatch.length === 0) return;
    const batch = pendingBatch;
    pendingBatch = [];
    await mbtiles.withExclusiveTransactionAsync(async () => {
      for (const { tile, data } of batch) {
        await putTile(mbtiles, tile.z, tile.x, tile.y, data);
      }
    });
  };

  async function worker(queue: Tile[]) {
    for (const tile of queue) {
      if (signal?.aborted) return;
      try {
        if (await hasTile(mbtiles, tile.z, tile.x, tile.y)) {
          done++;
          continue;
        }
        const data = await fetchTileWithRetry(tileUrl(tileUrlTemplate, tile), signal);
        if (data) {
          pendingBatch.push({ tile, data });
          bytesTotal += data.byteLength;
          if (pendingBatch.length >= TILE_INSERT_BATCH_SIZE) await flushBatch();
        }
      } catch {
        failed = true;
      } finally {
        done++;
        onProgress?.(done, tiles.length);
      }
    }
  }

  // Simple fixed-size worker pool for the concurrency-4-6 rule in §4.4.
  const queues: Tile[][] = Array.from({ length: DOWNLOAD_CONCURRENCY }, () => []);
  tiles.forEach((tile, i) => queues[i % DOWNLOAD_CONCURRENCY].push(tile));
  await Promise.all(queues.map(worker));
  await flushBatch();

  await upsertCoverage(appDb, {
    layer,
    cx,
    cy,
    maxZoom,
    status: signal?.aborted ? 'partial' : failed ? 'partial' : 'complete',
    bytes: bytesTotal,
  });
}
