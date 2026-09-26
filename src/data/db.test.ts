import type { SQLiteDatabase } from 'expo-sqlite';

import { createTestDb } from '../testing/sqliteTestDb';
import { migrateDbIfNeeded } from './db';
import { MIGRATE_V2_SQL, SCHEMA_VERSION } from './schema';

const BUSY_TIMEOUT = 'PRAGMA busy_timeout = 5000';

const tableExists = async (db: SQLiteDatabase, name: string) =>
  (await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name)) != null;

const userVersion = async (db: SQLiteDatabase) =>
  (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version;

/** A recording fake for the two statements migrateDbIfNeeded issues, so the version logic is testable alone. */
function fakeAt(version: number) {
  const executed: string[] = [];
  const db = {
    getFirstAsync: async () => ({ user_version: version }),
    // Every table already has its transport column, so the guarded ALTERs are skipped.
    getAllAsync: async () => [{ name: 'transport' }],
    execAsync: async (sql: string) => void executed.push(sql),
  } as unknown as SQLiteDatabase;
  return { db, executed };
}

describe('migrateDbIfNeeded', () => {
  it('only sets the busy timeout once the schema is current', async () => {
    const { db, executed } = fakeAt(SCHEMA_VERSION);
    await migrateDbIfNeeded(db);
    expect(executed).toEqual([BUSY_TIMEOUT]);
  });

  it('creates the schema and stamps the version on a brand-new database', async () => {
    const { db, executed } = fakeAt(0);
    await migrateDbIfNeeded(db);
    expect(executed).toHaveLength(3);
    expect(executed[0]).toBe(BUSY_TIMEOUT);
    expect(executed[1]).toContain('CREATE TABLE IF NOT EXISTS features');
    expect(executed[2]).toBe(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });

  it('rebuilds the search index for a v1 database (the v2 migration) before stamping', async () => {
    const { db, executed } = fakeAt(1);
    await migrateDbIfNeeded(db);
    expect(executed).toEqual([BUSY_TIMEOUT, expect.stringContaining('CREATE TABLE'), MIGRATE_V2_SQL, `PRAGMA user_version = ${SCHEMA_VERSION}`]);
  });

  it('brings a v2 database up to date without re-running the v2 migration', async () => {
    const { db, executed } = fakeAt(2);
    await migrateDbIfNeeded(db);
    expect(executed).toEqual([BUSY_TIMEOUT, expect.stringContaining('CREATE TABLE'), `PRAGMA user_version = ${SCHEMA_VERSION}`]);
  });

  it('adds the track and recording tables to a real v2 database, keeping its data', async () => {
    const db = createTestDb();
    // What a v2 install looks like: none of the later tables.
    await db.execAsync('DROP TABLE track_data; DROP TABLE recording_session; DROP TABLE recording_fixes; PRAGMA user_version = 2;');
    await db.runAsync("INSERT INTO features (type, name, geometry) VALUES ('point', 'kept', '{}')");
    expect(await tableExists(db, 'track_data')).toBe(false);
    expect(await tableExists(db, 'recording_fixes')).toBe(false);

    await migrateDbIfNeeded(db);

    expect(await tableExists(db, 'track_data')).toBe(true);
    expect(await tableExists(db, 'recording_session')).toBe(true);
    expect(await tableExists(db, 'recording_fixes')).toBe(true);
    expect(await userVersion(db)).toBe(SCHEMA_VERSION);
    expect((await db.getAllAsync<{ name: string }>('SELECT name FROM features')).map((r) => r.name)).toEqual(['kept']);
  });

  it('adds just the recording tables to a v3 database', async () => {
    const db = createTestDb();
    await db.execAsync('DROP TABLE recording_session; DROP TABLE recording_fixes; PRAGMA user_version = 3;');
    await migrateDbIfNeeded(db);
    expect(await tableExists(db, 'recording_session')).toBe(true);
    expect(await userVersion(db)).toBe(SCHEMA_VERSION);
  });

  it('adds the transport columns to a real v4 database, keeping its rows', async () => {
    const db = createTestDb();
    // What a v4 install looks like: the tables exist without a transport column.
    await db.execAsync('ALTER TABLE features DROP COLUMN transport; ALTER TABLE recording_session DROP COLUMN transport; PRAGMA user_version = 4;');
    await db.runAsync("INSERT INTO features (type, name, geometry) VALUES ('line', 'old track', '{}')");
    await db.runAsync('INSERT INTO recording_session (id, started_at) VALUES (1, 5000)');

    await migrateDbIfNeeded(db);

    expect(await userVersion(db)).toBe(SCHEMA_VERSION);
    expect(await db.getFirstAsync('SELECT name, transport FROM features')).toEqual({ name: 'old track', transport: null });
    expect(await db.getFirstAsync('SELECT started_at, transport FROM recording_session')).toEqual({ started_at: 5000, transport: null });
  });

  it('does not add a column twice when an older database already got it from CREATE TABLE IF NOT EXISTS', async () => {
    const db = createTestDb(); // recording_session is created with the column, as it is for a v2/v3 upgrade
    await db.execAsync('ALTER TABLE features DROP COLUMN transport; PRAGMA user_version = 2;');
    await expect(migrateDbIfNeeded(db)).resolves.toBeUndefined();
    expect(await db.getFirstAsync('SELECT transport FROM features')).toBeNull(); // column exists, no rows
  });

  it('is safe to run twice', async () => {
    const db = createTestDb();
    await db.execAsync('PRAGMA user_version = 0;');
    await migrateDbIfNeeded(db);
    await db.execAsync('PRAGMA user_version = 2;'); // e.g. an interrupted upgrade
    await expect(migrateDbIfNeeded(db)).resolves.toBeUndefined();
  });
});
