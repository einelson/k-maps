import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { BASE_MAP_TILE_URLS, type BaseMapMode } from '../map/usgsSources';
import { kvStorage } from './kvStorage';
import { boolOr, asRecord, mergeRecord, oneOf } from './persistHelpers';

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

export const BASE_MAP_MODES = Object.keys(BASE_MAP_TILE_URLS) as BaseMapMode[];

export const DEFAULT_OVERLAY_VISIBILITY: Record<OverlayLayerId, boolean> = {
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
};

export const DEFAULT_OVERLAY_OPACITY: Record<OverlayLayerId, number> = {
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
};

/** The parts of the store that are saved between launches (not the setters, and not `showUserLocation`, see below). */
type SavedLayers = Pick<
  LayersState,
  'baseMap' | 'overlayVisibility' | 'overlayOpacity' | 'showLabels' | 'useOfflineMaps' | 'autoLoadOverlays'
>;

/**
 * The layers and toggles you had on are still on the next time you open the app. `showUserLocation` isn't
 * saved: the location dot needs the permission granted this session, so it starts off and the locate button
 * turns it on.
 */
export const useLayersStore = create<LayersState>()(
  persist(
    (set) => ({
      baseMap: 'topo',
      setBaseMap: (mode) => set({ baseMap: mode }),

      overlayVisibility: DEFAULT_OVERLAY_VISIBILITY,
      overlayOpacity: DEFAULT_OVERLAY_OPACITY,
      setOverlayVisible: (id, visible) =>
        set((s) => ({ overlayVisibility: { ...s.overlayVisibility, [id]: visible } })),
      setOverlayOpacity: (id, opacity) => set((s) => ({ overlayOpacity: { ...s.overlayOpacity, [id]: opacity } })),

      showUserLocation: false,
      setShowUserLocation: (show) => set({ showUserLocation: show }),

      showLabels: true,
      setShowLabels: (show) => set({ showLabels: show }),

      useOfflineMaps: false,
      setUseOfflineMaps: (use) => set({ useOfflineMaps: use }),

      autoLoadOverlays: true,
      setAutoLoadOverlays: (auto) => set({ autoLoadOverlays: auto }),
    }),
    {
      name: 'kmaps.layers',
      storage: createJSONStorage(() => kvStorage),
      partialize: (s): SavedLayers => ({
        baseMap: s.baseMap,
        overlayVisibility: s.overlayVisibility,
        overlayOpacity: s.overlayOpacity,
        showLabels: s.showLabels,
        useOfflineMaps: s.useOfflineMaps,
        autoLoadOverlays: s.autoLoadOverlays,
      }),
      merge: (persisted, current) => {
        const saved = asRecord(persisted);
        const opacity = mergeRecord(DEFAULT_OVERLAY_OPACITY, saved.overlayOpacity);
        for (const id of Object.keys(opacity) as OverlayLayerId[]) opacity[id] = Math.min(1, Math.max(0, opacity[id]));
        return {
          ...current,
          baseMap: oneOf(saved.baseMap, BASE_MAP_MODES, current.baseMap),
          overlayVisibility: mergeRecord(DEFAULT_OVERLAY_VISIBILITY, saved.overlayVisibility),
          overlayOpacity: opacity,
          showLabels: boolOr(saved.showLabels, current.showLabels),
          useOfflineMaps: boolOr(saved.useOfflineMaps, current.useOfflineMaps),
          autoLoadOverlays: boolOr(saved.autoLoadOverlays, current.autoLoadOverlays),
        };
      },
    }
  )
);
