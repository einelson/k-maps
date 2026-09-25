import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

import { EMPTY_FILTERS, type Filters } from '../state/types';
import { buildFeatureFilter } from './filterExpression';

const filters = (overrides: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...overrides });

/** Feature properties as loaded by src/data/featuresRepo.ts `loadMapFeatures`. */
interface Props {
  folder_ids: number[];
  type: 'point' | 'line' | 'polygon';
  color: string | null;
  tag_ids: number[];
}

const feature = (props: Partial<Props> = {}) => ({
  type: 1 as const, // Point
  properties: { folder_ids: [1], type: 'point', color: '#e11d48', tag_ids: [], ...props },
  geometry: null,
});

/** Runs the expression through MapLibre's real filter compiler, like the native renderer would. */
function matches(f: Filters, props?: Partial<Props>): boolean {
  const compiled = featureFilter(buildFeatureFilter(f), 'filter');
  return compiled.filter({ zoom: 0 }, feature(props) as never);
}

describe('buildFeatureFilter: expression shape', () => {
  it('is a bare ["all"] for empty filters', () => {
    expect(buildFeatureFilter(EMPTY_FILTERS)).toEqual(['all']);
  });

  it('builds a folder clause that matches any of the listed folders in the feature\'s folder_ids', () => {
    expect(buildFeatureFilter(filters({ folderIds: [1, 2] }))).toEqual([
      'all',
      ['any', ['in', 1, ['get', 'folder_ids']], ['in', 2, ['get', 'folder_ids']]],
    ]);
  });

  it('builds a type clause on type', () => {
    expect(buildFeatureFilter(filters({ types: ['point', 'line'] }))).toEqual([
      'all',
      ['in', ['get', 'type'], ['literal', ['point', 'line']]],
    ]);
  });

  it('builds a color clause on color', () => {
    expect(buildFeatureFilter(filters({ colors: ['#e11d48'] }))).toEqual([
      'all',
      ['in', ['get', 'color'], ['literal', ['#e11d48']]],
    ]);
  });

  it('builds tag clauses with "any" by default', () => {
    expect(buildFeatureFilter(filters({ tagIds: [3, 4] }))).toEqual([
      'all',
      ['any', ['in', 3, ['get', 'tag_ids']], ['in', 4, ['get', 'tag_ids']]],
    ]);
  });

  it('builds tag clauses with "all" when tagMode is all', () => {
    expect(buildFeatureFilter(filters({ tagIds: [3, 4], tagMode: 'all' }))).toEqual([
      'all',
      ['all', ['in', 3, ['get', 'tag_ids']], ['in', 4, ['get', 'tag_ids']]],
    ]);
  });

  it('ANDs every active dimension together, in folder/type/color/tag order', () => {
    const expression = buildFeatureFilter(
      filters({ folderIds: [1], types: ['polygon'], colors: ['#fff'], tagIds: [9] })
    ) as unknown as unknown[];
    expect(expression[0]).toBe('all');
    expect(expression).toHaveLength(5);
    expect((expression[1] as unknown[])[0]).toBe('any');
    expect(((expression[1] as unknown[][])[1] as unknown[])[2]).toEqual(['get', 'folder_ids']);
    expect((expression[2] as unknown[])[1]).toEqual(['get', 'type']);
    expect((expression[3] as unknown[])[1]).toEqual(['get', 'color']);
    expect((expression[4] as unknown[])[0]).toBe('any');
  });

  it('treats an empty tag list as "no tag filter" (unlike the other dimensions)', () => {
    expect(buildFeatureFilter(filters({ tagIds: [] }))).toEqual(['all']);
    expect(buildFeatureFilter(filters({ tagIds: [], tagMode: 'all' }))).toEqual(['all']);
  });

  it('keeps an empty (non-null) folder/type/color list as a match-nothing clause', () => {
    // null means "all"; [] means "none selected" and must hide everything.
    expect(buildFeatureFilter(filters({ folderIds: [] }))).toEqual(['all', ['any']]);
    expect(matches(filters({ folderIds: [] }))).toBe(false);
    expect(matches(filters({ types: [] }))).toBe(false);
    expect(matches(filters({ colors: [] }))).toBe(false);
  });

  it('ignores the free-text search (that goes through SQL, not the map filter)', () => {
    expect(buildFeatureFilter({ ...EMPTY_FILTERS, text: 'camp' })).toEqual(['all']);
  });

  it('does not mutate its input', () => {
    const input = filters({ folderIds: [1, 2], tagIds: [5] });
    const snapshot = JSON.parse(JSON.stringify(input));
    buildFeatureFilter(input);
    expect(input).toEqual(snapshot);
  });
});

