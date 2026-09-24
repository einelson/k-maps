import { useLayersStore, type OverlayLayerId } from './useLayersStore';

const store = useLayersStore;

beforeEach(() => {
  store.setState(store.getInitialState(), true);
});

/** Ids present in the store's default maps — the tests below don't hard-code the overlay list. */
const overlayIds = () => Object.keys(store.getState().overlayVisibility) as OverlayLayerId[];

describe('useLayersStore defaults', () => {
  it('opens on the topo base map with live (not offline) tiles', () => {
    expect(store.getState().baseMap).toBe('topo');
    expect(store.getState().useOfflineMaps).toBe(false);
  });

  it('shows public land by default and keeps the heavier optional overlays off', () => {
    const { overlayVisibility } = store.getState();
    expect(overlayVisibility.land).toBe(true);
    expect(overlayVisibility.shadedRelief).toBe(false);
    expect(overlayVisibility.mvum).toBe(false);
    expect(overlayVisibility.blmSma).toBe(false);
    expect(overlayVisibility.osm).toBe(false);
  });

  it('does not track the user location until asked', () => {
    expect(store.getState().showUserLocation).toBe(false);
  });

  it('every overlay has both a visibility flag and an opacity in [0, 1]', () => {
    const { overlayVisibility, overlayOpacity } = store.getState();
    expect(Object.keys(overlayOpacity).sort()).toEqual(Object.keys(overlayVisibility).sort());
    for (const id of overlayIds()) {
      expect(typeof overlayVisibility[id]).toBe('boolean');
      expect(overlayOpacity[id]).toBeGreaterThanOrEqual(0);
      expect(overlayOpacity[id]).toBeLessThanOrEqual(1);
    }
  });

  it('fill-style overlays start semi-transparent so the base map shows through', () => {
    const { overlayOpacity } = store.getState();
    expect(overlayOpacity.shadedRelief).toBe(0.5);
    expect(overlayOpacity.land).toBe(0.5);
  });
});

describe('useLayersStore actions', () => {
  it('setBaseMap switches between topo, satellite and hybrid', () => {
    for (const mode of ['satellite', 'hybrid', 'topo'] as const) {
      store.getState().setBaseMap(mode);
      expect(store.getState().baseMap).toBe(mode);
    }
  });

  it('setOverlayVisible toggles one overlay and leaves the others alone', () => {
    const before = { ...store.getState().overlayVisibility };
    store.getState().setOverlayVisible('mvum', true);
    const after = store.getState().overlayVisibility;
    expect(after.mvum).toBe(true);
    for (const id of overlayIds().filter((i) => i !== 'mvum')) {
      expect(after[id]).toBe(before[id]);
    }
    store.getState().setOverlayVisible('mvum', false);
    expect(store.getState().overlayVisibility.mvum).toBe(false);
  });

  it('setOverlayVisible can hide a default-visible overlay', () => {
    store.getState().setOverlayVisible('land', false);
    expect(store.getState().overlayVisibility.land).toBe(false);
  });

  it('setOverlayOpacity updates one overlay and leaves the others alone', () => {
    const before = { ...store.getState().overlayOpacity };
    store.getState().setOverlayOpacity('shadedRelief', 0.8);
    const after = store.getState().overlayOpacity;
    expect(after.shadedRelief).toBe(0.8);
    for (const id of overlayIds().filter((i) => i !== 'shadedRelief')) {
      expect(after[id]).toBe(before[id]);
    }
  });

  it('visibility and opacity are independent (hiding does not reset opacity)', () => {
    store.getState().setOverlayOpacity('land', 0.25);
    store.getState().setOverlayVisible('land', false);
    store.getState().setOverlayVisible('land', true);
    expect(store.getState().overlayOpacity.land).toBe(0.25);
  });

  it('replaces the maps immutably so old snapshots (e.g. saved views) never change', () => {
    const visibility = store.getState().overlayVisibility;
    const opacity = store.getState().overlayOpacity;
    const visibilityCopy = { ...visibility };
    const opacityCopy = { ...opacity };
    store.getState().setOverlayVisible('mvum', true);
    store.getState().setOverlayOpacity('mvum', 0.1);
    expect(store.getState().overlayVisibility).not.toBe(visibility);
    expect(store.getState().overlayOpacity).not.toBe(opacity);
    expect(visibility).toEqual(visibilityCopy);
    expect(opacity).toEqual(opacityCopy);
  });

  it('setShowUserLocation and setUseOfflineMaps flip their own flags only', () => {
    store.getState().setShowUserLocation(true);
    expect(store.getState().showUserLocation).toBe(true);
    expect(store.getState().useOfflineMaps).toBe(false);
    store.getState().setUseOfflineMaps(true);
    expect(store.getState().useOfflineMaps).toBe(true);
    expect(store.getState().showUserLocation).toBe(true);
    store.getState().setShowUserLocation(false);
    store.getState().setUseOfflineMaps(false);
    expect(store.getState().showUserLocation).toBe(false);
    expect(store.getState().useOfflineMaps).toBe(false);
  });
});

describe('useLayersStore new overlays', () => {
  it('starts every hazard/terrain/agency overlay switched off (only public land + shading are on)', () => {
    const { overlayVisibility } = store.getState();
    for (const id of ['landManager', 'huntUnits', 'usfsTrails', 'slopeAngle', 'nhd', 'wetlands', 'wildfire', 'radar'] as const) {
      expect(overlayVisibility[id]).toBe(false);
    }
    expect(Object.entries(overlayVisibility).filter(([, on]) => on).map(([id]) => id).sort()).toEqual([
      'land',
      'likelyPrivate',
    ]);
  });

  it('semi-transparent defaults for the fill-style rasters, opaque for linework', () => {
    const { overlayOpacity } = store.getState();
    expect(overlayOpacity.radar).toBeLessThan(1);
    expect(overlayOpacity.slopeAngle).toBeLessThan(1);
    expect(overlayOpacity.landManager).toBeLessThan(1);
    expect(overlayOpacity.nhd).toBe(1);
    expect(overlayOpacity.usfsTrails).toBe(1);
  });

  it('loads land data as you pan by default, and the switch is independent of the overlays', () => {
    expect(store.getState().autoLoadOverlays).toBe(true);
    store.getState().setAutoLoadOverlays(false);
    expect(store.getState().autoLoadOverlays).toBe(false);
    expect(store.getState().overlayVisibility.land).toBe(true);
  });
});
