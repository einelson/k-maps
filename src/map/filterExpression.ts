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
    clauses.push(['in', ['get', 'folder_id'], ['literal', filters.folderIds]]);
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
