/**
 * Schema from TrailPin/K-Maps spec §7.1. Kept as one migration for now —
 * split into numbered migrations once the schema needs to change on devices
 * that already have data.
 */
export const SCHEMA_VERSION = 4;

/**
 * v3 added `track_data` (time and altitude per recorded point) and v4 added `recording_session` /
 * `recording_fixes` (the in-progress recording, written by the background location task). Their
 * `CREATE TABLE IF NOT EXISTS` statements in CREATE_SCHEMA_SQL are the whole migrations, so there are no
 * MIGRATE_V3_SQL / MIGRATE_V4_SQL.
 */

/**
 * v2: `features_fts` (external-content) was only ever written on create, so
 * renamed/deleted features left stale search entries. Rebuild it from
 * `features` once for databases created before the fix.
 */
export const MIGRATE_V2_SQL = "INSERT INTO features_fts(features_fts) VALUES('rebuild');";

export const CREATE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  parent_id INTEGER REFERENCES folders(id),
  visible INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER REFERENCES folders(id),
  type TEXT NOT NULL CHECK (type IN ('point','line','polygon')),
  name TEXT,
  notes TEXT,
  color TEXT,
  icon TEXT,
  geometry TEXT NOT NULL,
  min_lon REAL, min_lat REAL, max_lon REAL, max_lat REAL,
  length_m REAL, area_m2 REAL, elevation_m REAL,
  source TEXT DEFAULT 'manual',
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT
);

CREATE TABLE IF NOT EXISTS feature_tags (
  feature_id INTEGER REFERENCES features(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (feature_id, tag_id)
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER REFERENCES features(id) ON DELETE CASCADE,
  path TEXT
);

CREATE TABLE IF NOT EXISTS track_data (
  feature_id INTEGER PRIMARY KEY REFERENCES features(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

-- The recording in progress: at most one row, and the fixes the background task has appended so far.
-- Kept in SQLite (not memory) so a recording survives the app being closed or killed mid-track.
CREATE TABLE IF NOT EXISTS recording_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recording_fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER NOT NULL,
  lon REAL NOT NULL,
  lat REAL NOT NULL,
  altitude REAL
);

CREATE TABLE IF NOT EXISTS coverage (
  layer TEXT, cell_x INTEGER, cell_y INTEGER,
  max_zoom INTEGER, status TEXT, bytes INTEGER, updated_at INTEGER,
  PRIMARY KEY (layer, cell_x, cell_y)
);

CREATE VIRTUAL TABLE IF NOT EXISTS features_fts USING fts5(
  name, notes, content='features', content_rowid='id'
);

CREATE INDEX IF NOT EXISTS idx_features_folder ON features(folder_id);
CREATE INDEX IF NOT EXISTS idx_features_type ON features(type);
CREATE INDEX IF NOT EXISTS idx_features_bbox ON features(min_lon, min_lat, max_lon, max_lat);
`;
