import { create } from 'zustand';

/**
 * Bumped whenever downloaded overlay data (land/MVUM/POI/OSM cell packs)
 * changes on disk, so every mounted map re-reads the coverage table and adds
 * or drops the matching sources.
 */
interface PackState {
  version: number;
  bump: () => void;
}

export const usePackStore = create<PackState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
