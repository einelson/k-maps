import type { SQLiteDatabase } from 'expo-sqlite';

import type { Tag } from './types';

export async function listTags(db: SQLiteDatabase): Promise<Tag[]> {
  return db.getAllAsync<Tag>('SELECT * FROM tags ORDER BY name COLLATE NOCASE');
}

export interface TagWithCount extends Tag {
  /** Items carrying this tag. */
  count: number;
}

export async function listTagsWithCounts(db: SQLiteDatabase): Promise<TagWithCount[]> {
  return db.getAllAsync<TagWithCount>(
    `SELECT tags.*, COUNT(feature_tags.feature_id) AS count
       FROM tags
       LEFT JOIN feature_tags ON feature_tags.tag_id = tags.id
      GROUP BY tags.id
      ORDER BY tags.name COLLATE NOCASE`
  );
}

export async function listTagsForFeature(db: SQLiteDatabase, featureId: number): Promise<Tag[]> {
  return db.getAllAsync<Tag>(
    `SELECT tags.* FROM tags
     JOIN feature_tags ON feature_tags.tag_id = tags.id
     WHERE feature_tags.feature_id = ?
     ORDER BY tags.name COLLATE NOCASE`,
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

/** A tag name as stored: trimmed, and never empty. */
function cleanTagName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a tag name');
  return trimmed;
}

/** Another tag already using this name, ignoring case — "Elk" and "elk" would be the same tag to a person. */
async function findNameClash(db: SQLiteDatabase, name: string, exceptId: number | null): Promise<Tag | null> {
  return db.getFirstAsync<Tag>(
    'SELECT * FROM tags WHERE name = ? COLLATE NOCASE AND id != ?',
    name,
    exceptId ?? -1
  );
}

/** Adds a tag with no items yet. Throws if the name is empty or already taken. */
export async function createTag(db: SQLiteDatabase, name: string, color?: string | null): Promise<number> {
  const cleaned = cleanTagName(name);
  if (await findNameClash(db, cleaned, null)) throw new Error(`A tag named "${cleaned}" already exists`);
  const result = await db.runAsync('INSERT INTO tags (name, color) VALUES (?, ?)', cleaned, color ?? null);
  return result.lastInsertRowId;
}

/** Renames a tag; every item keeps it. Throws if the name is empty or belongs to another tag. */
export async function renameTag(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  const cleaned = cleanTagName(name);
  if (await findNameClash(db, cleaned, id)) throw new Error(`A tag named "${cleaned}" already exists`);
  await db.runAsync('UPDATE tags SET name = ? WHERE id = ?', cleaned, id);
}

/** Deletes a tag and takes it off every item (the items themselves are untouched). Returns how many items had it. */
export async function deleteTag(db: SQLiteDatabase, id: number): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM feature_tags WHERE tag_id = ?', id);
  await db.withTransactionAsync(async () => {
    // Foreign keys may be off, so don't rely on ON DELETE CASCADE.
    await db.runAsync('DELETE FROM feature_tags WHERE tag_id = ?', id);
    await db.runAsync('DELETE FROM tags WHERE id = ?', id);
  });
  return row?.n ?? 0;
}
