import type { SQLiteDatabase } from 'expo-sqlite';
import type { Geometry } from 'geojson';

import type { Feature, FeatureType } from './types';
import { computeGeometryMetrics, geometryTypeToFeatureType } from '../features/measure';

export interface FeatureListFilters {
  folderIds?: number[] | null;
  types?: FeatureType[] | null;
  colors?: string[] | null;
  text?: string;
}

function inClause(values: (string | number)[]): string {
  return values.map(() => '?').join(', ');
}

export async function listFeatures(
  db: SQLiteDatabase,
  filters: FeatureListFilters = {}
): Promise<Feature[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.folderIds?.length) {
    clauses.push(`folder_id IN (${inClause(filters.folderIds)})`);
    params.push(...filters.folderIds);
  }
  if (filters.types?.length) {
    clauses.push(`type IN (${inClause(filters.types)})`);
    params.push(...filters.types);
  }
  if (filters.colors?.length) {
    clauses.push(`color IN (${inClause(filters.colors)})`);
    params.push(...filters.colors);
  }

  let sql: string;
  if (filters.text) {
    sql = `
      SELECT features.* FROM features
      JOIN features_fts ON features_fts.rowid = features.id
      WHERE features_fts MATCH ?
    `;
    params.unshift(filters.text);
    if (clauses.length) sql += ` AND ${clauses.join(' AND ')}`;
  } else {
    sql = 'SELECT * FROM features';
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  sql += ' ORDER BY updated_at DESC';

  return db.getAllAsync<Feature>(sql, ...params);
}

export interface CreateFeatureInput {
  folderId?: number | null;
  name?: string | null;
  notes?: string | null;
  color?: string | null;
  icon?: string | null;
  geometry: Geometry;
  source?: Feature['source'];
}

export async function createFeature(
  db: SQLiteDatabase,
  input: CreateFeatureInput
): Promise<number> {
  const type = geometryTypeToFeatureType(input.geometry);
  const metrics = computeGeometryMetrics(input.geometry);
  const now = Date.now();

  const result = await db.runAsync(
    `INSERT INTO features
      (folder_id, type, name, notes, color, icon, geometry,
       min_lon, min_lat, max_lon, max_lat, length_m, area_m2,
       source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.folderId ?? null,
    type,
    input.name ?? null,
    input.notes ?? null,
    input.color ?? null,
    input.icon ?? null,
    JSON.stringify(input.geometry),
    metrics.minLon,
    metrics.minLat,
    metrics.maxLon,
    metrics.maxLat,
    metrics.lengthM,
    metrics.areaM2,
    input.source ?? 'manual',
    now,
    now
  );

  await db.runAsync(
    'INSERT INTO features_fts (rowid, name, notes) VALUES (?, ?, ?)',
    result.lastInsertRowId,
    input.name ?? '',
    input.notes ?? ''
  );

  return result.lastInsertRowId;
}

export async function deleteFeature(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM features WHERE id = ?', id);
  await db.runAsync('DELETE FROM features_fts WHERE rowid = ?', id);
}
