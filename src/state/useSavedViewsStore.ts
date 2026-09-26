import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { BaseMapMode } from '../map/usgsSources';
import type { PoiCategory } from '../map/poiSources';
import { kvStorage } from './kvStorage';
import { asRecord, mergeRecord, oneOf } from './persistHelpers';
import { restoreFilters, useFiltersStore } from './useFiltersStore';
import {
  BASE_MAP_MODES,
  DEFAULT_OVERLAY_OPACITY,
  DEFAULT_OVERLAY_VISIBILITY,
  useLayersStore,
  type OverlayLayerId,
} from './useLayersStore';
import { DEFAULT_POI_VISIBILITY, usePoiStore } from './usePoiStore';
import type { Filters } from './types';

/**
 * §5.3 "named saved views" — e.g. "Hunt: elk unit" = satellite + land +
 * orange pins only. A snapshot of every layer/filter store, not just
 * filters (useFiltersStore already has its own lighter-weight presets for
 * filter-only reuse).
 */
export interface ViewSnapshot {
  baseMap: BaseMapMode;
  overlayVisibility: Record<OverlayLayerId, boolean>;
  overlayOpacity: Record<OverlayLayerId, number>;
  poiVisibility: Record<PoiCategory, boolean>;
  filters: Filters;
}

export interface SavedView {
  id: string;
  name: string;
  snapshot: ViewSnapshot;
}

interface SavedViewsState {
  views: SavedView[];
  saveCurrentAsView: (name: string) => void;
  applyView: (id: string) => void;
  deleteView: (id: string) => void;
}

/** Keeps ids unique when two are saved in the same millisecond. */
let viewSeq = 0;

/**
 * Views as read back from storage. A view saved before a layer existed comes back with that layer at its
 * default rather than missing, so applying it never leaves a layer undefined.
 */
function restoreViews(saved: unknown): SavedView[] {
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((item): SavedView[] => {
    const view = asRecord(item);
    if (typeof view.id !== 'string' || typeof view.name !== 'string') return [];
    const snapshot = asRecord(view.snapshot);
    return [
      {
        id: view.id,
        name: view.name,
        snapshot: {
          baseMap: oneOf(snapshot.baseMap, BASE_MAP_MODES, 'topo'),
          overlayVisibility: mergeRecord(DEFAULT_OVERLAY_VISIBILITY, snapshot.overlayVisibility),
          overlayOpacity: mergeRecord(DEFAULT_OVERLAY_OPACITY, snapshot.overlayOpacity),
          poiVisibility: mergeRecord(DEFAULT_POI_VISIBILITY, snapshot.poiVisibility),
          filters: restoreFilters(snapshot.filters),
        },
      },
    ];
  });
}

/** Saved views are kept between launches, like the layers and filters they capture. */
export const useSavedViewsStore = create<SavedViewsState>()(
  persist(
    (set, get) => ({
      views: [],

      saveCurrentAsView: (name) => {
        const layers = useLayersStore.getState();
        const poi = usePoiStore.getState();
        const { filters } = useFiltersStore.getState();
        const snapshot: ViewSnapshot = {
          baseMap: layers.baseMap,
          overlayVisibility: layers.overlayVisibility,
          overlayOpacity: layers.overlayOpacity,
          poiVisibility: poi.visibility,
          filters,
        };
        set((s) => ({ views: [...s.views, { id: `${Date.now()}-${++viewSeq}`, name, snapshot }] }));
      },

      applyView: (id) => {
        const view = get().views.find((v) => v.id === id);
        if (!view) return;
        useLayersStore.setState({
          baseMap: view.snapshot.baseMap,
          overlayVisibility: view.snapshot.overlayVisibility,
          overlayOpacity: view.snapshot.overlayOpacity,
        });
        usePoiStore.setState({ visibility: view.snapshot.poiVisibility });
        useFiltersStore.setState({ filters: view.snapshot.filters });
      },

      deleteView: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
    }),
    {
      name: 'kmaps.savedViews',
      storage: createJSONStorage(() => kvStorage),
      partialize: (s) => ({ views: s.views }),
      merge: (persisted, current) => ({ ...current, views: restoreViews(asRecord(persisted).views) }),
    }
  )
);
