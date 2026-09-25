import type { SQLiteDatabase } from 'expo-sqlite';
import type { FeatureCollection, Geometry } from 'geojson';

import type { Feature, FeatureType } from './types';
import { computeGeometryMetrics, geometryTypeToFeatureType } from '../features/measure';
import { DEFAULT_PIN_COLOR, resolvePinStyle, type PinStyleId } from '../features/pinStyles';
import { expandFolderIds, folderAncestryIds } from './folderTree';
import { listFolders } from './foldersRepo';
import { deletePhotosForFeatures } from './photosRepo';
import { addTagToFeature, getOrCreateTag } from './tagsRepo';
import { deleteTrackData, dropTrackDataIfMisaligned } from './trackDataRepo';

export interface FeatureListFilters {
  /** Matches these folders and everything nested inside them. */
  folderIds?: number[] | null;
  /** Only what sits directly in this folder (`null` = not in any folder). Left out = don't filter by folder this way. */
  inFolder?: number | null;
  types?: FeatureType[] | null;
  colors?: string[] | null;
  /** Matches ANY of the given tags — the map's filter expression (src/map/filterExpression.ts) also supports 'all' mode; this SQL path only needs 'any' so far. */
  tagIds?: number[] | null;
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
    const folderIds = expandFolderIds(await listFolders(db), filters.folderIds);
    clauses.push(`folder_id IN (${inClause(folderIds)})`);
    params.push(...folderIds);
  }
  if (filters.inFolder === null) {
    clauses.push('folder_id IS NULL');
  } else if (filters.inFolder !== undefined) {
    clauses.push('folder_id = ?');
    params.push(filters.inFolder);
  }
  if (filters.types?.length) {
    clauses.push(`type IN (${inClause(filters.types)})`);
    params.push(...filters.types);
  }
  if (filters.colors?.length) {
    clauses.push(`color IN (${inClause(filters.colors)})`);
    params.push(...filters.colors);
  }
  if (filters.tagIds?.length) {
    clauses.push(
      `id IN (SELECT feature_id FROM feature_tags WHERE tag_id IN (${inClause(filters.tagIds)}))`
    );
    params.push(...filters.tagIds);
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

/** `createFeature` plus its tags, creating any tag names that don't exist yet. */
export async function createFeatureWithTags(
  db: SQLiteDatabase,
  input: CreateFeatureInput,
  tagNames: string[]
): Promise<number> {
  const id = await createFeature(db, input);
  for (const name of tagNames) {
    await addTagToFeature(db, id, await getOrCreateTag(db, name));
  }
  return id;
}

/**
 * Replaces a feature's geometry and recomputes the stored bbox/length/area,
 * exactly as `createFeature` does. `type` is deliberately left unchanged.
 */
export async function updateFeatureGeometry(
  db: SQLiteDatabase,
  id: number,
  geometry: Geometry
): Promise<void> {
  const metrics = computeGeometryMetrics(geometry);
  await db.runAsync(
    `UPDATE features
        SET geometry = ?, min_lon = ?, min_lat = ?, max_lon = ?, max_lat = ?,
            length_m = ?, area_m2 = ?, updated_at = ?
      WHERE id = ?`,
    JSON.stringify(geometry),
    metrics.minLon,
    metrics.minLat,
    metrics.maxLon,
    metrics.maxLat,
    metrics.lengthM,
    metrics.areaM2,
    Date.now(),
    id
  );
  // A recorded track's per-point time/altitude only describes the vertices it had when recorded.
  if (geometry.type === 'LineString') await dropTrackDataIfMisaligned(db, id, geometry.coordinates.length);
}

/**
 * `features_fts` is an external-content FTS5 table (`content='features'`), so
 * SQLite never keeps it in step with the features table by itself — and a plain
 * `DELETE FROM features_fts` after the content row is gone can't recover the
 * tokens to remove. 'rebuild' re-reads the content table, so it's always
 * correct: call it after anything that renames or deletes a feature.
 */
export async function rebuildSearchIndex(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("INSERT INTO features_fts(features_fts) VALUES('rebuild')");
}

export async function deleteFeature(db: SQLiteDatabase, id: number): Promise<void> {
  // Photos and tag links first — foreign keys may be off, so don't rely on ON DELETE CASCADE.
  await deletePhotosForFeatures(db, [id]);
  await deleteTrackData(db, [id]);
  await db.runAsync('DELETE FROM feature_tags WHERE feature_id = ?', id);
  await db.runAsync('DELETE FROM features WHERE id = ?', id);
  await rebuildSearchIndex(db);
}

export async function bulkSetFolder(
  db: SQLiteDatabase,
  ids: number[],
  folderId: number | null
): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(
    `UPDATE features SET folder_id = ?, updated_at = ? WHERE id IN (${inClause(ids)})`,
    folderId,
    Date.now(),
    ...ids
  );
}

