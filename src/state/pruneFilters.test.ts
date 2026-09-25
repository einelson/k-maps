import { pruneDeletedFromFilters, pruneFilters } from './pruneFilters';
import { EMPTY_FILTERS } from './types';
import { useFiltersStore } from './useFiltersStore';
import { useLayersStore } from './useLayersStore';
import { usePoiStore } from './usePoiStore';
import { useSavedViewsStore } from './useSavedViewsStore';

describe('pruneFilters', () => {
  it('removes a deleted tag or folder id from the filter', () => {
    const filters = { ...EMPTY_FILTERS, tagIds: [1, 2], folderIds: [5, 6] };
    expect(pruneFilters(filters, { tagId: 1 }).tagIds).toEqual([2]);
    expect(pruneFilters(filters, { folderId: 6 }).folderIds).toEqual([5]);
  });

  it('an emptied list goes back to null (no restriction), not to an empty match-nothing list', () => {
    const filters = { ...EMPTY_FILTERS, tagIds: [1], folderIds: [5] };
    expect(pruneFilters(filters, { tagId: 1 }).tagIds).toBeNull();
    expect(pruneFilters(filters, { folderId: 5 }).folderIds).toBeNull();
  });

  it('returns the same object when nothing changes, and never touches other dimensions', () => {
    const filters = { ...EMPTY_FILTERS, tagIds: [1], types: ['point' as const], colors: ['#fff'], text: 'elk' };
    expect(pruneFilters(filters, { tagId: 99 })).toBe(filters);
    expect(pruneFilters(filters, {})).toBe(filters);
    const pruned = pruneFilters(filters, { tagId: 1 });
    expect(pruned).toMatchObject({ types: ['point'], colors: ['#fff'], text: 'elk', tagIds: null });
  });
});

describe('pruneDeletedFromFilters', () => {
  beforeEach(() => {
    useFiltersStore.setState(useFiltersStore.getInitialState(), true);
    useSavedViewsStore.setState(useSavedViewsStore.getInitialState(), true);
    useLayersStore.setState(useLayersStore.getInitialState(), true);
    usePoiStore.setState(usePoiStore.getInitialState(), true);
  });

  it('cleans the active filter, saved presets and saved views', () => {
    useFiltersStore.getState().setFilters({ ...EMPTY_FILTERS, tagIds: [1, 2], folderIds: [7] });
    useFiltersStore.getState().savePreset('Elk');
    useSavedViewsStore.getState().saveCurrentAsView('Hunt');

    pruneDeletedFromFilters({ tagId: 1 });
    pruneDeletedFromFilters({ folderId: 7 });

    expect(useFiltersStore.getState().filters).toMatchObject({ tagIds: [2], folderIds: null });
    expect(useFiltersStore.getState().presets[0].filters).toMatchObject({ tagIds: [2], folderIds: null });
    expect(useSavedViewsStore.getState().views[0].snapshot.filters).toMatchObject({ tagIds: [2], folderIds: null });
  });
});
