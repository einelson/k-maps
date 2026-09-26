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
import { useSettingsStore } from '../state/useSettingsStore';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';
import { TRACK_TASK_NAME } from './trackConfig';
import { fixEveryM, type TransportId } from './transport';

/**
 * Track recording that keeps going with the screen locked or the app closed (§7.5).
 *
 * It's a location task (src/features/trackTask.ts). On Android it runs under a foreground service, whose
 * "recording" notification is what lets the system keep the app's GPS going in the background; because the
 * service is started while the app is on screen it needs only the ordinary location permission, not "Allow
 * all the time". On iOS the `location` background mode keeps a backgrounded app receiving updates (with the
 * blue status-bar pill), and "Always" permission, offered once recording has started, additionally lets the
 * system relaunch the app after terminating it. iOS never relaunches an app the user force-quit, so there a
 * swipe-away ends the recording (see README). Every fix is written to SQLite as it arrives, so the recording
 * survives the app being killed either way; this module then rebuilds it from there (`restoreRecording`) and
 * saves it from there (`finishTrackRecording`).
 */

const TASK_OPTIONS: LocationTaskOptions = {
  accuracy: Location.LocationAccuracy.BestForNavigation,
  timeInterval: 3000, // Android only
  // iOS only: the blue "using your location" pill while backgrounded, no automatic pausing when the phone
  // thinks you've stopped (which would leave gaps at every rest), and a hint that this is a walk or hike.
  showsBackgroundLocationIndicator: true,
  pausesUpdatesAutomatically: false,
  activityType: Location.LocationActivityType.Fitness,
  foregroundService: {
    notificationTitle: 'Recording a track',
    notificationBody: 'K-Maps is recording your route. Tap to open it.',
    notificationColor: '#2f6f4f',
  },
};

/**
 * The location-task options for a recording. Fixes are only delivered every `fixEveryM(transport)` metres (5 m on
 * foot and up to 25 m in a vehicle unless changed in Settings), which is what sets how many points a track has to
 * store.
 */
function taskOptions(transport: TransportId | null): LocationTaskOptions {
  return { ...TASK_OPTIONS, distanceInterval: fixEveryM(transport, useSettingsStore.getState().trackSpacingM) };
}

export type StartResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      /** The system won't ask again, so the only way forward is the app's page in Settings. */
      openSettings?: boolean;
    };

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

/**
 * iOS keeps delivering updates to a backgrounded app that started them on screen with only "While Using"
 * permission, but only "Always" lets the system relaunch the app after it has been terminated (low memory,
 * a reboot) and carry on recording. Asking after recording has started means the prompt never delays the
 * track, and a "Keep Only While Using" answer costs nothing: recording is already running. The system only
 * shows this once. Android needs no such step (its foreground service does the job).
 */
async function offerAlwaysPermission(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status !== 'granted' && current.canAskAgain) await Location.requestBackgroundPermissionsAsync();
  } catch {
    // Optional upgrade; recording doesn't depend on it.
  }
}

/** The native errors are written for developers ("add 'location' to 'UIBackgroundModes'…"); say what to do instead. */
function describeStartError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (/UIBackgroundModes/i.test(message)) {
    return "This build of K-Maps wasn't set up for background location. Install the latest build.";
  }
  if (/services are disabled/i.test(message)) return "Location Services are turned off. Turn them on in your phone's settings.";
  return message || 'Location updates could not be started.';
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

export async function startTrackRecording(db: SQLiteDatabase, transport: TransportId | null = null): Promise<StartResult> {
  // A second tap while the permission prompts are up must not start a second recording over the first.
  if (starting || useTrackRecordingStore.getState().recording) return { ok: true };
  starting = true;
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return { ok: false, reason: "Location Services are turned off. Turn them on in your phone's settings." };
    }
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return canAskAgain === false
        ? { ok: false, reason: 'Location access is turned off for K-Maps. Allow it in Settings to record tracks.', openSettings: true }
        : { ok: false, reason: 'Location permission was not granted.' };
    }
    await requestNotificationPermission();

    const startedAt = Date.now();
    await startRecordingSession(db, startedAt, transport);
    try {
      await Location.startLocationUpdatesAsync(TRACK_TASK_NAME, taskOptions(transport));
    } catch (err) {
      await clearRecording(db);
      return { ok: false, reason: describeStartError(err) };
    }
    useTrackRecordingStore.getState().begin(startedAt, transport);
    void offerAlwaysPermission();
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

type UpdatesState = 'running' | 'restarted' | 'failed';

/**
 * Makes sure location updates are running, restarting them if they had stopped. A restart means there was a
 * stretch with no fixes (the system killed the service, or on iOS the user force-quit the app), which the
 * store remembers so the UI can say the line jumps across it. When they can't be restarted the store is
 * flagged `interrupted`.
 */
async function ensureUpdatesRunning(): Promise<UpdatesState> {
  const store = useTrackRecordingStore.getState();
  try {
    const wasRunning = await Location.hasStartedLocationUpdatesAsync(TRACK_TASK_NAME);
    if (!wasRunning) await Location.startLocationUpdatesAsync(TRACK_TASK_NAME, taskOptions(store.transport));
    store.setInterrupted(false);
    if (!wasRunning) store.setResumedAfterGap(true);
    return wasRunning ? 'running' : 'restarted';
  } catch {
    store.setInterrupted(true);
    return 'failed';
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
  store.hydrate(session.startedAt, await loadRecordingFixes(db), session.transport);
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
      transport: session.transport,
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
