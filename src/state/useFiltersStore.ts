import { create } from 'zustand';

import { EMPTY_FILTERS, type Filters } from './types';

export interface SavedFilterPreset {
  id: string;
  name: string;
  filters: Filters;
}

interface FiltersState {
  filters: Filters;
  setFilters: (filters: Filters) => void;
  resetFilters: () => void;

  presets: SavedFilterPreset[];
  savePreset: (name: string) => void;
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
}

/** Keeps ids unique when two are saved in the same millisecond. */
let presetSeq = 0;

export const useFiltersStore = create<FiltersState>((set, get) => ({
  filters: EMPTY_FILTERS,
  setFilters: (filters) => set({ filters }),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),

  presets: [],
  savePreset: (name) =>
    set((s) => ({
      presets: [...s.presets, { id: `${Date.now()}-${++presetSeq}`, name, filters: get().filters }],
    })),
  applyPreset: (id) => {
    const preset = get().presets.find((p) => p.id === id);
    if (preset) set({ filters: preset.filters });
  },
  deletePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
}));
