import { create } from 'zustand';

import type { AutoLoadState } from '../downloads/autoLoad';

/** What the map's auto-loader (src/map/useAutoPackLoader.ts) is doing right now — drives the small "loading" pill. */
export const useAutoLoadStore = create<AutoLoadState>(() => ({
  pending: 0,
  active: null,
  paused: false,
}));
