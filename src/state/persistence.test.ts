/**
 * What survives closing the app: layers, filters, POI toggles, saved views, download options and the map
 * position are written to the key-value store as they change and read back on the next launch. "Next launch"
 * is simulated with `persist.rehydrate()` after putting a saved value on the (in-memory, see __mocks__) disk.
 */
import Storage from 'expo-sqlite/kv-store';

import { EMPTY_FILTERS } from './types';
import { useCameraStore, DEFAULT_CENTER, DEFAULT_ZOOM } from './useCameraStore';
import { useDownloadStore } from './useDownloadStore';
import { useFiltersStore } from './useFiltersStore';
import { DEFAULT_OVERLAY_OPACITY, DEFAULT_OVERLAY_VISIBILITY, useLayersStore } from './useLayersStore';
import { usePoiStore } from './usePoiStore';
import { useSavedViewsStore } from './useSavedViewsStore';

const KEYS = {
  layers: 'kmaps.layers',
  filters: 'kmaps.filters',
  poi: 'kmaps.poi',
  views: 'kmaps.savedViews',
  camera: 'kmaps.camera',
  downloads: 'kmaps.downloadOptions',
} as const;

const saved = (key: string) => JSON.parse(Storage.getItemSync(key) ?? 'null') as { state: Record<string, any> } | null;
/** Puts a value on "disk" the way an earlier launch (possibly an older app version) would have left it. */
const leaveOnDisk = (key: string, state: unknown) => Storage.setItemSync(key, JSON.stringify({ state, version: 0 }));

beforeEach(() => {
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
  useLayersStore.setState(useLayersStore.getInitialState(), true);
  useFiltersStore.setState(useFiltersStore.getInitialState(), true);
  usePoiStore.setState(usePoiStore.getInitialState(), true);
  useSavedViewsStore.setState(useSavedViewsStore.getInitialState(), true);
  useCameraStore.setState(useCameraStore.getInitialState(), true);
  useDownloadStore.setState(useDownloadStore.getInitialState(), true);
  for (const key of Object.values(KEYS)) Storage.removeItemSync(key);
});

describe('layers', () => {
  it('saves the base map, overlays, opacity and toggles as they change', () => {
    const layers = useLayersStore.getState();
    layers.setBaseMap('satellite');
    layers.setOverlayVisible('mvum', true);
    layers.setOverlayVisible('land', false);
    layers.setOverlayOpacity('land', 0.2);
    layers.setShowLabels(false);
    layers.setUseOfflineMaps(true);
    layers.setAutoLoadOverlays(false);

    const state = saved(KEYS.layers)?.state;
    expect(state).toMatchObject({
      baseMap: 'satellite',
      showLabels: false,
      useOfflineMaps: true,
      autoLoadOverlays: false,
    });
    expect(state?.overlayVisibility).toMatchObject({ mvum: true, land: false });
    expect(state?.overlayOpacity.land).toBe(0.2);
  });

  it("does not save the location dot: it needs this session's permission, so it starts off", () => {
    useLayersStore.getState().setShowUserLocation(true);

    expect(saved(KEYS.layers)?.state).not.toHaveProperty('showUserLocation');
  });

  it('brings back what was on the last time the app ran', async () => {
    leaveOnDisk(KEYS.layers, {
      baseMap: 'hybrid',
      overlayVisibility: { ...DEFAULT_OVERLAY_VISIBILITY, land: false, mvum: true, wildfire: true },
      overlayOpacity: { ...DEFAULT_OVERLAY_OPACITY, land: 0.8 },
      showLabels: false,
      useOfflineMaps: true,
      autoLoadOverlays: false,
    });

    await useLayersStore.persist.rehydrate();

    const s = useLayersStore.getState();
    expect(s.baseMap).toBe('hybrid');
    expect(s.overlayVisibility).toMatchObject({ land: false, mvum: true, wildfire: true });
    expect(s.overlayOpacity.land).toBe(0.8);
    expect(s.showLabels).toBe(false);
    expect(s.useOfflineMaps).toBe(true);
    expect(s.autoLoadOverlays).toBe(false);
    expect(s.showUserLocation).toBe(false);
  });

  it('gives a layer added since the save its default instead of leaving it undefined', async () => {
    const { radar, ...older } = DEFAULT_OVERLAY_VISIBILITY;
    const { radar: radarOpacity, ...olderOpacity } = DEFAULT_OVERLAY_OPACITY;
    leaveOnDisk(KEYS.layers, {
      baseMap: 'topo',
      overlayVisibility: { ...older, land: false },
      overlayOpacity: olderOpacity,
    });

    await useLayersStore.persist.rehydrate();

    const s = useLayersStore.getState();
    expect(s.overlayVisibility.radar).toBe(radar);
    expect(s.overlayOpacity.radar).toBe(radarOpacity);
    expect(s.overlayVisibility.land).toBe(false);
    expect(s.showLabels).toBe(true); // a setting the save never had keeps its default
  });

  it('ignores junk: unknown base map, wrong types, out-of-range opacity, layers that no longer exist', async () => {
    leaveOnDisk(KEYS.layers, {
      baseMap: 'moon',
      overlayVisibility: { land: 'yes', mvum: true, oldLayer: true },
      overlayOpacity: { land: 7, mvum: -1, osm: 'x' },
      showLabels: 'no',
    });

    await useLayersStore.persist.rehydrate();

    const s = useLayersStore.getState();
    expect(s.baseMap).toBe('topo');
    expect(s.overlayVisibility.land).toBe(DEFAULT_OVERLAY_VISIBILITY.land);
    expect(s.overlayVisibility.mvum).toBe(true);
    expect(s.overlayVisibility).not.toHaveProperty('oldLayer');
    expect(s.overlayOpacity.land).toBe(1);
    expect(s.overlayOpacity.mvum).toBe(0);
    expect(s.overlayOpacity.osm).toBe(DEFAULT_OVERLAY_OPACITY.osm);
    expect(s.showLabels).toBe(true);
  });

  it('starts from the defaults when nothing was saved or the save is unreadable', async () => {
    Storage.setItemSync(KEYS.layers, '{not json');

    await useLayersStore.persist.rehydrate();

    expect(useLayersStore.getState().overlayVisibility).toEqual(DEFAULT_OVERLAY_VISIBILITY);
    expect(useLayersStore.getState().baseMap).toBe('topo');
  });
});

