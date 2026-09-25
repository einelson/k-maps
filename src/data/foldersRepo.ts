import type { SQLiteDatabase } from 'expo-sqlite';

import { wouldCreateCycle } from './folderTree';
import type { Folder } from './types';

export async function listFolders(db: SQLiteDatabase): Promise<Folder[]> {
  return db.getAllAsync<Folder>('SELECT * FROM folders ORDER BY sort, name');
}

export async function createFolder(
  db: SQLiteDatabase,
  input: { name: string; color?: string | null; parentId?: number | null }
): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new Error('Enter a folder name');
  const result = await db.runAsync(
    'INSERT INTO folders (name, color, parent_id) VALUES (?, ?, ?)',
    name,
    input.color ?? null,
    input.parentId ?? null
  );
  return result.lastInsertRowId;
}

export async function renameFolder(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a folder name');
  await db.runAsync('UPDATE folders SET name = ? WHERE id = ?', trimmed, id);
}

/** Moves a folder (with everything in it) under `newParentId`, or to the top level for null. */
export async function moveFolder(db: SQLiteDatabase, id: number, newParentId: number | null): Promise<void> {
  if (wouldCreateCycle(await listFolders(db), id, newParentId)) {
    throw new Error("A folder can't be moved into itself or one of its own subfolders");
  }
  await db.runAsync('UPDATE folders SET parent_id = ? WHERE id = ?', newParentId, id);
}

export async function setFolderVisibility(
  db: SQLiteDatabase,
  id: number,
  visible: boolean
): Promise<void> {
  await db.runAsync('UPDATE folders SET visible = ? WHERE id = ?', visible ? 1 : 0, id);
}

/**
 * Deletes a folder without deleting anything in it: its pins and subfolders move up to the folder's own
 * parent (or the top level), like removing a directory but keeping its contents.
 */
export async function deleteFolder(db: SQLiteDatabase, id: number): Promise<void> {
  const folder = await db.getFirstAsync<Folder>('SELECT * FROM folders WHERE id = ?', id);
  if (!folder) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE features SET folder_id = ?, updated_at = ? WHERE folder_id = ?',
      folder.parent_id,
      Date.now(),
      id
    );
    await db.runAsync('UPDATE folders SET parent_id = ? WHERE parent_id = ?', folder.parent_id, id);
    await db.runAsync('DELETE FROM folders WHERE id = ?', id);
  });
}

/** How many items sit directly in each folder (subfolders not counted), keyed by folder id. */
export async function folderItemCounts(db: SQLiteDatabase): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ folder_id: number; n: number }>(
    'SELECT folder_id, COUNT(*) AS n FROM features WHERE folder_id IS NOT NULL GROUP BY folder_id'
  );
  return new Map(rows.map((r) => [r.folder_id, r.n]));
}
