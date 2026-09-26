import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getTrackData } from '../data/trackDataRepo';
import {
  appendRecordingFixes,
  getRecordingSession,
  loadRecordingFixes,
  startRecordingSession,
} from '../data/recordingRepo';
import { useSettingsStore } from '../state/useSettingsStore';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';
import { createTestDb } from '../testing/sqliteTestDb';
import { TRACK_TASK_NAME } from './trackConfig';
import {
  discardTrackRecording,
  finishTrackRecording,
  restoreRecording,
  startTrackRecording,
  syncRecording,
} from './trackRecorder';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  LocationAccuracy: { BestForNavigation: 6 },
  LocationActivityType: { Fitness: 3 },
}));

const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const startUpdates = Location.startLocationUpdatesAsync as jest.Mock;
const stopUpdates = Location.stopLocationUpdatesAsync as jest.Mock;
const hasStarted = Location.hasStartedLocationUpdatesAsync as jest.Mock;
const servicesEnabled = Location.hasServicesEnabledAsync as jest.Mock;
const getBackground = Location.getBackgroundPermissionsAsync as jest.Mock;
const requestBackground = Location.requestBackgroundPermissionsAsync as jest.Mock;

/** jest-expo runs as iOS by default; the notification prompt is Android-only. */
function asAndroid(version: number) {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version);
}

let db: SQLiteDatabase;
const store = () => useTrackRecordingStore.getState();
const fix = (time: number, lon = -116, lat = 43, altitude: number | null = 1500) => ({ time, lon, lat, altitude });

