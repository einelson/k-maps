import * as Location from 'expo-location';
import type { LocationObject } from 'expo-location';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';

import { DATABASE_NAME } from '../data/db';
import { appendRecordingFixes, type NewFix } from '../data/recordingRepo';
import { MAX_ACCURACY_M, TRACK_TASK_NAME } from './trackConfig';

/**
 * The background half of track recording. Android runs this for every location update from the recorder's
 * foreground service, including while the screen is locked and after the app has been swiped away, so it
 * can't touch React state: it only appends to SQLite, and the app reads the fixes back when it's open.
 * `defineTask` must run at module scope, so index.ts imports this file before the app mounts.
 */

export function fixesFromLocations(locations: LocationObject[]): NewFix[] {
  const fixes: NewFix[] = [];
  for (const { coords, timestamp } of locations) {
    if (coords.accuracy != null && coords.accuracy > MAX_ACCURACY_M) continue;
    fixes.push({ time: timestamp, lon: coords.longitude, lat: coords.latitude, altitude: coords.altitude ?? null });
  }
  return fixes;
}

/**
 * Stores one batch of updates. When there is no recording to add them to (it was saved or deleted while
 * the service was still running), the task shuts itself down rather than keep the GPS and notification alive.
 */
export async function recordLocations(db: SQLiteDatabase, locations: LocationObject[]): Promise<void> {
  const stored = await appendRecordingFixes(db, fixesFromLocations(locations));
  if (stored === null && (await Location.hasStartedLocationUpdatesAsync(TRACK_TASK_NAME))) {
    await Location.stopLocationUpdatesAsync(TRACK_TASK_NAME);
  }
}

let dbPromise: Promise<SQLiteDatabase> | null = null;

/** The task's own connection: it may run with no React tree, so it can't use the app's SQLiteProvider. */
function taskDb(): Promise<SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    // The app may be writing at the same moment (WAL allows it); wait briefly instead of failing the batch.
    await db.execAsync('PRAGMA busy_timeout = 5000');
    return db;
  });
  return dbPromise;
}

export async function handleTrackTask({ data, error }: { data?: { locations?: LocationObject[] }; error?: unknown }): Promise<void> {
  if (error || !data?.locations) {
    if (error) console.warn('Track recording task error', error);
    return;
  }
  try {
    await recordLocations(await taskDb(), data.locations);
  } catch (err) {
    console.warn('Could not store recorded location', err);
    dbPromise = null; // reopen next time in case the connection is what broke
  }
}

TaskManager.defineTask<{ locations?: LocationObject[] }>(TRACK_TASK_NAME, handleTrackTask);
