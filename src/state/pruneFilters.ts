import type { Filters } from './types';
import { useFiltersStore } from './useFiltersStore';
import { useSavedViewsStore } from './useSavedViewsStore';

export interface RemovedIds {
  tagId?: number;
  folderId?: number;
}

/**
 * `filters` without a deleted tag or folder. An emptied list goes back to `null` ("no restriction"): a filter
 * on a folder that no longer exists should stop filtering, not hide everything.
 */
export function pruneFilters(filters: Filters, removed: RemovedIds): Filters {
  const drop = (ids: number[] | null, id: number | undefined) => {
    if (ids === null || id === undefined || !ids.includes(id)) return ids;
    const rest = ids.filter((existing) => existing !== id);
    return rest.length > 0 ? rest : null;
  };
  const tagIds = drop(filters.tagIds, removed.tagId);
  const folderIds = drop(filters.folderIds, removed.folderId);
  return tagIds === filters.tagIds && folderIds === filters.folderIds ? filters : { ...filters, tagIds, folderIds };
}

/**
 * Forgets a deleted tag/folder everywhere a filter can remember one: the active filter, saved filter presets
 * and saved views. Otherwise applying an old view would filter on an id that no longer exists.
 */
export function pruneDeletedFromFilters(removed: RemovedIds): void {
  useFiltersStore.setState((s) => ({
    filters: pruneFilters(s.filters, removed),
    presets: s.presets.map((p) => ({ ...p, filters: pruneFilters(p.filters, removed) })),
  }));
  useSavedViewsStore.setState((s) => ({
    views: s.views.map((v) => ({
      ...v,
      snapshot: { ...v.snapshot, filters: pruneFilters(v.snapshot.filters, removed) },
    })),
  }));
}
