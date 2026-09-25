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
  LocationAccuracy: { BestForNavigation: 6 },
}));

const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const startUpdates = Location.startLocationUpdatesAsync as jest.Mock;
const stopUpdates = Location.stopLocationUpdatesAsync as jest.Mock;
const hasStarted = Location.hasStartedLocationUpdatesAsync as jest.Mock;

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
  requestPermission.mockReset().mockResolvedValue({ status: 'granted' });
  startUpdates.mockReset().mockResolvedValue(undefined);
  stopUpdates.mockReset().mockResolvedValue(undefined);
  hasStarted.mockReset().mockResolvedValue(true);
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

  it('opens a session, starts the foreground-service location task, and begins the live mirror', async () => {
    await expect(startTrackRecording(db)).resolves.toEqual({ ok: true });
    expect(await getRecordingSession(db)).toEqual({ startedAt: expect.any(Number) });
    expect(store().recording).toBe(true);
    expect(store().startedAt).toBe((await getRecordingSession(db))!.startedAt);

    const [name, options] = startUpdates.mock.calls[0];
    expect(name).toBe(TRACK_TASK_NAME);
    expect(options.foregroundService).toMatchObject({ notificationTitle: expect.any(String), notificationBody: expect.any(String) });
    expect(options.foregroundService.killServiceOnDestroy).toBeUndefined(); // it must outlive the app being closed
    expect(options.timeInterval).toBe(3000);
    expect(options.distanceInterval).toBe(5);
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
