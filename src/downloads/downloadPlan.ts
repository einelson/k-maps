/**
 * Turning "these areas, these layers" into the list of things to fetch, and how big and slow that is.
 *
 * Work that is already on the device is left out — a big selection is often re-run after a hiccup, or
 * overlaps something downloaded earlier, and fetching it all again would waste minutes and the public
 * services' goodwill. Pure (no React, no native modules) so it is unit-testable.
 */

import type { CoverageRow } from '../data/types';
import { isCellBundled } from '../packs/region';
import { layerPacks, type RegionEntry, type RegionLayerPacks } from '../packs/regionPacks';
import type { PackLayerId } from '../packs/types';
import { cellCenter, type Cell } from './blockSelect';
import { LAYER_LABELS, packOption } from './downloadOptions';
import { ESTIMATED_BYTES_PER_CELL } from './cells';
import type { LayerId } from './types';

/** One layer of one area, fetched from the public services / tile servers on the device. */
export interface CellJob {
  /** `tiles` = offline map pictures (one MBTiles file per layer); `pack` = one overlay-data file per area. */
  kind: 'tiles' | 'pack';
  layer: LayerId;
  cx: number;
  cy: number;
}

/** One layer of a whole state, installed from the ready-made pack (much quicker than fetching its areas one by one). */
export interface RegionJob {
  kind: 'region';
  layer: PackLayerId;
  region: RegionEntry;
  /** The pack's zip(s) — several when the layer is split into parts. */
  packs: RegionLayerPacks;
}

export type DownloadJob = CellJob | RegionJob;

export interface PlanInput {
  cells: readonly Cell[];
  tileLayers: readonly LayerId[];
  packLayers: readonly PackLayerId[];
  maxZoom: number;
  coverage: readonly CoverageRow[];
  /**
   * The published ready-made packs of the states picked whole. Overlay data for those states comes from the pack
   * instead of area by area; everything else (map pictures, areas outside these states) is unchanged.
   */
  regions?: readonly RegionEntry[];
}

export interface DownloadPlan {
  jobs: DownloadJob[];
  /** Layer-area pairs already fully on the device. */
  skipped: number;
}

const coverageKey = (layer: string, cx: number, cy: number) => `${layer}:${cx}:${cy}`;

/**
 * The jobs still to do. Whole-state overlay data first (a few big installs from the ready-made packs), then area by
 * area (so an area is finished before the next starts, and cancelling leaves whole areas usable), overlay data before
 * map pictures — it's small and is what most people are after.
 * A pack is done once its coverage row is complete; map pictures also need to reach the zoom asked for.
 */
export function planDownload({
  cells,
  tileLayers,
  packLayers,
  maxZoom,
  coverage,
  regions = [],
}: PlanInput): DownloadPlan {
  const done = new Map<string, CoverageRow>();
  for (const row of coverage) {
    if (row.status === 'complete') done.set(coverageKey(row.layer, row.cell_x, row.cell_y), row);
  }

  const jobs: DownloadJob[] = [];
  let skipped = 0;

  // Overlay data of a state picked whole: one install per layer. A layer already complete for every one of the state's
  // areas is left out; anything less (nothing, or a few areas loaded while panning) installs the pack, which is far
  // quicker than fetching the rest one area at a time. Its areas then need no job of their own.
  const packed = new Set<string>();
  for (const region of regions) {
    const groups = layerPacks(region);
    for (const layer of packLayers) {
      const packs = groups.find((group) => group.layer === layer);
      if (!packs) continue; // no ready-made pack for this layer: areas are fetched one by one below
      for (const [cx, cy] of region.cells) packed.add(coverageKey(layer, cx, cy));
      if (region.cells.every(([cx, cy]) => isCellBundled(layer, cx, cy) || done.has(coverageKey(layer, cx, cy)))) {
        skipped += region.cells.length;
      } else {
        jobs.push({ kind: 'region', layer, region, packs });
      }
    }
  }

  for (const { cx, cy } of cells) {
    for (const layer of packLayers) {
      if (packed.has(coverageKey(layer, cx, cy))) continue;
      if (done.has(coverageKey(layer, cx, cy))) skipped++;
      else jobs.push({ kind: 'pack', layer, cx, cy });
    }
    for (const layer of tileLayers) {
      const row = done.get(coverageKey(layer, cx, cy));
      if (row && row.max_zoom >= maxZoom) skipped++;
      else jobs.push({ kind: 'tiles', layer, cx, cy });
    }
  }
  return { jobs, skipped };
}

export interface DownloadEstimate {
  bytes: number;
  /** Time for the overlay-data jobs only — map pictures depend too much on the connection to guess. */
  packSeconds: number;
}

/** Typical size of one area's map pictures for a layer down to `maxZoom` — the middle of the measured range (§4.2). 0 when unmeasured. */
export function tileBytesPerCell(layer: LayerId, maxZoom: number): number {
  const sizes = ESTIMATED_BYTES_PER_CELL[maxZoom];
  if (!sizes) return 0;
  const [low, high] = layer === 'satellite' ? sizes.imagery : sizes.topo; // hybrid is sized like topo
  return (low + high) / 2;
}

/** A layer's zip is about this many times smaller than what it unpacks to (measured 2-4.4x across the published packs). */
const UNZIPPED_RATIO = 4;
/** Ready-made packs: a typical phone connection, and the time to unzip and write one area's file. */
const REGION_BYTES_PER_SECOND = 1_500_000;
const REGION_SECONDS_PER_CELL = 0.05;

/** Rough size and time of a set of jobs. Sizes are what ends up on the phone. */
export function estimateDownload(jobs: readonly DownloadJob[], maxZoom: number): DownloadEstimate {
  let bytes = 0;
  let packSeconds = 0;
  for (const job of jobs) {
    if (job.kind === 'tiles') {
      bytes += tileBytesPerCell(job.layer, maxZoom);
    } else if (job.kind === 'region') {
      bytes += job.packs.bytes * UNZIPPED_RATIO;
      packSeconds += job.packs.bytes / REGION_BYTES_PER_SECOND + job.region.cells.length * REGION_SECONDS_PER_CELL;
    } else {
      const option = packOption(job.layer);
      bytes += option?.estimateBytes ?? 0;
      packSeconds += option?.estimateSeconds ?? 0;
    }
  }
  return { bytes, packSeconds };
}

/** "43.6°N 116.2°W" — where an area is, since nobody knows a cell by its grid number. */
export function placeLabel(cell: Cell): string {
  const [lon, lat] = cellCenter(cell);
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** What a job is called in progress and error messages: "Public land · 43.6°N 116.2°W", or "Public land · all of Idaho". */
export function jobLabel(job: DownloadJob): string {
  const layer = LAYER_LABELS[job.layer] ?? job.layer;
  return job.kind === 'region' ? `${layer} · all of ${job.region.name}` : `${layer} · ${placeLabel(job)}`;
}
