import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

import { EMPTY_FILTERS, type Filters } from '../state/types';
import { buildFeatureFilter, matchesFilters, type FilterableProperties } from './filterExpression';

/**
 * `matchesFilters` feeds the clustered point source (which can't be filtered by a layer
 * expression), while `buildFeatureFilter` drives every other layer. They must agree, so this
 * evaluates the real MapLibre expression against the JS matcher over a grid of cases.
 */
function expressionMatches(filters: Filters, properties: FilterableProperties): boolean {
  const evaluator = featureFilter(buildFeatureFilter(filters) as never, 'layers[0].filter');
  return evaluator.filter({ zoom: 10 } as never, { type: 1, properties } as never);
}

const FEATURES: FilterableProperties[] = [
  { folder_id: 1, type: 'point', color: '#ff0000', tag_ids: [1, 2] },
  { folder_id: 2, type: 'line', color: '#00ff00', tag_ids: [2] },
  { folder_id: null, type: 'polygon', color: null, tag_ids: [] },
  { folder_id: 1, type: 'polygon', color: '#ff0000', tag_ids: [3] },
];

const FILTERS: Record<string, Filters> = {
  none: EMPTY_FILTERS,
  folder: { ...EMPTY_FILTERS, folderIds: [1] },
  folders: { ...EMPTY_FILTERS, folderIds: [1, 2] },
  emptyFolders: { ...EMPTY_FILTERS, folderIds: [] },
  type: { ...EMPTY_FILTERS, types: ['polygon'] },
  color: { ...EMPTY_FILTERS, colors: ['#ff0000'] },
  tagAny: { ...EMPTY_FILTERS, tagIds: [1, 3], tagMode: 'any' },
  tagAll: { ...EMPTY_FILTERS, tagIds: [1, 2], tagMode: 'all' },
  emptyTags: { ...EMPTY_FILTERS, tagIds: [] },
  combined: { ...EMPTY_FILTERS, folderIds: [1], types: ['point', 'polygon'], tagIds: [1], tagMode: 'any' },
};

describe('matchesFilters', () => {
  for (const [name, filters] of Object.entries(FILTERS)) {
    it(`agrees with the map expression: ${name}`, () => {
      for (const properties of FEATURES) {
        expect({ name, properties, result: matchesFilters(properties, filters) }).toEqual({
          name,
          properties,
          result: expressionMatches(filters, properties),
        });
      }
    });
  }

  it('never matches an uncolored or unfiled feature against a color/folder filter', () => {
    const unfiled: FilterableProperties = { folder_id: null, type: 'point', color: null, tag_ids: [] };
    expect(matchesFilters(unfiled, { ...EMPTY_FILTERS, folderIds: [1] })).toBe(false);
    expect(matchesFilters(unfiled, { ...EMPTY_FILTERS, colors: ['#ff0000'] })).toBe(false);
    expect(matchesFilters(unfiled, EMPTY_FILTERS)).toBe(true);
  });
});
