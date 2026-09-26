import type { SQLiteDatabase } from 'expo-sqlite';

import { BASE_MAP_TILE_URLS, USGS_ATTRIBUTION, USGS_MAX_NATIVE_ZOOM, type BaseMapMode } from '../map/usgsSources';
import type { RegionEntry } from '../packs/regionPacks';
import type { PackLayerId } from '../packs/types';
import { useDownloadRunStore } from '../state/useDownloadRunStore';
import { usePackStore } from '../state/usePackStore';
import { useRegionPackStore } from '../state/useRegionPackStore';
import type { Cell } from './blockSelect';
import { listCoverage } from './coverageRepo';
import { downloadCell } from './downloader';
import { jobLabel, planDownload } from './downloadPlan';
import { runDownload, type RunJob } from './downloadRunner';
import { downloadPackCell } from './packDownloader';
import { installRegionLayer } from './regionLayerInstaller';
import type { LayerId } from './types';

/** The one download in flight. Module state, not screen state: it keeps running when the screen closes. */
let controller: AbortController | null = null;

/** A tile download reports once per tile — thousands a minute — so progress reaches the screen at most this often. */
const PROGRESS_INTERVAL_MS = 250;

export const isDownloadRunning = () => controller !== null;

export interface StartDownloadOptions {
  appDb: SQLiteDatabase;
  cells: readonly Cell[];
  tileLayers: readonly LayerId[];
  packLayers: readonly PackLayerId[];
  maxZoom: number;
  /** Ready-made packs for the states picked whole; their overlay data is installed from the pack (see planDownload). */
  regions?: readonly RegionEntry[];
}

/**
 * Downloads the chosen layers for the chosen areas, skipping what is already on the device (the plan is made
 * from the coverage table as it is now, not as the screen last saw it). Progress goes to
 * `useDownloadRunStore`. Resolves when it has finished or been cancelled; ignored if one is already running.
 */
export async function startDownload({
  appDb,
  cells,
  tileLayers,
  packLayers,
  maxZoom,
  regions,
}: StartDownloadOptions): Promise<void> {
  if (controller) return;
  const run = useDownloadRunStore.getState();
  const own = new AbortController();
  controller = own;
  try {
    const coverage = await listCoverage(appDb);
    const { jobs, skipped } = planDownload({ cells, tileLayers, packLayers, maxZoom, coverage, regions });
    run.begin(jobs.length, skipped);

    const runJob: RunJob = async (job, signal, onProgress) => {
      if (job.kind === 'region') {
        await installRegionLayer({ appDb, region: job.region, packs: job.packs, signal, onProgress });
        useRegionPackStore.getState().markInstalled(job.region.id, job.layer, job.packs.version);
        usePackStore.getState().bump(); // the map picks the new areas up straight away
      } else if (job.kind === 'tiles') {
        await downloadCell({
          appDb,
          layer: job.layer,
          cx: job.cx,
          cy: job.cy,
          maxZoom: Math.min(maxZoom, USGS_MAX_NATIVE_ZOOM),
          tileUrlTemplate: BASE_MAP_TILE_URLS[job.layer as BaseMapMode],
          attribution: USGS_ATTRIBUTION,
          signal,
          onProgress: (done, total) => onProgress(total === 0 ? 1 : done / total),
        });
      } else {
        await downloadPackCell({
          appDb,
          layer: job.layer as PackLayerId,
          cx: job.cx,
          cy: job.cy,
          signal,
          onProgress,
        });
        usePackStore.getState().bump(); // the map picks the new area up straight away
      }
    };

    let lastProgressAt = 0;
    const result = await runDownload(
      jobs,
      runJob,
      {
        onJobStart: (job) => run.start(jobLabel(job)),
        onJobProgress: (_job, fraction) => {
          const now = Date.now();
          if (fraction < 1 && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
          lastProgressAt = now;
          run.progress(fraction);
        },
        onJobDone: (job, failure) => run.jobDone(failure ? { label: jobLabel(job), message: failure.message } : null),
      },
      own.signal
    );
    run.finish(result.cancelled);
  } catch (err) {
    // Reading the coverage table failed; nothing was started.
    run.begin(0, 0);
    run.jobDone({ label: 'Download', message: err instanceof Error ? err.message : String(err) });
    run.finish(false);
  } finally {
    controller = null;
    usePackStore.getState().bump();
  }
}

/** Stops the running download after the file in progress; finished areas stay on the device. */
export function cancelDownload(): void {
  controller?.abort();
}
