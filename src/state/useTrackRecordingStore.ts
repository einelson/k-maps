import { create } from 'zustand';
import type { Position } from 'geojson';

/** §7.5 GPS tracks — foreground recording only; see src/features/trackRecorder.ts for why. */
interface TrackRecordingState {
  recording: boolean;
  points: Position[];
  startedAt: number | null;
  begin: () => void;
  addPoint: (point: Position) => void;
  reset: () => void;
}

export const useTrackRecordingStore = create<TrackRecordingState>((set) => ({
  recording: false,
  points: [],
  startedAt: null,
  begin: () => set({ recording: true, points: [], startedAt: Date.now() }),
  addPoint: (point) => set((s) => ({ points: [...s.points, point] })),
  reset: () => set({ recording: false, points: [], startedAt: null }),
}));
