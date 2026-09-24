import { EMPTY_FILTERS } from './types';
import { useFiltersStore } from './useFiltersStore';
import { useLayersStore } from './useLayersStore';
import { usePoiStore } from './usePoiStore';
import { useSavedViewsStore } from './useSavedViewsStore';

const views = useSavedViewsStore;

function resetAll() {
  views.setState(views.getInitialState(), true);
  useLayersStore.setState(useLayersStore.getInitialState(), true);
  usePoiStore.setState(usePoiStore.getInitialState(), true);
  useFiltersStore.setState(useFiltersStore.getInitialState(), true);
}

beforeEach(() => {
  jest.useRealTimers();
  resetAll();
});

/** Puts the layer/POI/filter stores into a distinctive, non-default configuration. */
function configureHuntView() {
  useLayersStore.getState().setBaseMap('satellite');
  useLayersStore.getState().setOverlayVisible('land', true);
  useLayersStore.getState().setOverlayVisible('shadedRelief', true);
  useLayersStore.getState().setOverlayOpacity('shadedRelief', 0.9);
  useLayersStore.getState().setOverlayOpacity('land', 0.2);
  usePoiStore.getState().setVisible('boatLaunches', false);
  useFiltersStore.getState().setFilters({
    folderIds: [3],
    types: ['point'],
    colors: ['#f97316'],
    tagIds: [1, 2],
    tagMode: 'all',
  });
}

