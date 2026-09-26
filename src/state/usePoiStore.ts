import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { PoiCategory } from '../map/poiSources';
import { kvStorage } from './kvStorage';
import { asRecord, mergeRecord } from './persistHelpers';

interface PoiState {
  visibility: Record<PoiCategory, boolean>;
  setVisible: (category: PoiCategory, visible: boolean) => void;
}

export const DEFAULT_POI_VISIBILITY: Record<PoiCategory, boolean> = { boatLaunches: true, campsitesTrails: true };

/** Which POI pins are switched on is remembered between launches. */
export const usePoiStore = create<PoiState>()(
  persist(
    (set) => ({
      visibility: DEFAULT_POI_VISIBILITY,
      setVisible: (category, visible) => set((s) => ({ visibility: { ...s.visibility, [category]: visible } })),
    }),
    {
      name: 'kmaps.poi',
      storage: createJSONStorage(() => kvStorage),
      partialize: (s) => ({ visibility: s.visibility }),
      merge: (persisted, current) => ({
        ...current,
        visibility: mergeRecord(DEFAULT_POI_VISIBILITY, asRecord(persisted).visibility),
      }),
    }
  )
);
