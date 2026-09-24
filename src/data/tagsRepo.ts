import type { SQLiteDatabase } from 'expo-sqlite';

import type { Tag } from './types';

export async function listTags(db: SQLiteDatabase): Promise<Tag[]> {
  return db.getAllAsync<Tag>('SELECT * FROM tags ORDER BY name');
}

export async function listTagsForFeature(db: SQLiteDatabase, featureId: number): Promise<Tag[]> {
  return db.getAllAsync<Tag>(
    `SELECT tags.* FROM tags
     JOIN feature_tags ON feature_tags.tag_id = tags.id
     WHERE feature_tags.feature_id = ?
     ORDER BY tags.name`,
    featureId
  );
}

export async function getOrCreateTag(
  db: SQLiteDatabase,
  name: string,
  color?: string | null
): Promise<number> {
  const existing = await db.getFirstAsync<Tag>('SELECT * FROM tags WHERE name = ?', name);
  if (existing) return existing.id;
  const result = await db.runAsync('INSERT INTO tags (name, color) VALUES (?, ?)', name, color ?? null);
  return result.lastInsertRowId;
}

export async function addTagToFeature(
  db: SQLiteDatabase,
  featureId: number,
  tagId: number
): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO feature_tags (feature_id, tag_id) VALUES (?, ?)',
    featureId,
    tagId
  );
}

export async function removeTagFromFeature(
  db: SQLiteDatabase,
  featureId: number,
  tagId: number
): Promise<void> {
  await db.runAsync(
    'DELETE FROM feature_tags WHERE feature_id = ? AND tag_id = ?',
    featureId,
    tagId
  );
}
