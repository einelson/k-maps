import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_FIX_SPACING_M, clampSpacing, type FixSpacing, type TransportId } from '../features/transport';
import type { AppearancePreference } from '../theme/colors';
import { kvStorage } from './kvStorage';
import { asRecord, mergeRecord } from './persistHelpers';

export type UnitSystem = 'imperial' | 'metric';
export type CoordinateFormat = 'decimal' | 'dms' | 'utm';

interface SettingsState {
  units: UnitSystem;
  setUnits: (units: UnitSystem) => void;

  coordinateFormat: CoordinateFormat;
  setCoordinateFormat: (format: CoordinateFormat) => void;

  appearance: AppearancePreference;
  setAppearance: (appearance: AppearancePreference) => void;

  /**
   * Metres between GPS fixes while recording, per way of getting around. Smaller follows the ground more
   * closely; larger makes a smaller track and uses less battery. Read when a recording starts.
   */
  trackSpacingM: FixSpacing;
  setTrackSpacing: (id: TransportId, metres: number) => void;
  resetTrackSpacing: () => void;
}

/** What was saved, laid over the defaults: a mode added later gets its default, and a corrupt value is dropped or clamped. */
export function sanitizeSpacing(saved: unknown): FixSpacing {
  const spacing = mergeRecord(DEFAULT_FIX_SPACING_M, saved);
  for (const id of Object.keys(spacing) as TransportId[]) spacing[id] = clampSpacing(spacing[id]);
  return spacing;
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

      trackSpacingM: DEFAULT_FIX_SPACING_M,
      setTrackSpacing: (id, metres) =>
        set((s) => ({ trackSpacingM: { ...s.trackSpacingM, [id]: clampSpacing(metres) } })),
      resetTrackSpacing: () => set({ trackSpacingM: DEFAULT_FIX_SPACING_M }),
    }),
    {
      name: 'kmaps.settings',
      storage: createJSONStorage(() => kvStorage),
      merge: (persisted, current) => {
        const saved = asRecord(persisted);
        return { ...current, ...saved, trackSpacingM: sanitizeSpacing(saved.trackSpacingM) };
      },
    }
  )
);
