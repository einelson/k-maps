import { create } from 'zustand';

import type { PoiCategory } from '../map/poiSources';

interface PoiState {
  visibility: Record<PoiCategory, boolean>;
  setVisible: (category: PoiCategory, visible: boolean) => void;
}

export const usePoiStore = create<PoiState>((set) => ({
  visibility: { boatLaunches: true, campsitesTrails: true },
  setVisible: (category, visible) =>
    set((s) => ({ visibility: { ...s.visibility, [category]: visible } })),
}));
