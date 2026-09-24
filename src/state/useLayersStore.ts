import { create } from 'zustand';

import type { BaseMapMode } from '../map/usgsSources';

export type OverlayLayerId =
  // Land & access
  | 'land'
  | 'likelyPrivate'
  | 'landManager'
  | 'blmSma'
  | 'huntUnits'
  // Roads & trails
  | 'osm'
  | 'mvum'
  | 'usfsTrails'
  // Water & terrain
  | 'shadedRelief'
  | 'slopeAngle'
  | 'nhd'
  | 'wetlands'
  // Hazards & conditions
  | 'wildfire'
  | 'radar';

interface LayersState {
  baseMap: BaseMapMode;
  setBaseMap: (mode: BaseMapMode) => void;

  overlayVisibility: Record<OverlayLayerId, boolean>;
  overlayOpacity: Record<OverlayLayerId, number>;
  setOverlayVisible: (id: OverlayLayerId, visible: boolean) => void;
  setOverlayOpacity: (id: OverlayLayerId, opacity: number) => void;

  showUserLocation: boolean;
  setShowUserLocation: (show: boolean) => void;

  /** Name labels on your saved pins, lines and areas (and on roads/trails/POIs where the data has names). */
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;

  /** Renders the base map from a downloaded MBTiles file instead of live USGS tiles (§4.6). */
  useOfflineMaps: boolean;
  setUseOfflineMaps: (use: boolean) => void;

  /**
   * While online, fetch public land / MVUM / USFS trails for the cells you're looking at (and keep
   * them for offline) so coverage isn't limited to the bundled starter region.
   */
  autoLoadOverlays: boolean;
  setAutoLoadOverlays: (auto: boolean) => void;
}

export const useLayersStore = create<LayersState>((set) => ({
  baseMap: 'topo',
  setBaseMap: (mode) => set({ baseMap: mode }),

  overlayVisibility: {
    land: true,
    likelyPrivate: true,
    landManager: false,
    blmSma: false,
    huntUnits: false,
    osm: false,
    mvum: false,
    usfsTrails: false,
    shadedRelief: false,
    slopeAngle: false,
    nhd: false,
    wetlands: false,
    wildfire: false,
    radar: false,
  },
  overlayOpacity: {
    land: 0.5,
    likelyPrivate: 0.5,
    landManager: 0.6,
    blmSma: 1,
    huntUnits: 1,
    osm: 1,
    mvum: 1,
    usfsTrails: 1,
    shadedRelief: 0.5,
    slopeAngle: 0.6,
    nhd: 1,
    wetlands: 0.7,
    wildfire: 1,
    radar: 0.7,
  },
  setOverlayVisible: (id, visible) =>
    set((s) => ({ overlayVisibility: { ...s.overlayVisibility, [id]: visible } })),
  setOverlayOpacity: (id, opacity) =>
    set((s) => ({ overlayOpacity: { ...s.overlayOpacity, [id]: opacity } })),

  showUserLocation: false,
  setShowUserLocation: (show) => set({ showUserLocation: show }),

  showLabels: true,
  setShowLabels: (show) => set({ showLabels: show }),

  useOfflineMaps: false,
  setUseOfflineMaps: (use) => set({ useOfflineMaps: use }),

  autoLoadOverlays: true,
  setAutoLoadOverlays: (auto) => set({ autoLoadOverlays: auto }),
}));
