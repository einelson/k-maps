import { usePoiStore } from './usePoiStore';

const store = usePoiStore;

beforeEach(() => {
  store.setState(store.getInitialState(), true);
});

describe('usePoiStore', () => {
  it('shows both POI categories by default', () => {
    expect(store.getState().visibility).toEqual({ boatLaunches: true, campsitesTrails: true });
  });

  it('setVisible toggles one category and leaves the other alone', () => {
    store.getState().setVisible('boatLaunches', false);
    expect(store.getState().visibility).toEqual({ boatLaunches: false, campsitesTrails: true });
    store.getState().setVisible('campsitesTrails', false);
    expect(store.getState().visibility).toEqual({ boatLaunches: false, campsitesTrails: false });
    store.getState().setVisible('boatLaunches', true);
    expect(store.getState().visibility).toEqual({ boatLaunches: true, campsitesTrails: false });
  });

  it('setting the current value again is harmless', () => {
    store.getState().setVisible('boatLaunches', true);
    expect(store.getState().visibility.boatLaunches).toBe(true);
  });

  it('replaces the visibility map immutably', () => {
    const before = store.getState().visibility;
    store.getState().setVisible('boatLaunches', false);
    expect(store.getState().visibility).not.toBe(before);
    expect(before).toEqual({ boatLaunches: true, campsitesTrails: true });
  });
});