export async function bulkSetColor(db: SQLiteDatabase, ids: number[], color: string): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(
    `UPDATE features SET color = ?, updated_at = ? WHERE id IN (${inClause(ids)})`,
    color,
    Date.now(),
    ...ids
  );
}

export async function bulkDelete(db: SQLiteDatabase, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await deletePhotosForFeatures(db, ids);
  await deleteTrackData(db, ids);
  await db.runAsync(`DELETE FROM feature_tags WHERE feature_id IN (${inClause(ids)})`, ...ids);
  await db.runAsync(`DELETE FROM features WHERE id IN (${inClause(ids)})`, ...ids);
  await rebuildSearchIndex(db);
}

/** Properties stamped on each saved feature for the map (filter expressions + tap-to-open read these). */
export interface MapFeatureProperties {
  featureId: number;
  folder_id: number | null;
  /** The feature's folder and every folder above it, so filtering on a parent folder also matches what's nested inside. Empty if unfiled. */
  folder_ids: number[];
  type: FeatureType;
  name: string | null;
  /** Raw color — filtered on as-is, so an uncolored feature never matches a color filter. */
  color: string | null;
  /** Color to actually paint (falls back to a default per source). */
  displayColor: string;
  /** Glyph drawn in the marker for a point (unknown / unset `icon` resolves to the plain pin). */
  pinStyle: PinStyleId;
  tag_ids: number[];
}

export const DEFAULT_FEATURE_COLOR = '#3b82f6';
export const DEFAULT_TRACK_COLOR = '#c0392b';

/** What an uncolored feature is painted: tracks red-brown, pins red (never the blue location dot), lines/areas blue. */
function defaultDisplayColor(row: Pick<Feature, 'type' | 'source'>): string {
  if (row.source === 'track') return DEFAULT_TRACK_COLOR;
  return row.type === 'point' ? DEFAULT_PIN_COLOR : DEFAULT_FEATURE_COLOR;
}

export const EMPTY_MAP_FEATURES: FeatureCollection<Geometry, MapFeatureProperties> = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Every visible saved feature as one GeoJSON collection (§7.2: "load all
 * items into one GeoJSON source ... then set the layer filter, so toggling
 * never round-trips to SQLite"). Features in a hidden folder — or in any
 * folder inside a hidden one — are left out.
 * Rows whose stored geometry doesn't parse are skipped rather than failing
 * the whole map.
 */
export async function loadMapFeatures(
  db: SQLiteDatabase
): Promise<FeatureCollection<Geometry, MapFeatureProperties>> {
  const [rows, tagRows, folders] = await Promise.all([
    db.getAllAsync<
      Pick<Feature, 'id' | 'folder_id' | 'type' | 'name' | 'color' | 'icon' | 'source' | 'geometry'>
    >(`SELECT f.id, f.folder_id, f.type, f.name, f.color, f.icon, f.source, f.geometry FROM features f`),
    db.getAllAsync<{ feature_id: number; tag_id: number }>(
      'SELECT feature_id, tag_id FROM feature_tags'
    ),
    listFolders(db),
  ]);
  const hiddenFolders = new Set(
    expandFolderIds(
      folders,
      folders.filter((folder) => folder.visible === 0).map((folder) => folder.id)
    )
  );

  const tagsByFeature = new Map<number, number[]>();
  for (const { feature_id, tag_id } of tagRows) {
    const list = tagsByFeature.get(feature_id);
    if (list) list.push(tag_id);
    else tagsByFeature.set(feature_id, [tag_id]);
  }

  const features: FeatureCollection<Geometry, MapFeatureProperties>['features'] = [];
  for (const row of rows) {
    if (row.folder_id != null && hiddenFolders.has(row.folder_id)) continue;
    let geometry: Geometry;
    try {
      geometry = JSON.parse(row.geometry) as Geometry;
    } catch {
      continue;
    }
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        featureId: row.id,
        folder_id: row.folder_id,
        folder_ids: folderAncestryIds(folders, row.folder_id),
        type: row.type,
        name: row.name,
        color: row.color,
        displayColor: row.color ?? defaultDisplayColor(row),
        pinStyle: resolvePinStyle(row.icon),
        tag_ids: tagsByFeature.get(row.id) ?? [],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
