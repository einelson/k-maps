import * as Location from 'expo-location';
import type { LocationTaskOptions } from 'expo-location';
import type { SQLiteDatabase } from 'expo-sqlite';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  clearRecording,
  getRecordingSession,
  loadRecordingFixes,
  startRecordingSession,
} from '../data/recordingRepo';
import { saveRecordedTrack, type RecordedTrack } from '../data/recordedTrack';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';
import { TRACK_TASK_NAME } from './trackConfig';

/**
 * Track recording that keeps going with the screen locked or the app closed (§7.5).
 *
 * It's a location task (src/features/trackTask.ts) run by an Android foreground service, which shows a
 * "recording" notification for as long as it's on — that notification is what lets Android keep the app's GPS
 * running in the background. Because the service is started while the app is on screen it only needs the
 * ordinary location permission, not "Allow all the time". Every fix is written to SQLite as it arrives, so
 * the recording survives the app being killed; this module then rebuilds it from there (`restoreRecording`)
 * and saves it from there (`finishTrackRecording`).
 */

const TASK_OPTIONS: LocationTaskOptions = {
  accuracy: Location.LocationAccuracy.BestForNavigation,
  timeInterval: 3000,
  distanceInterval: 5,
  showsBackgroundLocationIndicator: true,
  pausesUpdatesAutomatically: false,
  foregroundService: {
    notificationTitle: 'Recording a track',
    notificationBody: 'K-Maps is recording your route. Tap to open it.',
    notificationColor: '#2f6f4f',
  },
};

export type StartResult = { ok: true } | { ok: false; reason: string };

/**
 * Android 13+ hides the foreground-service notification unless it's allowed. Recording works either way, so
 * a "no" is fine — the notification just lives only in the notification drawer's "active apps" list.
 */
async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // Not being able to ask isn't a reason to refuse to record.
  }
}

async function stopUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TRACK_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(TRACK_TASK_NAME);
    }
  } catch (err) {
    console.warn('Could not stop track recording updates', err);
  }
}

let starting = false;

export async function startTrackRecording(db: SQLiteDatabase): Promise<StartResult> {
  // A second tap while the permission prompts are up must not start a second recording over the first.
  if (starting || useTrackRecordingStore.getState().recording) return { ok: true };
  starting = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { ok: false, reason: 'Location permission was not granted.' };
    }
    await requestNotificationPermission();

    const startedAt = Date.now();
    await startRecordingSession(db, startedAt);
    try {
      await Location.startLocationUpdatesAsync(TRACK_TASK_NAME, TASK_OPTIONS);
    } catch (err) {
      await clearRecording(db);
      return { ok: false, reason: err instanceof Error ? err.message : 'Location updates could not be started.' };
    }
    useTrackRecordingStore.getState().begin(startedAt);
    return { ok: true };
  } finally {
    starting = false;
  }
}

/** Pulls fixes the task stored since the last sync into the store; also retries updates that stopped. */
export async function syncRecording(db: SQLiteDatabase): Promise<void> {
  const store = useTrackRecordingStore.getState();
  if (!store.recording) return;
  const fixes = await loadRecordingFixes(db, store.lastFixId);
  if (fixes.length > 0) store.appendFixes(fixes);
  if (store.interrupted) await ensureUpdatesRunning();
}

/** True when updates are running (restarting them if needed); false, and `interrupted`, when they can't be. */
async function ensureUpdatesRunning(): Promise<boolean> {
  const store = useTrackRecordingStore.getState();
  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(TRACK_TASK_NAME))) {
      await Location.startLocationUpdatesAsync(TRACK_TASK_NAME, TASK_OPTIONS);
    }
    store.setInterrupted(false);
    return true;
  } catch {
    store.setInterrupted(true);
    return false;
  }
}

/**
 * Called when the app opens or returns to the front: picks up a recording that carried on (or was left)
 * while the app was closed. If the service was killed in the meantime — a phone's battery manager, a reboot —
 * it's started again so the recording continues; if it can't be, the store is flagged `interrupted` so the UI
 * can offer to save what there is.
 */
export async function restoreRecording(db: SQLiteDatabase): Promise<void> {
  const store = useTrackRecordingStore.getState();
  const session = await getRecordingSession(db);
  if (!session) {
    if (store.recording) store.reset();
    return;
  }

  if (store.recording && store.startedAt === session.startedAt) {
    await syncRecording(db);
    return;
  }
  store.hydrate(session.startedAt, await loadRecordingFixes(db));
  await ensureUpdatesRunning();
}

/**
 * Saves the recording as a track and ends it. Returns the new track's id, or null when there weren't enough
 * points to make a line (the recording is discarded). Nothing is deleted until the track is safely saved.
 */
export async function finishTrackRecording(db: SQLiteDatabase): Promise<number | null> {
  const session = await getRecordingSession(db);
  const fixes = session ? await loadRecordingFixes(db) : [];

  let featureId: number | null = null;
  if (session && fixes.length >= 2) {
    const track: RecordedTrack = {
      points: fixes.map((f) => [f.lon, f.lat]),
      samples: { times: fixes.map((f) => f.time), elevations: fixes.map((f) => f.altitude) },
      startedAt: session.startedAt,
    };
    featureId = await saveRecordedTrack(db, track, { clearRecording: true });
  } else {
    await clearRecording(db);
  }

  await stopUpdates();
  useTrackRecordingStore.getState().reset();
  return featureId;
}

/** Ends the recording and throws it away. The database is cleared first so the task stops itself if it races. */
export async function discardTrackRecording(db: SQLiteDatabase): Promise<void> {
  await clearRecording(db);
  await stopUpdates();
  useTrackRecordingStore.getState().reset();
}
