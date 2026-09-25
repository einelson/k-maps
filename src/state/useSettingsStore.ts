import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { AppearancePreference } from '../theme/colors';
import { kvStorage } from './kvStorage';

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
