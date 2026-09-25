import type { SQLiteDatabase } from 'expo-sqlite';

import { createTestDb } from '../testing/sqliteTestDb';
import {
  appendRecordingFixes,
  clearRecording,
  getRecordingSession,
  loadRecordingFixes,
  startRecordingSession,
  type NewFix,
} from './recordingRepo';

let db: SQLiteDatabase;
beforeEach(() => {
  db = createTestDb();
});

const fix = (time: number, extra: Partial<NewFix> = {}): NewFix => ({ time, lon: -116, lat: 43 + time / 1e6, altitude: 1500, ...extra });

describe('recording session', () => {
  it('has no session until one is started', async () => {
    expect(await getRecordingSession(db)).toBeNull();
    await startRecordingSession(db, 5000);
    expect(await getRecordingSession(db)).toEqual({ startedAt: 5000 });
  });

  it('starting again replaces the session and wipes the old fixes', async () => {
    await startRecordingSession(db, 1000);
    await appendRecordingFixes(db, [fix(1), fix(2)]);
    await startRecordingSession(db, 9000);
    expect(await getRecordingSession(db)).toEqual({ startedAt: 9000 });
    expect(await loadRecordingFixes(db)).toEqual([]);
  });

  it('clearRecording removes the session and every fix', async () => {
    await startRecordingSession(db, 1000);
    await appendRecordingFixes(db, [fix(1)]);
    await clearRecording(db);
    expect(await getRecordingSession(db)).toBeNull();
    expect(await loadRecordingFixes(db)).toEqual([]);
    await clearRecording(db); // harmless when there is nothing to clear
  });
});

describe('appendRecordingFixes', () => {
  it('returns null, and stores nothing, when there is no recording', async () => {
    expect(await appendRecordingFixes(db, [fix(1)])).toBeNull();
    expect(await db.getAllAsync('SELECT * FROM recording_fixes')).toEqual([]);
  });

  it('stores fixes in time order with their altitude', async () => {
    await startRecordingSession(db, 0);
    expect(await appendRecordingFixes(db, [fix(3, { altitude: null }), fix(1), fix(2, { altitude: 1600.5 })])).toBe(3);
    const stored = await loadRecordingFixes(db);
    expect(stored.map((f) => f.time)).toEqual([1, 2, 3]);
    expect(stored.map((f) => f.altitude)).toEqual([1500, 1600.5, null]);
    expect(stored[0]).toEqual({ id: expect.any(Number), time: 1, lon: -116, lat: 43 + 1e-6, altitude: 1500 });
  });

  it('skips fixes that are not newer than the last stored one (redelivered batches)', async () => {
    await startRecordingSession(db, 0);
    await appendRecordingFixes(db, [fix(10), fix(20)]);
    expect(await appendRecordingFixes(db, [fix(10), fix(20), fix(30)])).toBe(1);
    expect((await loadRecordingFixes(db)).map((f) => f.time)).toEqual([10, 20, 30]);
  });

  it('drops a repeated timestamp inside one batch', async () => {
    await startRecordingSession(db, 0);
    expect(await appendRecordingFixes(db, [fix(5), fix(5), fix(6)])).toBe(2);
  });

  it('accepts an empty batch', async () => {
    await startRecordingSession(db, 0);
    expect(await appendRecordingFixes(db, [])).toBe(0);
  });

  it('keeps everything stored if a later batch fails midway', async () => {
    await startRecordingSession(db, 0);
    await appendRecordingFixes(db, [fix(1)]);
    await expect(appendRecordingFixes(db, [fix(2), { ...fix(3), lon: undefined as unknown as number }])).rejects.toThrow();
    expect((await loadRecordingFixes(db)).map((f) => f.time)).toEqual([1]); // the failed batch rolled back whole
  });
});

describe('loadRecordingFixes', () => {
  it('returns only fixes after the given id', async () => {
    await startRecordingSession(db, 0);
    await appendRecordingFixes(db, [fix(1), fix(2), fix(3)]);
    const all = await loadRecordingFixes(db);
    expect((await loadRecordingFixes(db, all[1].id)).map((f) => f.time)).toEqual([3]);
    expect(await loadRecordingFixes(db, all[2].id)).toEqual([]);
  });
});
