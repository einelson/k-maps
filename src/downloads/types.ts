import type { CoverageStatus } from '../data/types';

/** Matches BaseMapMode ('topo'|'satellite'|'hybrid') plus the vector overlay packs (src/packs/types.ts PackLayerId). */
export type LayerId = 'topo' | 'satellite' | 'hybrid' | 'land' | 'osm' | 'mvum' | 'trails' | 'poi';

export interface CellSelection {
  cx: number;
  cy: number;
}

export interface DownloadJob {
  layer: LayerId;
  cx: number;
  cy: number;
  maxZoom: number;
  status: CoverageStatus;
  bytesDownloaded: number;
  bytesTotal: number | null;
}

/** §4.4: be gentle with shared public tile servers. */
export const DOWNLOAD_CONCURRENCY = 4;
export const TILE_INSERT_BATCH_SIZE = 200;
export const USER_AGENT = 'K-Maps/1.0 (offline outdoor maps; contact via GitHub repo)';