describe('filters', () => {
  it('saves the active filters and presets, but not the Items search text', () => {
    const filters = useFiltersStore.getState();
    filters.setFilters({ ...EMPTY_FILTERS, folderIds: [2], colors: ['#f00'], tagMode: 'all', text: 'elk' });
    filters.savePreset('Elk');

    const state = saved(KEYS.filters)?.state;
    expect(state?.filters).toEqual({ ...EMPTY_FILTERS, folderIds: [2], colors: ['#f00'], tagMode: 'all' });
    expect(state?.filters).not.toHaveProperty('text');
    expect(state?.presets).toHaveLength(1);
  });

  it('brings back the filters and presets', async () => {
    leaveOnDisk(KEYS.filters, {
      filters: { folderIds: [2, 5], types: ['point'], colors: null, tagIds: [1], tagMode: 'all' },
      presets: [{ id: 'p1', name: 'Points', filters: { ...EMPTY_FILTERS, types: ['point'] } }],
    });

    await useFiltersStore.persist.rehydrate();

    expect(useFiltersStore.getState().filters).toEqual({
      folderIds: [2, 5],
      types: ['point'],
      colors: null,
      tagIds: [1],
      tagMode: 'all',
    });
    expect(useFiltersStore.getState().presets).toEqual([
      { id: 'p1', name: 'Points', filters: { ...EMPTY_FILTERS, types: ['point'] } },
    ]);
  });

  it('turns unusable saved filters into "no restriction" rather than hiding the whole map', async () => {
    leaveOnDisk(KEYS.filters, {
      filters: { folderIds: 'all', types: ['point', 'volcano'], colors: [1, 2], tagIds: [1.5], tagMode: 'some' },
      presets: [{ id: 3, name: 'bad id' }, 'nope', { id: 'ok', name: 'Fine', filters: 'garbage' }],
    });

    await useFiltersStore.persist.rehydrate();

    expect(useFiltersStore.getState().filters).toEqual(EMPTY_FILTERS);
    expect(useFiltersStore.getState().presets).toEqual([{ id: 'ok', name: 'Fine', filters: EMPTY_FILTERS }]);
  });
});

describe('points of interest', () => {
  it('remembers which POI pins are on, and defaults any category the save lacks', async () => {
    usePoiStore.getState().setVisible('boatLaunches', false);
    expect(saved(KEYS.poi)?.state.visibility.boatLaunches).toBe(false);

    leaveOnDisk(KEYS.poi, { visibility: { boatLaunches: false } });
    await usePoiStore.persist.rehydrate();

    expect(usePoiStore.getState().visibility).toEqual({ boatLaunches: false, campsitesTrails: true });
  });
});

