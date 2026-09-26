/**
 * Turning "these areas, these layers" into the list of things to fetch, and how big and slow that is.
 *
 * Work that is already on the device is left out — a big selection is often re-run after a hiccup, or
 * overlaps something downloaded earlier, and fetching it all again would waste minutes and the public
 * services' goodwill. Pure (no React, no native modules) so it is unit-testable.
 */

import type { CoverageRow } from '../data/types';
import type { PackLayerId } from '../packs/types';
import { cellCenter, type Cell } from './blockSelect';
import { LAYER_LABELS, packOption } from './downloadOptions';
import { ESTIMATED_BYTES_PER_CELL } from './cells';
import type { LayerId } from './types';

export interface DownloadJob {
  /** `tiles` = offline map pictures (one MBTiles file per layer); `pack` = one overlay-data file per area. */
  kind: 'tiles' | 'pack';
  layer: LayerId;
  cx: number;
  cy: number;
}

export interface PlanInput {
  cells: readonly Cell[];
  tileLayers: readonly LayerId[];
  packLayers: readonly PackLayerId[];
  maxZoom: number;
  coverage: readonly CoverageRow[];
}

export interface DownloadPlan {
  jobs: DownloadJob[];
  /** Layer-area pairs already fully on the device. */
  skipped: number;
}

const coverageKey = (layer: string, cx: number, cy: number) => `${layer}:${cx}:${cy}`;

/**
 * The jobs still to do, area by area (so an area is finished before the next starts, and cancelling
 * leaves whole areas usable), overlay data first — it's small and is what most people are after.
 * A pack is done once its coverage row is complete; map pictures also need to reach the zoom asked for.
 */
export function planDownload({ cells, tileLayers, packLayers, maxZoom, coverage }: PlanInput): DownloadPlan {
  const done = new Map<string, CoverageRow>();
  for (const row of coverage) {
    if (row.status === 'complete') done.set(coverageKey(row.layer, row.cell_x, row.cell_y), row);
  }

  const jobs: DownloadJob[] = [];
  let skipped = 0;
  for (const { cx, cy } of cells) {
    for (const layer of packLayers) {
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

/** Rough size and time of a set of jobs. */
export function estimateDownload(jobs: readonly DownloadJob[], maxZoom: number): DownloadEstimate {
  let bytes = 0;
  let packSeconds = 0;
  for (const job of jobs) {
    if (job.kind === 'tiles') {
      bytes += tileBytesPerCell(job.layer, maxZoom);
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

/** What a job is called in progress and error messages: "Public land · 43.6°N 116.2°W". */
export function jobLabel(job: DownloadJob): string {
  return `${LAYER_LABELS[job.layer] ?? job.layer} · ${placeLabel(job)}`;
}
