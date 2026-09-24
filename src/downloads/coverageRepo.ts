import type { SQLiteDatabase } from 'expo-sqlite';

import type { CoverageRow, CoverageStatus } from '../data/types';
import type { LayerId } from './types';

export async function getCoverage(
  db: SQLiteDatabase,
  layer: LayerId,
  cx: number,
  cy: number
): Promise<CoverageRow | null> {
  return db.getFirstAsync<CoverageRow>(
    'SELECT * FROM coverage WHERE layer = ? AND cell_x = ? AND cell_y = ?',
    layer,
    cx,
    cy
  );
}

export async function listCoverage(db: SQLiteDatabase): Promise<CoverageRow[]> {
  return db.getAllAsync<CoverageRow>('SELECT * FROM coverage');
}

export async function upsertCoverage(
  db: SQLiteDatabase,
  row: {
    layer: LayerId;
    cx: number;
    cy: number;
    maxZoom: number;
    status: CoverageStatus;
    bytes: number;
  }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO coverage (layer, cell_x, cell_y, max_zoom, status, bytes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(layer, cell_x, cell_y) DO UPDATE SET
       max_zoom = excluded.max_zoom,
       status = excluded.status,
       bytes = excluded.bytes,
       updated_at = excluded.updated_at`,
    row.layer,
    row.cx,
    row.cy,
    row.maxZoom,
    row.status,
    row.bytes,
    Date.now()
  );
}

export async function deleteCoverage(
  db: SQLiteDatabase,
  layer: LayerId,
  cx: number,
  cy: number
): Promise<void> {
  await db.runAsync(
    'DELETE FROM coverage WHERE layer = ? AND cell_x = ? AND cell_y = ?',
    layer,
    cx,
    cy
  );
}
