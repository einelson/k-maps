import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_NAME, migrateDbIfNeeded } from '../data/db';

let dbPromise: Promise<SQLiteDatabase> | null = null;

/**
 * The car screen's own connection. Android Auto can start it with the phone's UI never opened (no
 * SQLiteProvider), and after an app update before the phone UI has migrated the schema, so it migrates too.
 */
export function carDb(): Promise<SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync(DATABASE_NAME)
    .then(async (db) => {
      await migrateDbIfNeeded(db);
      return db;
    })
    .catch((err) => {
      dbPromise = null; // a failed open must not be remembered, or the car screen stays broken until the app restarts
      throw err;
    });
  return dbPromise;
}
