/**
 * "Load overlay data as you pan": while you're online and looking at the map, fetch the vector packs
 * (public land, MVUM, USFS trails) for the z10 cells in view that aren't on the device yet, so the land
 * layer isn't limited to the bundled starter region. The same per-cell fetch the Downloads screen runs,
 * just triggered by the camera — results are cached, so anywhere you've looked works offline later.
 *
 * Pure planning + queue logic (no React, no native modules) so it is unit-testable; the hook that
 * wires it to the map lives in src/map/useAutoPackLoader.ts.
 */

import type { Bounds, PackLayerId } from '../packs/types';
import { cellsInBounds, lonLatToCell } from './cells';

/** Below this the view spans dozens of cells; wait until the user zooms in on something. */
export const AUTO_LOAD_MIN_ZOOM = 10;
/** A tall portrait view at z10 covers ~8 cells; this leaves headroom without a runaway queue. */
export const AUTO_LOAD_MAX_CELLS = 12;
/** A failed cell isn't retried automatically for this long. */
export const AUTO_LOAD_RETRY_MS = 5 * 60 * 1000;
/** After this many failures in a row the loader assumes there is no connection and pauses. */
export const AUTO_LOAD_MAX_CONSECUTIVE_FAILURES = 2;
export const AUTO_LOAD_PAUSE_MS = 2 * 60 * 1000;

/** Cheapest / most useful first, so the land layer fills in before the heavier ones. */
const LAYER_ORDER: readonly PackLayerId[] = ['land', 'mvum', 'trails'];

export interface AutoLoadTarget {
  layer: PackLayerId;
  cx: number;
  cy: number;
}

export interface PlanInput {
  /** `[west, south, east, north]` of the visible map. */
  bounds: Bounds;
  center: [number, number];
  zoom: number;
  /** Layers whose overlay is switched on. Anything not in `LAYER_ORDER` is ignored (OSM/POI are too slow to auto-fetch). */
  layers: readonly PackLayerId[];
  /** True when the device already has this cell's data (downloaded, or bundled with the app). */
  isCovered: (layer: PackLayerId, cx: number, cy: number) => boolean;
}

const cellKey = (t: AutoLoadTarget) => `${t.layer}:${t.cx}:${t.cy}`;

/** What to fetch for the current view, nearest cells to the center first. Empty when zoomed too far out. */
export function planAutoLoad(input: PlanInput): AutoLoadTarget[] {
  const { bounds, center, zoom, layers, isCovered } = input;
  if (zoom < AUTO_LOAD_MIN_ZOOM) return [];
  const wanted = LAYER_ORDER.filter((layer) => layers.includes(layer));
  if (wanted.length === 0) return [];

  // Squared distance in cell units is enough to rank cells; the grid is near-square at any one latitude.
  const [centerLon, centerLat] = center;
  const centerCell = lonLatToCell(centerLon, centerLat);
  const cells = cellsInBounds(bounds)
    .map((c) => ({ ...c, d: (c.cx - centerCell.cx) ** 2 + (c.cy - centerCell.cy) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, AUTO_LOAD_MAX_CELLS);

  const targets: AutoLoadTarget[] = [];
  for (const { cx, cy } of cells) {
    for (const layer of wanted) {
      if (!isCovered(layer, cx, cy)) targets.push({ layer, cx, cy });
    }
  }
  return targets;
}

export interface AutoLoadState {
  /** Targets waiting behind the active one. */
  pending: number;
  active: AutoLoadTarget | null;
  /** True while the loader is backing off after repeated failures (probably offline). */
  paused: boolean;
}

export interface AutoLoaderDeps {
  /** Fetches and stores one cell. Rejects on failure; must settle quietly when `signal` aborts. */
  download: (target: AutoLoadTarget, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  onChange?: (state: AutoLoadState) => void;
}

/**
 * Serial queue: one cell at a time (the public services are shared — same courtesy as §4.4), the newest
 * plan replaces whatever was still waiting, and repeated failures pause it instead of hammering.
 */
export class AutoLoader {
  private queue: AutoLoadTarget[] = [];
  private active: AutoLoadTarget | null = null;
  private running = false;
  private stopped = false;
  private controller: AbortController | null = null;
  private failedAt = new Map<string, number>();
  private consecutiveFailures = 0;
  private pausedUntil = 0;
  private readonly now: () => number;

  constructor(private readonly deps: AutoLoaderDeps) {
    this.now = deps.now ?? Date.now;
  }

  get state(): AutoLoadState {
    return { pending: this.queue.length, active: this.active, paused: this.now() < this.pausedUntil };
  }

  /** Replaces the waiting queue with `targets` (minus cells that failed recently or are being fetched now). */
  update(targets: AutoLoadTarget[]): void {
    if (this.stopped) return;
    const now = this.now();
    if (now < this.pausedUntil) {
      this.queue = [];
      this.emit();
      return;
    }
    const activeKey = this.active ? cellKey(this.active) : null;
    this.queue = targets.filter((t) => {
      const key = cellKey(t);
      if (key === activeKey) return false;
      const failed = this.failedAt.get(key);
      return failed === undefined || now - failed >= AUTO_LOAD_RETRY_MS;
    });
    this.emit();
    void this.run();
  }

  /** Aborts the fetch in flight and drops the queue for good. */
  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.controller?.abort();
    this.emit();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped) {
        const target = this.queue.shift();
        if (!target) break;
        this.active = target;
        this.controller = new AbortController();
        this.emit();
        try {
          await this.deps.download(target, this.controller.signal);
          this.failedAt.delete(cellKey(target));
          this.consecutiveFailures = 0;
        } catch {
          if (this.stopped) break;
          this.failedAt.set(cellKey(target), this.now());
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= AUTO_LOAD_MAX_CONSECUTIVE_FAILURES) {
            this.pausedUntil = this.now() + AUTO_LOAD_PAUSE_MS;
            this.consecutiveFailures = 0;
            this.queue = [];
          }
        } finally {
          this.active = null;
          this.controller = null;
        }
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private emit(): void {
    this.deps.onChange?.(this.state);
  }
}
