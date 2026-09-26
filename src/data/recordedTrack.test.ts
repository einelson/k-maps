import type { SQLiteDatabase } from 'expo-sqlite';

import { createTestDb } from '../testing/sqliteTestDb';
import { defaultTrackName, saveRecordedTrack, type RecordedTrack } from './recordedTrack';
import { getTrackData } from './trackDataRepo';

let db: SQLiteDatabase;
beforeEach(() => {
  db = createTestDb();
});

const track = (overrides: Partial<RecordedTrack> = {}): RecordedTrack => ({
  points: [[-116, 43], [-116.001, 43.001], [-116.002, 43.002]],
  samples: { times: [1000, 4000, 7000], elevations: [1500, 1505, 1510] },
  startedAt: Date.UTC(2026, 8, 24, 17, 2, 3),
  ...overrides,
});

describe('saveRecordedTrack', () => {
  it('saves a line feature with source "track", the recorded geometry and computed length', async () => {
    const id = await saveRecordedTrack(db, track());
    const row = await db.getFirstAsync<{ type: string; source: string; geometry: string; length_m: number; name: string }>(
      'SELECT * FROM features WHERE id = ?',
      id
    );
    expect(row!.type).toBe('line');
    expect(row!.source).toBe('track');
    expect(JSON.parse(row!.geometry)).toEqual({ type: 'LineString', coordinates: track().points });
    expect(row!.length_m).toBeGreaterThan(250);
    expect(row!.name).toBe(defaultTrackName(track().startedAt));
  });

  it('saves the per-point samples beside it', async () => {
    const id = await saveRecordedTrack(db, track());
    expect(await getTrackData(db, id)).toEqual({ times: [1000, 4000, 7000], elevations: [1500, 1505, 1510] });
  });

  it('refuses a track with fewer than two points and saves nothing', async () => {
    await expect(saveRecordedTrack(db, track({ points: [[-116, 43]], samples: { times: [1], elevations: [1] } }))).rejects.toThrow(
      'at least two points'
    );
    expect(await db.getAllAsync('SELECT * FROM features')).toEqual([]);
  });

  it('leaves neither the track nor its samples behind when the samples fail to save', async () => {
    const times = [1, 2, 3];
    Object.defineProperty(times, 1, {
      get() {
        throw new Error('boom'); // reading the samples fails after the feature row is already inserted
      },
    });
    await expect(saveRecordedTrack(db, track({ samples: { times, elevations: null } }))).rejects.toThrow('boom');
    expect(await db.getAllAsync('SELECT * FROM features')).toEqual([]);
    expect(await db.getAllAsync('SELECT * FROM track_data')).toEqual([]);
  });
});

describe('saveRecordedTrack: transport and size', () => {
  it('saves how the track was travelled on the feature', async () => {
    const id = await saveRecordedTrack(db, track({ transport: 'horse' }));
    expect((await db.getFirstAsync<{ transport: string | null }>('SELECT transport FROM features WHERE id = ?', id))!.transport).toBe('horse');
  });

  it('leaves it unset when none was chosen', async () => {
    const id = await saveRecordedTrack(db, track());
    expect((await db.getFirstAsync<{ transport: string | null }>('SELECT transport FROM features WHERE id = ?', id))!.transport).toBeNull();
  });

  it('stores coordinates to 6 decimals (about 11 cm), not the phone\'s full float precision', async () => {
    const id = await saveRecordedTrack(
      db,
      track({ points: [[-116.20123456789012, 43.60123456789012], [-116.20223456789012, 43.60223456789012]], samples: { times: [1, 2], elevations: [1, 2] } })
    );
    const row = await db.getFirstAsync<{ geometry: string }>('SELECT geometry FROM features WHERE id = ?', id);
    expect(JSON.parse(row!.geometry).coordinates).toEqual([[-116.201235, 43.601235], [-116.202235, 43.602235]]);
    expect(row!.geometry).not.toContain('789012');
  });
});

describe('defaultTrackName', () => {
  it('names the track for when it started', () => {
    expect(defaultTrackName(Date.UTC(2026, 8, 24, 17, 2, 3))).toBe(`Track ${new Date(Date.UTC(2026, 8, 24, 17, 2, 3)).toLocaleString()}`);
  });

  it('falls back to now when the start time is unknown', () => {
    expect(defaultTrackName(null)).toMatch(/^Track .+/);
  });
});
