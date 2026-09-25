import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getRecordingSession, loadRecordingFixes, startRecordingSession } from '../data/recordingRepo';
import { createTestDb } from '../testing/sqliteTestDb';
import { MAX_ACCURACY_M, TRACK_TASK_NAME } from './trackConfig';
import { fixesFromLocations, recordLocations } from './trackTask';

jest.mock('expo-location', () => ({
  hasStartedLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const hasStarted = Location.hasStartedLocationUpdatesAsync as jest.Mock;
const stopUpdates = Location.stopLocationUpdatesAsync as jest.Mock;

const location = (lon: number, lat: number, timestamp: number, coords: Record<string, unknown> = {}) =>
  ({ coords: { longitude: lon, latitude: lat, altitude: 1500, accuracy: 5, ...coords }, timestamp }) as never;

// Captured at import time, before any test's clearAllMocks.
const [defineTaskCall] = (TaskManager.defineTask as jest.Mock).mock.calls;

let db: SQLiteDatabase;
beforeEach(() => {
  db = createTestDb();
  hasStarted.mockReset().mockResolvedValue(true);
  stopUpdates.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('registration', () => {
  it('defines the recording task at import time (it must exist before the app mounts)', () => {
    expect(defineTaskCall[0]).toBe(TRACK_TASK_NAME);
    expect(typeof defineTaskCall[1]).toBe('function');
  });
});

describe('fixesFromLocations', () => {
  it('maps coordinates, timestamp and altitude', () => {
    expect(fixesFromLocations([location(-116, 43, 1000, { altitude: 1512.5 })])).toEqual([
      { time: 1000, lon: -116, lat: 43, altitude: 1512.5 },
    ]);
  });

  it('records a missing altitude as null', () => {
    const fixes = fixesFromLocations([location(-116, 43, 1, { altitude: null }), location(-116, 43, 2, { altitude: undefined })]);
    expect(fixes.map((f) => f.altitude)).toEqual([null, null]);
  });

  it('drops fixes less accurate than the limit, keeping those at it and those with no accuracy', () => {
    const fixes = fixesFromLocations([
      location(-116, 43, 1, { accuracy: MAX_ACCURACY_M + 1 }),
      location(-116, 43, 2, { accuracy: MAX_ACCURACY_M }),
      location(-116, 43, 3, { accuracy: null }),
    ]);
    expect(fixes.map((f) => f.time)).toEqual([2, 3]);
  });

  it('handles an empty batch', () => {
    expect(fixesFromLocations([])).toEqual([]);
  });
});

describe('recordLocations', () => {
  it('appends a batch to the active recording and leaves updates running', async () => {
    await startRecordingSession(db, 0);
    await recordLocations(db, [location(-116, 43, 1000), location(-116.001, 43, 4000)]);
    expect((await loadRecordingFixes(db)).map((f) => f.time)).toEqual([1000, 4000]);
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it('stops the service when there is no recording to add to (it was saved or deleted meanwhile)', async () => {
    await recordLocations(db, [location(-116, 43, 1000)]);
    expect(await loadRecordingFixes(db)).toEqual([]);
    expect(stopUpdates).toHaveBeenCalledWith(TRACK_TASK_NAME);
  });

  it('does not try to stop a service that is not running', async () => {
    hasStarted.mockResolvedValue(false);
    await recordLocations(db, [location(-116, 43, 1000)]);
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it('keeps the recording when every fix in a batch was too inaccurate', async () => {
    await startRecordingSession(db, 0);
    await recordLocations(db, [location(-116, 43, 1000, { accuracy: 500 })]);
    expect(await getRecordingSession(db)).not.toBeNull();
    expect(stopUpdates).not.toHaveBeenCalled();
  });
});

describe('the task executor', () => {
  /** A fresh copy of the module, because it caches its database connection between calls. */
  function freshTask() {
    let task!: typeof import('./trackTask');
    let openDatabaseAsync!: jest.Mock;
    jest.isolateModules(() => {
      openDatabaseAsync = jest.requireMock('expo-sqlite').openDatabaseAsync;
      openDatabaseAsync.mockReset(); // the mock itself is shared between fresh copies of the module
      task = jest.requireActual('./trackTask');
    });
    return { handleTrackTask: task.handleTrackTask, openDatabaseAsync };
  }

  it('stores the locations it is given, through its own database connection', async () => {
    const { handleTrackTask, openDatabaseAsync } = freshTask();
    openDatabaseAsync.mockResolvedValue(db);
    await startRecordingSession(db, 0);
    await handleTrackTask({ data: { locations: [location(-116, 43, 1000)] } });
    expect(openDatabaseAsync).toHaveBeenCalledWith('kmaps.db');
    expect((await loadRecordingFixes(db)).map((f) => f.time)).toEqual([1000]);
  });

  it('waits out a briefly busy database instead of failing the batch', async () => {
    const { handleTrackTask, openDatabaseAsync } = freshTask();
    const execAsync = jest.fn(async () => undefined);
    openDatabaseAsync.mockResolvedValue({ ...db, execAsync, getFirstAsync: db.getFirstAsync.bind(db) });
    await handleTrackTask({ data: { locations: [] } });
    expect(execAsync).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000');
  });

  it('opens the connection once and reuses it for later batches', async () => {
    const { handleTrackTask, openDatabaseAsync } = freshTask();
    openDatabaseAsync.mockResolvedValue(db);
    await startRecordingSession(db, 0);
    await handleTrackTask({ data: { locations: [location(-116, 43, 1000)] } });
    await handleTrackTask({ data: { locations: [location(-116.001, 43, 4000)] } });
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(await loadRecordingFixes(db)).toHaveLength(2);
  });

  it('ignores a task error, or a call with no locations, without touching the database', async () => {
    const { handleTrackTask, openDatabaseAsync } = freshTask();
    await handleTrackTask({ error: { code: 1, message: 'boom' } });
    await handleTrackTask({ data: {} });
    await handleTrackTask({});
    expect(openDatabaseAsync).not.toHaveBeenCalled();
  });

  it('survives a failed write, and opens a fresh connection for the next batch', async () => {
    const { handleTrackTask, openDatabaseAsync } = freshTask();
    await startRecordingSession(db, 0);
    const broken = {
      execAsync: async () => undefined,
      getFirstAsync: db.getFirstAsync.bind(db),
      withTransactionAsync: () => Promise.reject(new Error('disk I/O error')),
    };
    openDatabaseAsync.mockResolvedValueOnce(broken).mockResolvedValue(db);

    await expect(handleTrackTask({ data: { locations: [location(-116, 43, 1000)] } })).resolves.toBeUndefined();
    expect(await loadRecordingFixes(db)).toEqual([]);

    await handleTrackTask({ data: { locations: [location(-116, 43, 2000)] } });
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
    expect((await loadRecordingFixes(db)).map((f) => f.time)).toEqual([2000]);
  });

  it('survives the database failing to open at all', async () => {
    const { handleTrackTask, openDatabaseAsync } = freshTask();
    openDatabaseAsync.mockRejectedValueOnce(new Error('locked')).mockResolvedValue(db);
    await startRecordingSession(db, 0);
    await expect(handleTrackTask({ data: { locations: [location(-116, 43, 1000)] } })).resolves.toBeUndefined();
    await handleTrackTask({ data: { locations: [location(-116, 43, 2000)] } });
    expect((await loadRecordingFixes(db)).map((f) => f.time)).toEqual([2000]);
  });
});