beforeEach(() => {
  db = createTestDb();
  useTrackRecordingStore.getState().reset();
  useSettingsStore.getState().resetTrackSpacing();
  requestPermission.mockReset().mockResolvedValue({ status: 'granted' });
  startUpdates.mockReset().mockResolvedValue(undefined);
  stopUpdates.mockReset().mockResolvedValue(undefined);
  hasStarted.mockReset().mockResolvedValue(true);
  servicesEnabled.mockReset().mockResolvedValue(true);
  getBackground.mockReset().mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  requestBackground.mockReset().mockResolvedValue({ status: 'granted', canAskAgain: true });
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('startTrackRecording', () => {
  it('refuses, starting nothing, when location permission is denied', async () => {
    requestPermission.mockResolvedValue({ status: 'denied' });
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: false, reason: 'Location permission was not granted.' });
    expect(startUpdates).not.toHaveBeenCalled();
    expect(await getRecordingSession(db)).toBeNull();
    expect(store().recording).toBe(false);
  });

  it('sends people to Settings when the system will not ask again', async () => {
    requestPermission.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await expect(startTrackRecording(db)).resolves.toEqual({
      ok: false,
      reason: 'Location access is turned off for K-Maps. Allow it in Settings to record tracks.',
      openSettings: true,
    });
    expect(startUpdates).not.toHaveBeenCalled();
  });

  it('does not offer Settings when the prompt can still be shown again', async () => {
    requestPermission.mockResolvedValue({ status: 'denied', canAskAgain: true });
    expect(await startTrackRecording(db)).not.toHaveProperty('openSettings');
  });

  it('refuses, before asking for anything, when Location Services are off', async () => {
    servicesEnabled.mockResolvedValue(false);
    await expect(startTrackRecording(db)).resolves.toEqual({
      ok: false,
      reason: "Location Services are turned off. Turn them on in your phone's settings.",
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(await getRecordingSession(db)).toBeNull();
  });

  it('opens a session, starts the foreground-service location task, and begins the live mirror', async () => {
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
    expect(await getRecordingSession(db)).toEqual({ startedAt: expect.any(Number), transport: null });
    expect(store().recording).toBe(true);
    expect(store().startedAt).toBe((await getRecordingSession(db))!.startedAt);

    const [name, options] = startUpdates.mock.calls[0];
    expect(name).toBe(TRACK_TASK_NAME);
    expect(options.foregroundService).toMatchObject({ notificationTitle: expect.any(String), notificationBody: expect.any(String) });
    expect(options.foregroundService.killServiceOnDestroy).toBeUndefined(); // it must outlive the app being closed
    expect(options.timeInterval).toBe(3000);
    expect(options.distanceInterval).toBe(5);
  });

  it('asks the GPS for a fix every 5 m on foot, but every 25 m in a vehicle, and remembers the mode', async () => {
    await startTrackRecording(db, 'foot');
    expect(startUpdates.mock.calls[0][1].distanceInterval).toBe(5);
    await discardTrackRecording(db);

    await startTrackRecording(db, 'vehicle');
    expect(startUpdates.mock.calls[1][1].distanceInterval).toBe(25);
    expect(store().transport).toBe('vehicle');
    expect(await getRecordingSession(db)).toEqual({ startedAt: expect.any(Number), transport: 'vehicle' });
  });

  it('uses the spacing set in Settings for the chosen mode', async () => {
    useSettingsStore.getState().setTrackSpacing('foot', 2);
    useSettingsStore.getState().setTrackSpacing('horse', 40);
    await startTrackRecording(db, 'foot');
    expect(startUpdates.mock.calls[0][1].distanceInterval).toBe(2);
    await discardTrackRecording(db);
    await startTrackRecording(db, 'horse');
    expect(startUpdates.mock.calls[1][1].distanceInterval).toBe(40);
  });

  it('configures the iOS side: blue pill, no automatic pausing, fitness activity', async () => {
    await startTrackRecording(db);
    const [, options] = startUpdates.mock.calls[0];
    expect(options.showsBackgroundLocationIndicator).toBe(true);
    expect(options.pausesUpdatesAutomatically).toBe(false);
    expect(options.activityType).toBe(3);
  });

  it('asks for notification permission on Android 13+, and records even if it is refused', async () => {
    (PermissionsAndroid.request as jest.Mock).mockResolvedValue('denied');
    asAndroid(34);
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
    expect(PermissionsAndroid.request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
  });

  it('does not ask on older Android', async () => {
    asAndroid(30);
    await startTrackRecording(db);
    expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  });

  it('does not ask on iOS', async () => {
    await startTrackRecording(db);
    expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  });

  it('still records when the notification prompt itself fails', async () => {
    (PermissionsAndroid.request as jest.Mock).mockRejectedValue(new Error('no activity'));
    asAndroid(34);
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
  });

  it('turns the iOS "background mode not configured" error into something actionable', async () => {
    startUpdates.mockRejectedValue(new Error("Background location has not been configured, make sure to add 'location' to 'UIBackgroundModes' in the Info.plist file"));
    const result = await startTrackRecording(db);
    expect(result).toEqual({ ok: false, reason: "This build of K-Maps wasn't set up for background location. Install the latest build." });
  });

  it('turns a Location Services error from the native side into plain words', async () => {
    startUpdates.mockRejectedValue(new Error('Location services are disabled'));
    expect(await startTrackRecording(db)).toEqual({
      ok: false,
      reason: "Location Services are turned off. Turn them on in your phone's settings.",
    });
  });

  it('gives a fallback message when the error has none', async () => {
    startUpdates.mockRejectedValue('nope');
    expect(await startTrackRecording(db)).toEqual({ ok: false, reason: 'Location updates could not be started.' });
  });

  it('undoes the session and reports why when the service cannot start', async () => {
    startUpdates.mockRejectedValue(new Error('Foreground service cannot be started while the app is in the background'));
    await expect(startTrackRecording(db)).resolves.toEqual({
      ok: false,
      reason: 'Foreground service cannot be started while the app is in the background',
    });
    expect(await getRecordingSession(db)).toBeNull();
    expect(store().recording).toBe(false);
  });

  it('ignores a second start while the first is still asking for permission', async () => {
    let grant!: (value: { status: string }) => void;
    requestPermission.mockReturnValueOnce(new Promise((resolve) => (grant = resolve)));
    const first = startTrackRecording(db);
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    grant({ status: 'granted' });
    await first;
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it('can start again after a failed start', async () => {
    requestPermission.mockResolvedValueOnce({ status: 'denied' });
    await startTrackRecording(db);
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it('does nothing when a recording is already running', async () => {
    await startTrackRecording(db);
    startUpdates.mockClear();
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
    expect(startUpdates).not.toHaveBeenCalled();
  });
});

describe('the iOS "Always" upgrade', () => {
  it('is offered once recording has started, on iOS', async () => {
    await startTrackRecording(db);
    expect(startUpdates).toHaveBeenCalled();
    expect(requestBackground).toHaveBeenCalledTimes(1);
  });

  it('is not offered when it is already granted, or the system will not ask again', async () => {
    getBackground.mockResolvedValueOnce({ status: 'granted', canAskAgain: true });
    await startTrackRecording(db);
    expect(requestBackground).not.toHaveBeenCalled();

    await discardTrackRecording(db);
    getBackground.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    await startTrackRecording(db);
    expect(requestBackground).not.toHaveBeenCalled();
  });

  it('is never offered on Android, whose foreground service needs no such permission', async () => {
    asAndroid(34);
    await startTrackRecording(db);
    expect(getBackground).not.toHaveBeenCalled();
    expect(requestBackground).not.toHaveBeenCalled();
  });

  it('is not asked for when recording could not start', async () => {
    startUpdates.mockRejectedValue(new Error('nope'));
    await startTrackRecording(db);
    expect(requestBackground).not.toHaveBeenCalled();
  });

  it('never blocks or fails the recording, even if the prompt throws', async () => {
    requestBackground.mockRejectedValue(new Error('prompt failed'));
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
    await Promise.resolve();
    expect(store().recording).toBe(true);
  });
});

describe('syncRecording', () => {
  it('mirrors fixes the task stored, only the new ones each time', async () => {
    await startTrackRecording(db);
    await appendRecordingFixes(db, [fix(1000, -116, 43, 1500), fix(4000, -116.001, 43, 1510)]);
    await syncRecording(db);
    expect(store().points).toEqual([[-116, 43], [-116.001, 43]]);
    expect(store().times).toEqual([1000, 4000]);
    expect(store().altitudes).toEqual([1500, 1510]);
    expect(store().distanceM).toBeGreaterThan(70);

    await appendRecordingFixes(db, [fix(7000, -116.002, 43, null)]);
    await syncRecording(db);
    expect(store().points).toHaveLength(3);
    expect(store().altitudes).toEqual([1500, 1510, null]);
  });

  it('does nothing when not recording', async () => {
    await syncRecording(db);
    expect(store().points).toEqual([]);
  });

  it('retries the service when it had stopped, clearing the flag on success', async () => {
    await startTrackRecording(db);
    store().setInterrupted(true);
    hasStarted.mockResolvedValue(false);
    await syncRecording(db);
    expect(startUpdates).toHaveBeenCalledTimes(2);
    expect(store().interrupted).toBe(false);
    expect(store().resumedAfterGap).toBe(true);
  });
});

describe('restoreRecording', () => {
  it('does nothing when there is no recording and none on screen', async () => {
    await restoreRecording(db);
    expect(store().recording).toBe(false);
  });

  it('rebuilds the live recording from the database after the app was closed', async () => {
    await startRecordingSession(db, 5000);
    await appendRecordingFixes(db, [fix(6000), fix(9000, -116.001)]);

    await restoreRecording(db);

    expect(store().recording).toBe(true);
    expect(store().startedAt).toBe(5000);
    expect(store().points).toHaveLength(2);
    expect(store().distanceM).toBeGreaterThan(70);
    expect(store().interrupted).toBe(false);
    expect(startUpdates).not.toHaveBeenCalled(); // the service was still running
  });

  it('restarts the service if the system killed it, so the recording carries on', async () => {
    await startRecordingSession(db, 5000);
    hasStarted.mockResolvedValue(false);
    await restoreRecording(db);
    expect(startUpdates).toHaveBeenCalledTimes(1);
    expect(store().interrupted).toBe(false);
    expect(store().resumedAfterGap).toBe(true); // there was a stretch with nothing recorded
  });

  it('brings back the mode, and restarts a killed service at that mode\'s spacing', async () => {
    await startRecordingSession(db, 5000, 'atv');
    hasStarted.mockResolvedValue(false);
    await restoreRecording(db);
    expect(store().transport).toBe('atv');
    expect(startUpdates.mock.calls[0][1].distanceInterval).toBe(15);
  });

  it('does not flag a gap when the service was still running', async () => {
    await startRecordingSession(db, 5000);
    await restoreRecording(db);
    expect(store().resumedAfterGap).toBe(false);
  });

  it('flags the recording as interrupted when the service cannot be restarted', async () => {
    await startRecordingSession(db, 5000);
    hasStarted.mockResolvedValue(false);
    startUpdates.mockRejectedValue(new Error('permission revoked'));
    await restoreRecording(db);
    expect(store().recording).toBe(true);
    expect(store().interrupted).toBe(true);
  });

  it('only catches up on new fixes when the app was merely backgrounded', async () => {
    await startTrackRecording(db);
    const startedAt = store().startedAt!;
    await appendRecordingFixes(db, [fix(1000)]);
    await syncRecording(db);
    await appendRecordingFixes(db, [fix(4000, -116.001)]);
    await restoreRecording(db);
    expect(store().startedAt).toBe(startedAt);
    expect(store().points).toHaveLength(2);
  });

  it('clears the live recording if it was saved or deleted elsewhere', async () => {
    store().begin(1234);
    await restoreRecording(db);
    expect(store().recording).toBe(false);
  });
});

describe('finishTrackRecording', () => {
  it('saves the fixes as a track with its samples, clears the recording, stops the service', async () => {
    await startTrackRecording(db);
    await appendRecordingFixes(db, [fix(1000, -116, 43, 1500), fix(4000, -116.001, 43, 1510), fix(7000, -116.002, 43, 1520)]);

    const id = await finishTrackRecording(db);

    expect(id).not.toBeNull();
    const row = await db.getFirstAsync<{ type: string; source: string; geometry: string }>('SELECT * FROM features WHERE id = ?', id);
    expect(row!.source).toBe('track');
    expect(JSON.parse(row!.geometry).coordinates).toEqual([[-116, 43], [-116.001, 43], [-116.002, 43]]);
    expect(await getTrackData(db, id!)).toEqual({ times: [1000, 4000, 7000], elevations: [1500, 1510, 1520] });
    expect(await getRecordingSession(db)).toBeNull();
    expect(await loadRecordingFixes(db)).toEqual([]);
    expect(stopUpdates).toHaveBeenCalledWith(TRACK_TASK_NAME);
    expect(store().recording).toBe(false);
  });

  it('saves the track with the mode it was recorded with', async () => {
    await startTrackRecording(db, 'horse');
    await appendRecordingFixes(db, [fix(1000), fix(4000, -116.001)]);
    const id = await finishTrackRecording(db);
    expect((await db.getFirstAsync<{ transport: string | null }>('SELECT transport FROM features WHERE id = ?', id))!.transport).toBe('horse');
  });

  it('saves from the database, so fixes the app never mirrored (recorded while closed) are included', async () => {
    await startTrackRecording(db);
    await appendRecordingFixes(db, [fix(1000), fix(4000, -116.001)]); // never synced into the store
    const id = await finishTrackRecording(db);
    expect((await db.getFirstAsync<{ geometry: string }>('SELECT geometry FROM features WHERE id = ?', id))!.geometry).toContain('-116.001');
  });

  it('discards a recording with fewer than two points and returns null', async () => {
    await startTrackRecording(db);
    await appendRecordingFixes(db, [fix(1000)]);
    await expect(finishTrackRecording(db)).resolves.toBeNull();
    expect(await db.getAllAsync('SELECT * FROM features')).toEqual([]);
    expect(await getRecordingSession(db)).toBeNull();
    expect(store().recording).toBe(false);
  });

  it('keeps the recording, and does not stop the service, if saving fails', async () => {
    await startTrackRecording(db);
    await appendRecordingFixes(db, [fix(1000), fix(4000, -116.001)]);
    const failing = { ...db, withTransactionAsync: () => Promise.reject(new Error('disk full')), getFirstAsync: db.getFirstAsync.bind(db), getAllAsync: db.getAllAsync.bind(db) } as unknown as SQLiteDatabase;
    await expect(finishTrackRecording(failing)).rejects.toThrow('disk full');
    expect(await getRecordingSession(db)).not.toBeNull();
    expect(await loadRecordingFixes(db)).toHaveLength(2);
    expect(stopUpdates).not.toHaveBeenCalled();
    expect(store().recording).toBe(true);
  });

  it('is safe with nothing recorded', async () => {
    await expect(finishTrackRecording(db)).resolves.toBeNull();
  });

  it('still finishes if stopping the service throws', async () => {
    await startTrackRecording(db);
    await appendRecordingFixes(db, [fix(1000), fix(4000, -116.001)]);
    stopUpdates.mockRejectedValue(new Error('gone'));
    await expect(finishTrackRecording(db)).resolves.not.toBeNull();
  });
});

describe('discardTrackRecording', () => {
  it('throws the recording away, stops the service and clears the mirror', async () => {
    await startTrackRecording(db);
    await appendRecordingFixes(db, [fix(1000), fix(4000, -116.001)]);
    await syncRecording(db);

    await discardTrackRecording(db);

    expect(await getRecordingSession(db)).toBeNull();
    expect(await loadRecordingFixes(db)).toEqual([]);
    expect(await db.getAllAsync('SELECT * FROM features')).toEqual([]);
    expect(stopUpdates).toHaveBeenCalledWith(TRACK_TASK_NAME);
    expect(store().recording).toBe(false);
    expect(store().points).toEqual([]);
  });
});
