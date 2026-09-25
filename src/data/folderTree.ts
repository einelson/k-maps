/**
 * Folder hierarchy helpers over the flat `folders` table (`parent_id` links a folder to its parent, null = top
 * level). Pure — the repositories and screens pass the folder list in — so nesting rules are unit-testable.
 */
import type { Folder } from './types';

/** Guards every walk up the tree, so a corrupted (cyclic) parent chain can't loop forever. */
const MAX_DEPTH = 64;

const byName = (a: Folder, b: Folder) => a.sort - b.sort || a.name.localeCompare(b.name);

/** A folder's direct children, in display order. `parentId` null = the top level. */
export function childFolders(folders: readonly Folder[], parentId: number | null): Folder[] {
  return folders.filter((f) => f.parent_id === parentId).sort(byName);
}

/** A folder and every folder beneath it, at any depth. */
export function folderAndDescendantIds(folders: readonly Folder[], id: number): number[] {
  const ids = [id];
  for (let i = 0; i < ids.length && ids.length <= folders.length; i++) {
    for (const folder of folders) {
      if (folder.parent_id === ids[i] && !ids.includes(folder.id)) ids.push(folder.id);
    }
  }
  return ids;
}

/** `ids` plus everything beneath them — what "show me the Hunting folder" should include. */
export function expandFolderIds(folders: readonly Folder[], ids: readonly number[]): number[] {
  const all = new Set<number>();
  for (const id of ids) for (const d of folderAndDescendantIds(folders, id)) all.add(d);
  return [...all];
}

/** Top level down to the folder itself (empty for an unknown id). */
export function folderPath(folders: readonly Folder[], id: number | null): Folder[] {
  const path: Folder[] = [];
  let current = id == null ? undefined : folders.find((f) => f.id === id);
  while (current && path.length < MAX_DEPTH && !path.includes(current)) {
    path.unshift(current);
    current = current.parent_id == null ? undefined : folders.find((f) => f.id === current!.parent_id);
  }
  return path;
}

/** "Hunting / Elk / Camps" — a folder's full path, for places that show it out of context. */
export function folderPathLabel(folders: readonly Folder[], id: number | null): string {
  return folderPath(folders, id)
    .map((f) => f.name)
    .join(' / ');
}

/** The folder itself and every ancestor above it — stamped on map features so a filter on a parent folder matches its subfolders' pins. */
export function folderAncestryIds(folders: readonly Folder[], id: number | null): number[] {
  return folderPath(folders, id).map((f) => f.id);
}

/** True if moving `id` under `newParentId` would put a folder inside itself (or one of its own subfolders). */
export function wouldCreateCycle(folders: readonly Folder[], id: number, newParentId: number | null): boolean {
  return newParentId !== null && folderAndDescendantIds(folders, id).includes(newParentId);
}

export interface FolderRow {
  folder: Folder;
  /** 0 for a top-level folder. */
  depth: number;
  /** Full path, "Hunting / Elk". */
  label: string;
}

/**
 * Every folder as a depth-first list (each parent directly above its children), for pickers and filter lists.
 * `excludeIds` removes those folders and everything beneath them — the folder being moved can't be a target.
 */
export function flattenFolders(folders: readonly Folder[], excludeIds: readonly number[] = []): FolderRow[] {
  const excluded = new Set(expandFolderIds(folders, excludeIds));
  const rows: FolderRow[] = [];
  const visit = (parentId: number | null, depth: number, prefix: string) => {
    if (depth > MAX_DEPTH) return;
    for (const folder of childFolders(folders, parentId)) {
      if (excluded.has(folder.id)) continue;
      const label = prefix ? `${prefix} / ${folder.name}` : folder.name;
      rows.push({ folder, depth, label });
      visit(folder.id, depth + 1, label);
    }
  };
  visit(null, 0, '');
  return rows;
}