describe('buildFeatureFilter: evaluated by the MapLibre style-spec compiler', () => {
  it('passes everything with empty filters', () => {
    expect(matches(EMPTY_FILTERS)).toBe(true);
    expect(matches(EMPTY_FILTERS, { folder_ids: [], color: null })).toBe(true);
  });

  it('folder filter keeps only features in the listed folders', () => {
    const f = filters({ folderIds: [1, 2] });
    expect(matches(f, { folder_ids: [1] })).toBe(true);
    expect(matches(f, { folder_ids: [2] })).toBe(true);
    expect(matches(f, { folder_ids: [3] })).toBe(false);
  });

  it('folder filter on a parent also keeps features nested in its subfolders', () => {
    const f = filters({ folderIds: [1] });
    expect(matches(f, { folder_ids: [1, 4] })).toBe(true); // in folder 4, inside folder 1
    expect(matches(f, { folder_ids: [1, 4, 7] })).toBe(true); // two levels down
    expect(matches(f, { folder_ids: [2, 4] })).toBe(false);
  });

  it('folder filter hides unfiled (null folder) features', () => {
    expect(matches(filters({ folderIds: [1] }), { folder_ids: [] })).toBe(false);
  });

  it('type filter', () => {
    const f = filters({ types: ['line', 'polygon'] });
    expect(matches(f, { type: 'line' })).toBe(true);
    expect(matches(f, { type: 'polygon' })).toBe(true);
    expect(matches(f, { type: 'point' })).toBe(false);
  });

  it('color filter', () => {
    const f = filters({ colors: ['#e11d48', '#3b82f6'] });
    expect(matches(f, { color: '#3b82f6' })).toBe(true);
    expect(matches(f, { color: '#22c55e' })).toBe(false);
    expect(matches(f, { color: null })).toBe(false);
  });

  it('tag filter in "any" mode needs at least one selected tag', () => {
    const f = filters({ tagIds: [3, 4], tagMode: 'any' });
    expect(matches(f, { tag_ids: [3] })).toBe(true);
    expect(matches(f, { tag_ids: [4, 99] })).toBe(true);
    expect(matches(f, { tag_ids: [3, 4] })).toBe(true);
    expect(matches(f, { tag_ids: [99] })).toBe(false);
    expect(matches(f, { tag_ids: [] })).toBe(false);
  });

  it('tag filter in "all" mode needs every selected tag', () => {
    const f = filters({ tagIds: [3, 4], tagMode: 'all' });
    expect(matches(f, { tag_ids: [3, 4] })).toBe(true);
    expect(matches(f, { tag_ids: [4, 3, 99] })).toBe(true);
    expect(matches(f, { tag_ids: [3] })).toBe(false);
    expect(matches(f, { tag_ids: [] })).toBe(false);
  });

  it('a single selected tag behaves the same in both modes', () => {
    for (const tagMode of ['any', 'all'] as const) {
      const f = filters({ tagIds: [7], tagMode });
      expect(matches(f, { tag_ids: [7, 8] })).toBe(true);
      expect(matches(f, { tag_ids: [8] })).toBe(false);
    }
  });

  it('combines dimensions with AND', () => {
    const f = filters({ folderIds: [1], types: ['point'], colors: ['#e11d48'], tagIds: [5] });
    const good = { folder_ids: [1], type: 'point' as const, color: '#e11d48', tag_ids: [5] };
    expect(matches(f, good)).toBe(true);
    expect(matches(f, { ...good, folder_ids: [2] })).toBe(false);
    expect(matches(f, { ...good, type: 'line' })).toBe(false);
    expect(matches(f, { ...good, color: '#000000' })).toBe(false);
    expect(matches(f, { ...good, tag_ids: [] })).toBe(false);
  });
});
