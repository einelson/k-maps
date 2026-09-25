import type { SQLiteDatabase } from 'expo-sqlite';

import type { TrackSamples } from '../features/trackStats';

/**
 * Per-point time and altitude for a track, kept beside the feature rather than in its geometry so the line
 * stays plain [lon, lat] for everything else (map, export, vertex editing, metrics). The arrays line up
 * one-to-one with the line's coordinates; once the vertex count changes they no longer do, and
 * `dropTrackDataIfMisaligned` discards them.
 */

function encode(samples: TrackSamples): string {
  return JSON.stringify({
    t: samples.times,
    // A tenth of a metre is far finer than GPS altitude; it keeps the stored JSON compact.
    e: samples.elevations?.map((e) => (e == null ? null : Math.round(e * 10) / 10)) ?? null,
  });
}

const isNumberArray = (v: unknown, allowNull: boolean): boolean =>
  Array.isArray(v) &&
  v.every((x) => (allowNull && x === null) || (typeof x === 'number' && Number.isFinite(x)));

function decode(data: string): TrackSamples | null {
  try {
    const parsed = JSON.parse(data) as { t?: unknown; e?: unknown };
    const times = parsed.t == null ? null : parsed.t;
    const elevations = parsed.e == null ? null : parsed.e;
    if (times != null && !isNumberArray(times, false)) return null;
    if (elevations != null && !isNumberArray(elevations, true)) return null;
    return { times: times as number[] | null, elevations: elevations as (number | null)[] | null };
  } catch {
    return null;
  }
}

/** How many points the samples describe, or null when they hold neither times nor elevations. */
export function sampleCount(samples: TrackSamples): number | null {
  return samples.times?.length ?? samples.elevations?.length ?? null;
}

export async function saveTrackData(db: SQLiteDatabase, featureId: number, samples: TrackSamples): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO track_data (feature_id, data) VALUES (?, ?)', featureId, encode(samples));
}

export async function getTrackData(db: SQLiteDatabase, featureId: number): Promise<TrackSamples | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM track_data WHERE feature_id = ?', featureId);
  return row ? decode(row.data) : null;
}

export async function getTrackDataForFeatures(
  db: SQLiteDatabase,
  featureIds: number[]
): Promise<Map<number, TrackSamples>> {
  const result = new Map<number, TrackSamples>();
  // Chunked so a big export stays under SQLite's bound-parameter limit.
  for (let i = 0; i < featureIds.length; i += 500) {
    const chunk = featureIds.slice(i, i + 500);
    const rows = await db.getAllAsync<{ feature_id: number; data: string }>(
      `SELECT feature_id, data FROM track_data WHERE feature_id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk
    );
    for (const row of rows) {
      const samples = decode(row.data);
      if (samples) result.set(row.feature_id, samples);
    }
  }
  return result;
}

export async function deleteTrackData(db: SQLiteDatabase, featureIds: number[]): Promise<void> {
  if (featureIds.length === 0) return;
  await db.runAsync(`DELETE FROM track_data WHERE feature_id IN (${featureIds.map(() => '?').join(',')})`, ...featureIds);
}

/** Called after a line's geometry is rewritten: samples for a different number of points are meaningless. */
export async function dropTrackDataIfMisaligned(
  db: SQLiteDatabase,
  featureId: number,
  pointCount: number
): Promise<void> {
  const samples = await getTrackData(db, featureId);
  if (samples && sampleCount(samples) !== pointCount) await deleteTrackData(db, [featureId]);
}
