import { create } from 'zustand';

import type { BaseMapMode } from '../map/usgsSources';
import type { PoiCategory } from '../map/poiSources';
import { useFiltersStore } from './useFiltersStore';
import { useLayersStore, type OverlayLayerId } from './useLayersStore';
import { usePoiStore } from './usePoiStore';
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

export const useSavedViewsStore = create<SavedViewsState>((set, get) => ({
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
}));
