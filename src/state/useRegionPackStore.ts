import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { PackLayerId } from '../packs/types';
import { kvStorage } from './kvStorage';

interface RegionPackState {
  /** Version (build timestamp) of each region pack installed on this device, keyed `<regionId>:<layer>`. */
  installed: Record<string, string>;
  markInstalled: (regionId: string, layer: PackLayerId, version: string) => void;
  /** Forget every region's install of a layer — its data was deleted from Downloads. */
  forgetLayer: (layer: PackLayerId) => void;
}

export const regionPackKey = (regionId: string, layer: PackLayerId) => `${regionId}:${layer}`;

export const useRegionPackStore = create<RegionPackState>()(
  persist(
    (set) => ({
      installed: {},
      markInstalled: (regionId, layer, version) =>
        set((s) => ({ installed: { ...s.installed, [regionPackKey(regionId, layer)]: version } })),
      forgetLayer: (layer) =>
        set((s) => ({
          installed: Object.fromEntries(Object.entries(s.installed).filter(([key]) => !key.endsWith(`:${layer}`))),
        })),
    }),
    { name: 'kmaps.regionPacks', storage: createJSONStorage(() => kvStorage) }
  )
);
