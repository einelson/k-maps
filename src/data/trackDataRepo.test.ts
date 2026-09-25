import type { SQLiteDatabase } from 'expo-sqlite';

import { createTestDb } from '../testing/sqliteTestDb';
import { bulkDelete, createFeature, deleteFeature, updateFeatureGeometry } from './featuresRepo';
import {
  deleteTrackData,
  dropTrackDataIfMisaligned,
  getTrackData,
  getTrackDataForFeatures,
  sampleCount,
  saveTrackData,
} from './trackDataRepo';

let db: SQLiteDatabase;

const line = (n: number) => ({
  type: 'LineString' as const,
  coordinates: Array.from({ length: n }, (_, i): [number, number] => [-116 + i * 0.001, 43]),
});

async function trackWith(n: number, samples = { times: Array.from({ length: n }, (_, i) => i * 1000), elevations: Array.from({ length: n }, () => 1000) }) {
  const id = await createFeature(db, { geometry: line(n), source: 'track' });
  await saveTrackData(db, id, samples);
  return id;
}

beforeEach(() => {
  db = createTestDb();
});

describe('saveTrackData / getTrackData', () => {
  it('round-trips times and elevations', async () => {
    const id = await createFeature(db, { geometry: line(3), source: 'track' });
    await saveTrackData(db, id, { times: [1000, 2000, 3000], elevations: [1500.5, null, 1502] });
    expect(await getTrackData(db, id)).toEqual({ times: [1000, 2000, 3000], elevations: [1500.5, null, 1502] });
  });

  it('keeps a missing half as null', async () => {
    const a = await createFeature(db, { geometry: line(2) });
    const b = await createFeature(db, { geometry: line(2) });
    await saveTrackData(db, a, { times: [1, 2], elevations: null });
    await saveTrackData(db, b, { times: null, elevations: [10, 11] });
    expect(await getTrackData(db, a)).toEqual({ times: [1, 2], elevations: null });
    expect(await getTrackData(db, b)).toEqual({ times: null, elevations: [10, 11] });
  });

  it('rounds altitude to a tenth of a metre', async () => {
    const id = await createFeature(db, { geometry: line(2) });
    await saveTrackData(db, id, { times: null, elevations: [1234.5678, 0.04] });
    expect((await getTrackData(db, id))!.elevations).toEqual([1234.6, 0]);
  });

  it('replaces earlier data for the same feature', async () => {
    const id = await trackWith(3);
    await saveTrackData(db, id, { times: [7, 8, 9], elevations: null });
    expect(await getTrackData(db, id)).toEqual({ times: [7, 8, 9], elevations: null });
  });

  it('returns null for a feature with no data', async () => {
    const id = await createFeature(db, { geometry: line(2) });
    expect(await getTrackData(db, id)).toBeNull();
    expect(await getTrackData(db, 9999)).toBeNull();
  });

  it('returns null rather than throwing for corrupt stored data', async () => {
    const id = await createFeature(db, { geometry: line(2) });
    for (const bad of ['not json', '{"t":"x"}', '{"t":[1,"2"]}', '{"e":[1,"a"]}', '{"t":[1,null]}']) {
      await db.runAsync('INSERT OR REPLACE INTO track_data (feature_id, data) VALUES (?, ?)', id, bad);
      expect(await getTrackData(db, id)).toBeNull();
    }
  });
});

describe('getTrackDataForFeatures', () => {
  it('loads several at once and skips features without data', async () => {
    const a = await trackWith(3);
    const b = await trackWith(4);
    const c = await createFeature(db, { geometry: line(2) });
    const map = await getTrackDataForFeatures(db, [a, b, c]);
    expect([...map.keys()].sort()).toEqual([a, b].sort());
    expect(sampleCount(map.get(b)!)).toBe(4);
  });

  it('handles an empty list and more ids than one query chunk', async () => {
    expect((await getTrackDataForFeatures(db, [])).size).toBe(0);
    const id = await trackWith(3);
    const many = [...Array.from({ length: 1200 }, (_, i) => 100_000 + i), id];
    expect((await getTrackDataForFeatures(db, many)).has(id)).toBe(true);
  });
});

describe('sampleCount', () => {
  it('reports the length of whichever half exists', () => {
    expect(sampleCount({ times: [1, 2, 3], elevations: null })).toBe(3);
    expect(sampleCount({ times: null, elevations: [1, 2] })).toBe(2);
    expect(sampleCount({ times: null, elevations: null })).toBeNull();
  });
});

describe('deleting', () => {
  it('deleteTrackData removes only the named features', async () => {
    const a = await trackWith(3);
    const b = await trackWith(3);
    await deleteTrackData(db, [a]);
    expect(await getTrackData(db, a)).toBeNull();
    expect(await getTrackData(db, b)).not.toBeNull();
    await deleteTrackData(db, []); // no-op, no invalid SQL
  });

  it('deleteFeature takes the track data with it', async () => {
    const id = await trackWith(3);
    await deleteFeature(db, id);
    expect(await getTrackData(db, id)).toBeNull();
    expect(await db.getFirstAsync('SELECT * FROM track_data WHERE feature_id = ?', id)).toBeNull();
  });

  it('bulkDelete takes the track data of every deleted feature and leaves the rest', async () => {
    const a = await trackWith(3);
    const b = await trackWith(3);
    const keep = await trackWith(3);
    await bulkDelete(db, [a, b]);
    expect(await getTrackData(db, a)).toBeNull();
    expect(await getTrackData(db, b)).toBeNull();
    expect(await getTrackData(db, keep)).not.toBeNull();
  });
});

describe('editing a track after recording', () => {
  it('keeps the data when a vertex is moved (same count)', async () => {
    const id = await trackWith(5);
    const moved = line(5);
    moved.coordinates[2] = [-115.99, 43.01];
    await updateFeatureGeometry(db, id, moved);
    expect(await getTrackData(db, id)).not.toBeNull();
  });

  it('drops the data when a vertex is added or removed, because the arrays no longer line up', async () => {
    const added = await trackWith(5);
    await updateFeatureGeometry(db, added, line(6));
    expect(await getTrackData(db, added)).toBeNull();

    const removed = await trackWith(5);
    await updateFeatureGeometry(db, removed, line(4));
    expect(await getTrackData(db, removed)).toBeNull();
  });

  it('does not touch data for a feature that has none, or for non-line geometry', async () => {
    const plain = await createFeature(db, { geometry: line(3) });
    await updateFeatureGeometry(db, plain, line(4));
    const pin = await createFeature(db, { geometry: { type: 'Point', coordinates: [-116, 43] } });
    await updateFeatureGeometry(db, pin, { type: 'Point', coordinates: [-116.1, 43.1] });
  });

  it('dropTrackDataIfMisaligned compares against whichever half exists', async () => {
    const id = await createFeature(db, { geometry: line(4) });
    await saveTrackData(db, id, { times: null, elevations: [1, 2, 3, 4] });
    await dropTrackDataIfMisaligned(db, id, 4);
    expect(await getTrackData(db, id)).not.toBeNull();
    await dropTrackDataIfMisaligned(db, id, 3);
    expect(await getTrackData(db, id)).toBeNull();
  });
});
