import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';

import type { Filters } from '../state/types';

/**
 * Builds the MapLibre filter expression for the "your data" GeoJSON source
 * (§7.2). Toggling folders/types/colors/tags updates this expression only —
 * it never round-trips to SQLite, so map visibility stays instant. Lists
 * and search go through SQL instead (see src/data/featuresRepo.ts).
 *
 * `FilterSpecification`'s TS type is a deep discriminated union keyed on the
 * literal operator string, which TS can't reliably infer for expressions
 * assembled piecemeal like this — built as plain arrays and cast once at the
 * boundary instead of fighting that inference clause by clause.
 */
export function buildFeatureFilter(filters: Filters): FilterSpecification {
  const clauses: unknown[] = [];

  if (filters.folderIds) {
    // A feature carries its folder and all its ancestors in `folder_ids`, so picking a parent folder
    // also shows what's nested inside it. An empty list ('any' of nothing) matches nothing.
    clauses.push(['any', ...filters.folderIds.map((id) => ['in', id, ['get', 'folder_ids']])]);
  }
  if (filters.types) {
    clauses.push(['in', ['get', 'type'], ['literal', filters.types]]);
  }
  if (filters.colors) {
    clauses.push(['in', ['get', 'color'], ['literal', filters.colors]]);
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    const tagClauses = filters.tagIds.map((id) => ['in', id, ['get', 'tag_ids']]);
    clauses.push(filters.tagMode === 'all' ? ['all', ...tagClauses] : ['any', ...tagClauses]);
  }

  return ['all', ...clauses] as unknown as FilterSpecification;
}

/** The feature properties the §7.2 filters look at (a subset of MapFeatureProperties). */
export interface FilterableProperties {
  folder_ids: number[];
  type: string;
  color: string | null;
  tag_ids: number[];
}

/**
 * JS twin of `buildFeatureFilter`, with identical semantics, for data that
 * has to be filtered BEFORE it reaches MapLibre. Clustering is the case: a
 * cluster is computed from the source's raw points, so a layer filter can't
 * remove a hidden point from a cluster's count — the points source has to be
 * fed only the visible ones. Still no SQLite round trip; this is an in-memory
 * pass over the already-loaded features.
 */
export function matchesFilters(properties: FilterableProperties, filters: Filters): boolean {
  if (filters.folderIds) {
    if (!filters.folderIds.some((id) => properties.folder_ids.includes(id))) return false;
  }
  if (filters.types && !filters.types.includes(properties.type as never)) return false;
  if (filters.colors) {
    if (properties.color == null || !filters.colors.includes(properties.color)) return false;
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    const has = (id: number) => properties.tag_ids.includes(id);
    if (filters.tagMode === 'all' ? !filters.tagIds.every(has) : !filters.tagIds.some(has)) {
      return false;
    }
  }
  return true;
}
