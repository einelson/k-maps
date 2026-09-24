import { create } from 'zustand';

export type UnitSystem = 'imperial' | 'metric';
export type CoordinateFormat = 'decimal' | 'dms' | 'utm';

interface SettingsState {
  units: UnitSystem;
  setUnits: (units: UnitSystem) => void;

  coordinateFormat: CoordinateFormat;
  setCoordinateFormat: (format: CoordinateFormat) => void;
}

// TODO: persist to disk (e.g. zustand `persist` + AsyncStorage) once settings
// need to survive an app restart — in-memory only for now.
export const useSettingsStore = create<SettingsState>((set) => ({
  units: 'imperial',
  setUnits: (units) => set({ units }),

  coordinateFormat: 'decimal',
  setCoordinateFormat: (coordinateFormat) => set({ coordinateFormat }),
}));
