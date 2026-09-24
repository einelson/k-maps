import { create } from 'zustand';

import type { BaseMapMode } from '../map/usgsSources';

export type OverlayLayerId = 'shadedRelief' | 'land' | 'mvum' | 'blmSma' | 'osm';

interface LayersState {
  baseMap: BaseMapMode;
  setBaseMap: (mode: BaseMapMode) => void;

  overlayVisibility: Record<OverlayLayerId, boolean>;
  overlayOpacity: Record<OverlayLayerId, number>;
  setOverlayVisible: (id: OverlayLayerId, visible: boolean) => void;
  setOverlayOpacity: (id: OverlayLayerId, opacity: number) => void;

  showUserLocation: boolean;
  setShowUserLocation: (show: boolean) => void;

  /** Renders the base map from a downloaded MBTiles file instead of live USGS tiles (§4.6). */
  useOfflineMaps: boolean;
  setUseOfflineMaps: (use: boolean) => void;
}

export const useLayersStore = create<LayersState>((set) => ({
  baseMap: 'topo',
  setBaseMap: (mode) => set({ baseMap: mode }),

  overlayVisibility: {
    shadedRelief: false,
    land: true,
    mvum: false,
    blmSma: false,
    osm: false,
  },
  overlayOpacity: {
    shadedRelief: 0.5,
    land: 0.5,
    mvum: 1,
    blmSma: 1,
    osm: 1,
  },
  setOverlayVisible: (id, visible) =>
    set((s) => ({ overlayVisibility: { ...s.overlayVisibility, [id]: visible } })),
  setOverlayOpacity: (id, opacity) =>
    set((s) => ({ overlayOpacity: { ...s.overlayOpacity, [id]: opacity } })),

  showUserLocation: false,
  setShowUserLocation: (show) => set({ showUserLocation: show }),

  useOfflineMaps: false,
  setUseOfflineMaps: (use) => set({ useOfflineMaps: use }),
}));