describe('saved views', () => {
  it('are kept between launches', async () => {
    useLayersStore.getState().setBaseMap('satellite');
    useSavedViewsStore.getState().saveCurrentAsView('Hunt');
    const { views } = useSavedViewsStore.getState();
    const written = Storage.getItemSync(KEYS.views) as string;
    expect(saved(KEYS.views)?.state.views).toHaveLength(1);

    useSavedViewsStore.setState({ views: [] }); // a fresh process: memory is empty...
    Storage.setItemSync(KEYS.views, written); // ...but the disk still has what the last one wrote
    await useSavedViewsStore.persist.rehydrate();

    expect(useSavedViewsStore.getState().views).toEqual(views);
  });

  it('fill in layers added after the view was saved, and skip entries that are not views', async () => {
    const { radar, ...olderVisibility } = DEFAULT_OVERLAY_VISIBILITY;
    leaveOnDisk(KEYS.views, {
      views: [
        {
          id: 'v1',
          name: 'Old view',
          snapshot: { baseMap: 'hybrid', overlayVisibility: olderVisibility, filters: { folderIds: [4] } },
        },
        { name: 'no id' },
        null,
      ],
    });

    await useSavedViewsStore.persist.rehydrate();

    const { views } = useSavedViewsStore.getState();
    expect(views).toHaveLength(1);
    expect(views[0].snapshot.baseMap).toBe('hybrid');
    expect(views[0].snapshot.overlayVisibility.radar).toBe(radar);
    expect(views[0].snapshot.overlayOpacity).toEqual(DEFAULT_OVERLAY_OPACITY);
    expect(views[0].snapshot.poiVisibility).toEqual({ boatLaunches: true, campsitesTrails: true });
    expect(views[0].snapshot.filters).toEqual({ ...EMPTY_FILTERS, folderIds: [4] });
  });
});

describe('map position', () => {
  it('opens on Boise the first time', () => {
    expect(useCameraStore.getState()).toMatchObject({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  });

  it('remembers where the map was left', async () => {
    useCameraStore.getState().setView([-114.1, 46.9], 11.5);
    expect(saved(KEYS.camera)?.state).toEqual({ center: [-114.1, 46.9], zoom: 11.5 });

    const written = Storage.getItemSync(KEYS.camera) as string;
    useCameraStore.setState({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }); // a fresh process: memory is empty...
    Storage.setItemSync(KEYS.camera, written); // ...but the disk still has what the last one wrote
    await useCameraStore.persist.rehydrate();

    expect(useCameraStore.getState()).toMatchObject({ center: [-114.1, 46.9], zoom: 11.5 });
  });

  it.each([
    ['a latitude off the map', { center: [-114, 120], zoom: 10 }],
    ['a missing zoom', { center: [-114, 46] }],
    ['a center that is not a pair of numbers', { center: 'here', zoom: 10 }],
    ['NaN', { center: [Number.NaN, 46], zoom: 10 }],
  ])('falls back to Boise for %s', async (_name, state) => {
    leaveOnDisk(KEYS.camera, state);

    await useCameraStore.persist.rehydrate();

    expect(useCameraStore.getState()).toMatchObject({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  });
});

describe('download options', () => {
  it('remember the tile layers, overlay data and zoom, but not the cells picked for one download', () => {
    const downloads = useDownloadStore.getState();
    downloads.setSelectedLayers(['satellite', 'hybrid']);
    downloads.setSelectedPackLayers(['land', 'mvum']);
    downloads.setMaxZoom(14);
    downloads.selectCell(1, 2);

    const state = saved(KEYS.downloads)?.state;
    expect(state).toEqual({
      selectedLayers: ['satellite', 'hybrid'],
      selectedPackLayers: ['land', 'mvum'],
      maxZoom: 14,
    });
  });

  it('bring back the choices, keeping an empty choice empty and dropping ids this version does not know', async () => {
    leaveOnDisk(KEYS.downloads, { selectedLayers: [], selectedPackLayers: ['osm', 'warp-drive'], maxZoom: 15 });

    await useDownloadStore.persist.rehydrate();

    const s = useDownloadStore.getState();
    expect(s.selectedLayers).toEqual([]);
    expect(s.selectedPackLayers).toEqual(['osm']);
    expect(s.maxZoom).toBe(15);
    expect(s.selectedCells).toEqual([]);
  });

  it('keep the defaults when the save is junk', async () => {
    leaveOnDisk(KEYS.downloads, { selectedLayers: 'topo', selectedPackLayers: null, maxZoom: 'high' });

    await useDownloadStore.persist.rehydrate();

    expect(useDownloadStore.getState()).toMatchObject({
      selectedLayers: ['topo'],
      selectedPackLayers: ['land'],
      maxZoom: 16,
    });
  });
});
