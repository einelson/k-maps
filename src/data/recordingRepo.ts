import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * The track being recorded right now. The background location task appends fixes here (it can be running
 * while the screen is locked or the app has been closed), and the app reads them back to draw the live line
 * and to save the track. One recording at a time: `recording_session` holds a single row.
 */

/** A fix as the recorder hands it over. Accuracy filtering happens before this (see trackConfig). */
export interface NewFix {
  /** Epoch ms. */
  time: number;
  lon: number;
  lat: number;
  altitude: number | null;
}

export interface StoredFix extends NewFix {
  id: number;
}

export async function startRecordingSession(db: SQLiteDatabase, startedAt: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM recording_fixes');
    await db.runAsync('INSERT OR REPLACE INTO recording_session (id, started_at) VALUES (1, ?)', startedAt);
  });
}

export async function getRecordingSession(db: SQLiteDatabase): Promise<{ startedAt: number } | null> {
  const row = await db.getFirstAsync<{ started_at: number }>('SELECT started_at FROM recording_session WHERE id = 1');
  return row ? { startedAt: row.started_at } : null;
}

/**
 * Appends fixes to the active recording, skipping any that aren't newer than the last one stored (the OS
 * can redeliver a batch). Returns how many were stored, or null when there is no recording — the caller
 * (the background task) treats that as "nobody is listening any more" and stops itself.
 */
export async function appendRecordingFixes(db: SQLiteDatabase, fixes: NewFix[]): Promise<number | null> {
  if (!(await getRecordingSession(db))) return null;
  if (fixes.length === 0) return 0;

  let stored = 0;
  await db.withTransactionAsync(async () => {
    const last = await db.getFirstAsync<{ time: number | null }>('SELECT MAX(time) AS time FROM recording_fixes');
    let lastTime = last?.time ?? -Infinity;
    for (const fix of [...fixes].sort((a, b) => a.time - b.time)) {
      if (fix.time <= lastTime) continue;
      await db.runAsync(
        'INSERT INTO recording_fixes (time, lon, lat, altitude) VALUES (?, ?, ?, ?)',
        fix.time,
        fix.lon,
        fix.lat,
        fix.altitude
      );
      lastTime = fix.time;
      stored++;
    }
  });
  return stored;
}

/** Fixes with an id above `afterId`, oldest first. Pass the last id you already have to get only the new ones. */
export async function loadRecordingFixes(db: SQLiteDatabase, afterId = 0): Promise<StoredFix[]> {
  return db.getAllAsync<StoredFix>(
    'SELECT id, time, lon, lat, altitude FROM recording_fixes WHERE id > ? ORDER BY id',
    afterId
  );
}

/** The deletes alone, for a caller that already has a transaction open (SQLite can't nest them). */
export async function clearRecordingRows(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM recording_fixes');
  await db.runAsync('DELETE FROM recording_session');
}

export async function clearRecording(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(() => clearRecordingRows(db));
}
