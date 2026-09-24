import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { AppearancePreference } from '../theme/colors';

export type UnitSystem = 'imperial' | 'metric';
export type CoordinateFormat = 'decimal' | 'dms' | 'utm';

interface SettingsState {
  units: UnitSystem;
  setUnits: (units: UnitSystem) => void;

  coordinateFormat: CoordinateFormat;
  setCoordinateFormat: (format: CoordinateFormat) => void;

  appearance: AppearancePreference;
  setAppearance: (appearance: AppearancePreference) => void;
}

// expo-sqlite's key-value store is synchronous, so the saved settings are in place before the
// first render — no flash of the wrong theme on launch.
const kvStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => Storage.setItemSync(name, value),
  removeItem: (name) => {
    Storage.removeItemSync(name);
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      units: 'imperial',
      setUnits: (units) => set({ units }),

      coordinateFormat: 'decimal',
      setCoordinateFormat: (coordinateFormat) => set({ coordinateFormat }),

      appearance: 'system',
      setAppearance: (appearance) => set({ appearance }),
    }),
    {
      name: 'kmaps.settings',
      storage: createJSONStorage(() => kvStorage),
    }
  )
);
