import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './kvStorage';
import { asRecord } from './persistHelpers';

/** Southwest Idaho — the spec's suggested first region (§10) and where a fresh install opens. */
export const DEFAULT_CENTER: [number, number] = [-116.2, 43.6];
export const DEFAULT_ZOOM = 10;

interface CameraState {
  /** `[lon, lat]` the main map was last looking at. */
  center: [number, number];
  zoom: number;
  setView: (center: [number, number], zoom: number) => void;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Where the main map was looking when it last settled, so the app reopens there rather than always on Boise —
 * and the Downloads map opens where you were, not a state away from what you meant to download.
 */
export const useCameraStore = create<CameraState>()(
  persist(
    (set) => ({
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      setView: (center, zoom) => set({ center, zoom }),
    }),
    {
      name: 'kmaps.camera',
      storage: createJSONStorage(() => kvStorage),
      partialize: (s) => ({ center: s.center, zoom: s.zoom }),
      merge: (persisted, current) => {
        const saved = asRecord(persisted);
        const center = Array.isArray(saved.center) ? saved.center : [];
        const [lon, lat] = center;
        const valid =
          isNumber(lon) && isNumber(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 85 && isNumber(saved.zoom);
        return valid
          ? { ...current, center: [lon, lat], zoom: Math.min(22, Math.max(0, saved.zoom as number)) }
          : current;
      },
    }
  )
);
