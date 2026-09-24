import { EMPTY_FILTERS, type Filters } from './types';
import { useFiltersStore } from './useFiltersStore';

const store = useFiltersStore;
const filters = (overrides: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...overrides });

beforeEach(() => {
  store.setState(store.getInitialState(), true);
  jest.useRealTimers();
});

describe('useFiltersStore: filters', () => {
  it('starts with no filters and no presets', () => {
    expect(store.getState().filters).toEqual(EMPTY_FILTERS);
    expect(store.getState().presets).toEqual([]);
  });

  it('EMPTY_FILTERS means "everything": null lists, any-mode tags, no text', () => {
    expect(EMPTY_FILTERS).toEqual({
      folderIds: null,
      types: null,
      colors: null,
      tagIds: null,
      tagMode: 'any',
    });
  });

  it('setFilters replaces the whole filter object', () => {
    const next = filters({ folderIds: [1, 2], types: ['point'], tagIds: [4], tagMode: 'all', text: 'camp' });
    store.getState().setFilters(next);
    expect(store.getState().filters).toEqual(next);
    store.getState().setFilters(filters({ colors: ['#fff'] }));
    expect(store.getState().filters).toEqual(filters({ colors: ['#fff'] }));
  });

  it('resetFilters goes back to empty without touching presets', () => {
    store.getState().setFilters(filters({ types: ['line'] }));
    store.getState().savePreset('lines');
    store.getState().resetFilters();
    expect(store.getState().filters).toEqual(EMPTY_FILTERS);
    expect(store.getState().presets).toHaveLength(1);
  });

  it('never mutates the shared EMPTY_FILTERS constant', () => {
    const before = JSON.stringify(EMPTY_FILTERS);
    store.getState().setFilters({ ...store.getState().filters, types: ['point'] });
    store.getState().resetFilters();
    store.getState().savePreset('x');
    store.getState().applyPreset(store.getState().presets[0].id);
    expect(JSON.stringify(EMPTY_FILTERS)).toBe(before);
  });
});

describe('useFiltersStore: presets', () => {
  it('savePreset captures the current filters under the given name', () => {
    const current = filters({ folderIds: [3], types: ['polygon'], colors: ['#e11d48'] });
    store.getState().setFilters(current);
    store.getState().savePreset('Hunt units');
    const [preset] = store.getState().presets;
    expect(preset.name).toBe('Hunt units');
    expect(preset.filters).toEqual(current);
    expect(typeof preset.id).toBe('string');
    expect(preset.id).not.toBe('');
  });

  it('a saved preset is unaffected by later filter changes', () => {
    store.getState().setFilters(filters({ types: ['point'] }));
    store.getState().savePreset('points');
    store.getState().setFilters(filters({ types: ['line'], folderIds: [9] }));
    store.getState().resetFilters();
    expect(store.getState().presets[0].filters).toEqual(filters({ types: ['point'] }));
  });

  it('applyPreset restores the saved filters exactly', () => {
    store.getState().setFilters(filters({ tagIds: [1, 2], tagMode: 'all' }));
    store.getState().savePreset('tags');
    store.getState().resetFilters();
    store.getState().applyPreset(store.getState().presets[0].id);
    expect(store.getState().filters).toEqual(filters({ tagIds: [1, 2], tagMode: 'all' }));
  });

  it('applyPreset with an unknown id is a no-op', () => {
    const current = filters({ types: ['line'] });
    store.getState().setFilters(current);
    store.getState().applyPreset('does-not-exist');
    expect(store.getState().filters).toBe(current);
  });

  it('keeps presets in save order and applies the right one', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    store.getState().setFilters(filters({ types: ['point'] }));
    store.getState().savePreset('first');
    jest.setSystemTime(2_000);
    store.getState().setFilters(filters({ types: ['line'] }));
    store.getState().savePreset('second');

    const { presets } = store.getState();
    expect(presets.map((p) => p.name)).toEqual(['first', 'second']);
    expect(presets[0].id).not.toBe(presets[1].id);

    store.getState().applyPreset(presets[0].id);
    expect(store.getState().filters.types).toEqual(['point']);
    store.getState().applyPreset(presets[1].id);
    expect(store.getState().filters.types).toEqual(['line']);
  });

  it('deletePreset removes only the matching preset', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    store.getState().savePreset('a');
    jest.setSystemTime(2_000);
    store.getState().savePreset('b');
    jest.setSystemTime(3_000);
    store.getState().savePreset('c');
    const [a, b, c] = store.getState().presets;

    store.getState().deletePreset(b.id);
    expect(store.getState().presets.map((p) => p.id)).toEqual([a.id, c.id]);

    store.getState().deletePreset('missing');
    expect(store.getState().presets).toHaveLength(2);
  });

  it('deleting a preset does not change the active filters', () => {
    store.getState().setFilters(filters({ types: ['point'] }));
    store.getState().savePreset('p');
    store.getState().deletePreset(store.getState().presets[0].id);
    expect(store.getState().filters).toEqual(filters({ types: ['point'] }));
  });

  // BUG (src/state/useFiltersStore.ts:30): preset ids are String(Date.now()),
  // so two presets saved in the same millisecond share an id; applyPreset then
  // always resolves to the first one and deletePreset removes both. Human taps
  // are far apart, but the id scheme is not unique by construction (and the
  // same pattern is used in useSavedViewsStore.saveCurrentAsView).
  // Proposed fix: use a monotonic counter, e.g. `${Date.now()}-${++seq}`, or crypto.randomUUID().
  it('gives presets saved in the same millisecond distinct ids', () => {
    jest.useFakeTimers();
    jest.setSystemTime(5_000);
    store.getState().savePreset('one');
    store.getState().savePreset('two');
    const [one, two] = store.getState().presets;
    expect(one.id).not.toBe(two.id);
  });
});
