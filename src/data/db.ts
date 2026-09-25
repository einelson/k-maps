import type { SQLiteDatabase } from 'expo-sqlite';

import { CREATE_SCHEMA_SQL, MIGRATE_V2_SQL, SCHEMA_VERSION } from './schema';

export const DATABASE_NAME = 'kmaps.db';

/**
 * Passed as `onInit` to <SQLiteProvider>. Uses the PRAGMA user_version
 * pattern so re-launching the app is a no-op once the schema is current.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  // The background location task writes to this file from its own connection while the app is open; with
  // WAL that never blocks reads, but two writers at once would otherwise fail straight away with "locked".
  await db.execAsync('PRAGMA busy_timeout = 5000');

  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }

  await db.execAsync(CREATE_SCHEMA_SQL);
  if (currentVersion >= 1 && currentVersion < 2) await db.execAsync(MIGRATE_V2_SQL);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
