import { create } from 'zustand';

import { isAbortError } from '../packs/http';
import type { PackFeatureCollection } from '../packs/types';
import { fetchWildfirePerimeters, WILDFIRE_REFRESH_MS } from '../packs/wildfire';
import { readWildfireSnapshot, writeWildfireSnapshot } from '../packs/wildfireCache';

/** A tick this close to the refresh interval counts as due (timers drift a little). */
const REFRESH_SLACK_MS = 10_000;

export type WildfireStatus = 'idle' | 'loading' | 'error';

interface WildfireState {
  /** The perimeters on screen: the last successful fetch, or the on-device copy of it. Null until either exists. */
  collection: PackFeatureCollection | null;
  /** When `collection` was fetched from NIFC (epoch ms). */
  fetchedAt: number | null;
  status: WildfireStatus;
  /** Why the last refresh failed; the old `collection` stays on screen. */
  error: string | null;

  /** Loads the saved copy (once) so there is something to show before — or without — a network. */
  loadCached: () => Promise<void>;
  /** Fetches fresh perimeters unless the data is still current (or `force`). Failures keep the old data. */
  refresh: (options?: { force?: boolean; signal?: AbortSignal }) => Promise<void>;
}

let cacheLoaded = false;

export const useWildfireStore = create<WildfireState>((set, get) => ({
  collection: null,
  fetchedAt: null,
  status: 'idle',
  error: null,

  loadCached: async () => {
    if (cacheLoaded) return;
    cacheLoaded = true;
    const snapshot = await readWildfireSnapshot();
    // A fetch that finished while the file was being read is newer than the file.
    if (snapshot && get().collection === null) {
      set({ collection: snapshot.collection, fetchedAt: snapshot.fetchedAt });
    }
  },

  refresh: async ({ force = false, signal } = {}) => {
    const { status, fetchedAt } = get();
    if (status === 'loading') return;
    if (!force && fetchedAt !== null && Date.now() - fetchedAt < WILDFIRE_REFRESH_MS - REFRESH_SLACK_MS) return;

    set({ status: 'loading', error: null });
    try {
      const collection = await fetchWildfirePerimeters({ signal });
      const now = Date.now();
      set({ collection, fetchedAt: now, status: 'idle', error: null });
      try {
        writeWildfireSnapshot({ fetchedAt: now, collection });
      } catch (err) {
        console.warn('Could not cache wildfire perimeters', err);
      }
    } catch (err) {
      if (isAbortError(err)) {
        set({ status: 'idle' });
        return;
      }
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
}));

/** Test hook: forget that the on-device copy was loaded. */
export function resetWildfireCacheFlag(): void {
  cacheLoaded = false;
}
