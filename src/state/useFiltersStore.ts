import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { FeatureType } from '../data/types';
import { kvStorage } from './kvStorage';
import { asRecord, oneOf } from './persistHelpers';
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

const FEATURE_TYPES: readonly FeatureType[] = ['point', 'line', 'polygon'];

/** A saved list, or null ("no restriction") when it isn't a list of the expected kind. */
function listOf<T>(saved: unknown, keep: (item: unknown) => item is T): T[] | null {
  return Array.isArray(saved) && saved.every(keep) ? saved : null;
}

const isId = (item: unknown): item is number => typeof item === 'number' && Number.isInteger(item);
const isString = (item: unknown): item is string => typeof item === 'string';
const isFeatureType = (item: unknown): item is FeatureType => FEATURE_TYPES.includes(item as FeatureType);

/** Filters as read back from storage: anything unusable becomes "no restriction" rather than hiding the map. */
export function restoreFilters(saved: unknown): Filters {
  const s = asRecord(saved);
  return {
    folderIds: listOf(s.folderIds, isId),
    types: listOf(s.types, isFeatureType),
    colors: listOf(s.colors, isString),
    tagIds: listOf(s.tagIds, isId),
    tagMode: oneOf(s.tagMode, ['any', 'all'], EMPTY_FILTERS.tagMode),
  };
}

function restorePresets(saved: unknown): SavedFilterPreset[] {
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((item): SavedFilterPreset[] => {
    const p = asRecord(item);
    return typeof p.id === 'string' && typeof p.name === 'string'
      ? [{ id: p.id, name: p.name, filters: restoreFilters(p.filters) }]
      : [];
  });
}

/**
 * The filters you had on the map, and your saved filter presets, are still there the next time you open the app.
 * The Items list's search text (`Filters.text`) is not saved: it isn't a map filter, and a forgotten search would
 * greet you with a list that looks empty.
 */
export const useFiltersStore = create<FiltersState>()(
  persist(
    (set, get) => ({
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
    }),
    {
      name: 'kmaps.filters',
      storage: createJSONStorage(() => kvStorage),
      partialize: (s) => ({ filters: { ...s.filters, text: undefined }, presets: s.presets }),
      merge: (persisted, current) => {
        const saved = asRecord(persisted);
        return { ...current, filters: restoreFilters(saved.filters), presets: restorePresets(saved.presets) };
      },
    }
  )
);