describe('useSavedViewsStore', () => {
  it('starts with no views', () => {
    expect(views.getState().views).toEqual([]);
  });

  it('saveCurrentAsView snapshots base map, overlays, POIs and filters', () => {
    configureHuntView();
    views.getState().saveCurrentAsView('Hunt: elk unit');

    const [view] = views.getState().views;
    expect(view.name).toBe('Hunt: elk unit');
    expect(typeof view.id).toBe('string');
    expect(view.snapshot.baseMap).toBe('satellite');
    expect(view.snapshot.overlayVisibility.shadedRelief).toBe(true);
    expect(view.snapshot.overlayOpacity.shadedRelief).toBe(0.9);
    expect(view.snapshot.overlayOpacity.land).toBe(0.2);
    expect(view.snapshot.poiVisibility).toEqual({ boatLaunches: false, campsitesTrails: true });
    expect(view.snapshot.filters).toEqual({
      folderIds: [3],
      types: ['point'],
      colors: ['#f97316'],
      tagIds: [1, 2],
      tagMode: 'all',
    });
  });

  it('applyView restores everything after the live settings changed', () => {
    configureHuntView();
    const expected = {
      baseMap: useLayersStore.getState().baseMap,
      overlayVisibility: { ...useLayersStore.getState().overlayVisibility },
      overlayOpacity: { ...useLayersStore.getState().overlayOpacity },
      poi: { ...usePoiStore.getState().visibility },
      filters: { ...useFiltersStore.getState().filters },
    };
    views.getState().saveCurrentAsView('hunt');
    const { id } = views.getState().views[0];

    // Wander off to something completely different.
    useLayersStore.getState().setBaseMap('hybrid');
    useLayersStore.getState().setOverlayVisible('land', false);
    useLayersStore.getState().setOverlayVisible('mvum', true);
    useLayersStore.getState().setOverlayOpacity('shadedRelief', 0.1);
    usePoiStore.getState().setVisible('boatLaunches', true);
    usePoiStore.getState().setVisible('campsitesTrails', false);
    useFiltersStore.getState().resetFilters();

    views.getState().applyView(id);

    expect(useLayersStore.getState().baseMap).toBe(expected.baseMap);
    expect(useLayersStore.getState().overlayVisibility).toEqual(expected.overlayVisibility);
    expect(useLayersStore.getState().overlayOpacity).toEqual(expected.overlayOpacity);
    expect(usePoiStore.getState().visibility).toEqual(expected.poi);
    expect(useFiltersStore.getState().filters).toEqual(expected.filters);
  });

  it('a saved view is not changed by later edits to the live stores', () => {
    configureHuntView();
    views.getState().saveCurrentAsView('hunt');
    const before = JSON.stringify(views.getState().views[0].snapshot);

    useLayersStore.getState().setBaseMap('topo');
    useLayersStore.getState().setOverlayVisible('mvum', true);
    useLayersStore.getState().setOverlayOpacity('land', 1);
    usePoiStore.getState().setVisible('campsitesTrails', false);
    useFiltersStore.getState().setFilters({ ...EMPTY_FILTERS, types: ['line'] });

    expect(JSON.stringify(views.getState().views[0].snapshot)).toBe(before);
  });

  it('applying a view and then editing the live stores does not corrupt the saved view', () => {
    configureHuntView();
    views.getState().saveCurrentAsView('hunt');
    const saved = views.getState().views[0];
    const savedJson = JSON.stringify(saved.snapshot);

    // Apply shares the snapshot's objects with the live stores, so later live edits must copy, not mutate.
    views.getState().applyView(saved.id);
    useLayersStore.getState().setOverlayVisible('mvum', true);
    useLayersStore.getState().setOverlayOpacity('shadedRelief', 0.05);
    usePoiStore.getState().setVisible('boatLaunches', true);
    useFiltersStore.getState().setFilters({ ...useFiltersStore.getState().filters, types: null });

    expect(JSON.stringify(views.getState().views[0].snapshot)).toBe(savedJson);
  });

  it('applyView leaves unrelated settings (location dot, offline maps, labels) untouched', () => {
    views.getState().saveCurrentAsView('plain');
    const { id } = views.getState().views[0];
    useLayersStore.getState().setShowUserLocation(true);
    useLayersStore.getState().setUseOfflineMaps(true);
    useFiltersStore.getState().savePreset('keep me');

    views.getState().applyView(id);

    expect(useLayersStore.getState().showUserLocation).toBe(true);
    expect(useLayersStore.getState().useOfflineMaps).toBe(true);
    expect(useFiltersStore.getState().presets).toHaveLength(1);
  });

  it('applyView with an unknown id changes nothing', () => {
    configureHuntView();
    const layers = useLayersStore.getState();
    const filters = useFiltersStore.getState().filters;
    views.getState().applyView('nope');
    expect(useLayersStore.getState().baseMap).toBe(layers.baseMap);
    expect(useLayersStore.getState().overlayVisibility).toBe(layers.overlayVisibility);
    expect(useFiltersStore.getState().filters).toBe(filters);
  });

  it('keeps several views and applies the one asked for', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    useLayersStore.getState().setBaseMap('satellite');
    views.getState().saveCurrentAsView('sat');
    jest.setSystemTime(2_000);
    useLayersStore.getState().setBaseMap('hybrid');
    views.getState().saveCurrentAsView('hyb');
    jest.setSystemTime(3_000);
    useLayersStore.getState().setBaseMap('topo');
    views.getState().saveCurrentAsView('topo');

    const [sat, hyb, topo] = views.getState().views;
    expect(views.getState().views.map((v) => v.name)).toEqual(['sat', 'hyb', 'topo']);

    views.getState().applyView(sat.id);
    expect(useLayersStore.getState().baseMap).toBe('satellite');
    views.getState().applyView(hyb.id);
    expect(useLayersStore.getState().baseMap).toBe('hybrid');
    views.getState().applyView(topo.id);
    expect(useLayersStore.getState().baseMap).toBe('topo');
  });

  it('deleteView removes only that view', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    views.getState().saveCurrentAsView('a');
    jest.setSystemTime(2_000);
    views.getState().saveCurrentAsView('b');
    const [a, b] = views.getState().views;
    views.getState().deleteView(a.id);
    expect(views.getState().views.map((v) => v.id)).toEqual([b.id]);
    views.getState().deleteView('missing');
    expect(views.getState().views).toHaveLength(1);
  });

  it('a snapshot of the default configuration round-trips to the default configuration', () => {
    views.getState().saveCurrentAsView('defaults');
    const defaults = {
      layers: useLayersStore.getInitialState(),
      poi: usePoiStore.getInitialState().visibility,
    };
    configureHuntView();
    views.getState().applyView(views.getState().views[0].id);
    expect(useLayersStore.getState().baseMap).toBe(defaults.layers.baseMap);
    expect(useLayersStore.getState().overlayVisibility).toEqual(defaults.layers.overlayVisibility);
    expect(useLayersStore.getState().overlayOpacity).toEqual(defaults.layers.overlayOpacity);
    expect(usePoiStore.getState().visibility).toEqual(defaults.poi);
    expect(useFiltersStore.getState().filters).toEqual(EMPTY_FILTERS);
  });

  // BUG (src/state/useSavedViewsStore.ts:51): same Date.now() id scheme as the
  // filter presets, so two views saved in the same millisecond share an id and
  // applyView/deleteView cannot tell them apart.
  // Proposed fix: unique ids (`${Date.now()}-${++seq}` or crypto.randomUUID()).
  it('gives views saved in the same millisecond distinct ids', () => {
    jest.useFakeTimers();
    jest.setSystemTime(9_000);
    views.getState().saveCurrentAsView('one');
    views.getState().saveCurrentAsView('two');
    const [one, two] = views.getState().views;
    expect(one.id).not.toBe(two.id);
  });
});
