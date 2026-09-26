import { create } from 'zustand';
import type { Position } from 'geojson';

import type { StoredFix } from '../data/recordingRepo';
import { haversineM } from '../features/trackStats';
import type { TransportId } from '../features/transport';

/**
 * §7.5 GPS tracks. This is the on-screen mirror of the recording in SQLite (`recording_session` +
 * `recording_fixes`), which the background location task writes; see src/features/trackRecorder.ts. The store
 * is rebuilt from the database whenever the app opens or comes to the front, so it never has to be right
 * about anything that happened while the app was closed.
 */
interface TrackRecordingState {
  recording: boolean;
  startedAt: number | null;
  /** How the track is being travelled; sets how often the GPS is asked for a fix. Null if none was chosen. */
  transport: TransportId | null;
  /** These three line up index-for-index: fix i is `points[i]` at `times[i]` and `altitudes[i]`. */
  points: Position[];
  times: number[];
  altitudes: (number | null)[];
  /** Running length of the line so far, so the live readout doesn't re-measure it on every fix. */
  distanceM: number;
  /** Id of the newest fix mirrored here, so the next sync only has to load what came after it. */
  lastFixId: number;
  /** Location updates stopped (permission revoked, service killed) and couldn't be restarted. */
  interrupted: boolean;
  /** Updates had stopped (the system or the user closed the app) and were started again: the line jumps across a gap. */
  resumedAfterGap: boolean;
  begin: (startedAt: number, transport?: TransportId | null) => void;
  /** Replaces everything with the stored recording. */
  hydrate: (startedAt: number, fixes: StoredFix[], transport?: TransportId | null) => void;
  /** Adds fixes newer than what is already mirrored. */
  appendFixes: (fixes: StoredFix[]) => void;
  setInterrupted: (interrupted: boolean) => void;
  setResumedAfterGap: (resumedAfterGap: boolean) => void;
  reset: () => void;
}

const EMPTY = {
  recording: false,
  startedAt: null,
  transport: null as TransportId | null,
  points: [] as Position[],
  times: [] as number[],
  altitudes: [] as (number | null)[],
  distanceM: 0,
  lastFixId: 0,
  interrupted: false,
  resumedAfterGap: false,
};

/** Extends the mirrored arrays and running distance with `fixes`. */
function withFixes<S extends Pick<TrackRecordingState, 'points' | 'times' | 'altitudes' | 'distanceM' | 'lastFixId'>>(
  state: S,
  fixes: StoredFix[]
) {
  if (fixes.length === 0) return state;
  const points = [...state.points];
  const times = [...state.times];
  const altitudes = [...state.altitudes];
  let distanceM = state.distanceM;
  for (const fix of fixes) {
    const point: Position = [fix.lon, fix.lat];
    if (points.length > 0) distanceM += haversineM(points[points.length - 1], point);
    points.push(point);
    times.push(fix.time);
    altitudes.push(fix.altitude);
  }
  return { ...state, points, times, altitudes, distanceM, lastFixId: fixes[fixes.length - 1].id };
}

export const useTrackRecordingStore = create<TrackRecordingState>((set) => ({
  ...EMPTY,
  begin: (startedAt, transport = null) => set({ ...EMPTY, recording: true, startedAt, transport }),
  hydrate: (startedAt, fixes, transport = null) =>
    set((s) => ({
      ...withFixes({ ...s, ...EMPTY }, fixes),
      recording: true,
      startedAt,
      transport,
      interrupted: s.interrupted,
      resumedAfterGap: s.resumedAfterGap,
    })),
  // A sync that was already in flight when the recording ended must not repopulate the cleared store.
  appendFixes: (fixes) => set((s) => (s.recording ? withFixes(s, fixes.filter((f) => f.id > s.lastFixId)) : s)),
  setInterrupted: (interrupted) => set({ interrupted }),
  setResumedAfterGap: (resumedAfterGap) => set({ resumedAfterGap }),
  reset: () => set(EMPTY),
}));
