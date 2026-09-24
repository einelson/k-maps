import * as SQLite from 'expo-sqlite';
import { Directory, Paths } from 'expo-file-system';

import type { LayerId } from './types';
import { tmsY } from './cells';

/**
 * §4.5 Option A: one append-only MBTiles file per layer, so adjacent
 * downloaded cells render as a single seamless source in MapLibre. WAL mode
 * so the map can keep reading the file while the downloader writes to it —
 * this is the assumption §12.1 flags as needing a spike to confirm on-device.
 */
export const MAPS_DIRECTORY = new Directory(Paths.document, 'maps');

export function mbtilesFileName(layer: LayerId): string {
  return `${layer}.mbtiles`;
}

function ensureMapsDirectory(): void {
  if (!MAPS_DIRECTORY.exists) {
    MAPS_DIRECTORY.create({ intermediates: true, idempotent: true });
  }
}

export async function openMBTiles(layer: LayerId): Promise<SQLite.SQLiteDatabase> {
  ensureMapsDirectory();

  // §12.4: expo-sqlite's `directory` param and expo-file-system's `Directory.uri`
  // (a `file://` URI) haven't been cross-checked against each other on-device yet.
  // If the native module wants a bare path instead, strip the `file://` prefix here.
  const db = await SQLite.openDatabaseAsync(
    mbtilesFileName(layer),
    { useNewConnection: false },
    MAPS_DIRECTORY.uri
  );

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS metadata_name_idx ON metadata (name);
    CREATE TABLE IF NOT EXISTS tiles (
      zoom_level INTEGER,
      tile_column INTEGER,
      tile_row INTEGER,
      tile_data BLOB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tiles_zxy_idx ON tiles (zoom_level, tile_column, tile_row);
  `);

  return db;
}

export async function setMetadata(
  db: SQLite.SQLiteDatabase,
  values: Record<string, string>
): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    await db.runAsync(
      'INSERT INTO metadata (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
      name,
      value
    );
  }
}

export async function hasTile(
  db: SQLite.SQLiteDatabase,
  z: number,
  x: number,
  y: number
): Promise<boolean> {
  const row = await db.getFirstAsync<{ found: number }>(
    'SELECT 1 AS found FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
    z,
    x,
    tmsY(z, y)
  );
  return row != null;
}

/** Caller is expected to batch these inside `db.withExclusiveTransactionAsync` (§4.4: ~200 tiles per transaction). */
export async function putTile(
  db: SQLite.SQLiteDatabase,
  z: number,
  x: number,
  y: number,
  data: Uint8Array
): Promise<void> {
  await db.runAsync(
    `INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(zoom_level, tile_column, tile_row) DO UPDATE SET tile_data = excluded.tile_data`,
    z,
    x,
    tmsY(z, y),
    data
  );
}

export async function mbtilesByteSize(layer: LayerId): Promise<number> {
  const file = MAPS_DIRECTORY.list().find((entry) => entry.name === mbtilesFileName(layer));
  if (!file || file instanceof Directory) return 0;
  return file.size ?? 0;
}
