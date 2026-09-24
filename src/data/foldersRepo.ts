import type { SQLiteDatabase } from 'expo-sqlite';

import type { Folder } from './types';

export async function listFolders(db: SQLiteDatabase): Promise<Folder[]> {
  return db.getAllAsync<Folder>('SELECT * FROM folders ORDER BY sort, name');
}

export async function createFolder(
  db: SQLiteDatabase,
  input: { name: string; color?: string | null; parentId?: number | null }
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO folders (name, color, parent_id) VALUES (?, ?, ?)',
    input.name,
    input.color ?? null,
    input.parentId ?? null
  );
  return result.lastInsertRowId;
}

export async function setFolderVisibility(
  db: SQLiteDatabase,
  id: number,
  visible: boolean
): Promise<void> {
  await db.runAsync('UPDATE folders SET visible = ? WHERE id = ?', visible ? 1 : 0, id);
}

export async function deleteFolder(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM folders WHERE id = ?', id);
}
