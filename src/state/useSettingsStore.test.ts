import Storage from 'expo-sqlite/kv-store';

import { DEFAULT_FIX_SPACING_M } from '../features/transport';
import { sanitizeSpacing, useSettingsStore } from './useSettingsStore';

jest.mock('expo-sqlite/kv-store', () => {
  const disk = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => disk.get(key) ?? null,
      setItemSync: (key: string, value: string) => void disk.set(key, value),
      removeItemSync: (key: string) => disk.delete(key),
    },
  };
});

const store = useSettingsStore;
const KEY = 'kmaps.settings';

const saved = () => JSON.parse(Storage.getItemSync(KEY) ?? 'null') as { state: Record<string, unknown> } | null;

beforeEach(() => {
  store.setState(store.getInitialState(), true);
  Storage.removeItemSync(KEY);
});

describe('useSettingsStore', () => {
  it('defaults: imperial, decimal coordinates, appearance follows the system', () => {
    const state = store.getState();
    expect(state.units).toBe('imperial');
    expect(state.coordinateFormat).toBe('decimal');
    expect(state.appearance).toBe('system');
  });

  it('saves the appearance choice as soon as it changes', () => {
    store.getState().setAppearance('dark');

    expect(saved()?.state.appearance).toBe('dark');
  });

  it('saves units and coordinate format too', () => {
    store.getState().setUnits('metric');
    store.getState().setCoordinateFormat('utm');

    expect(saved()?.state).toMatchObject({ units: 'metric', coordinateFormat: 'utm' });
  });

  it('restores what was saved on the last launch', async () => {
    Storage.setItemSync(
      KEY,
      JSON.stringify({ state: { units: 'metric', coordinateFormat: 'dms', appearance: 'dark' }, version: 0 })
    );

    await store.persist.rehydrate();

    expect(store.getState()).toMatchObject({ units: 'metric', coordinateFormat: 'dms', appearance: 'dark' });
  });

  it('keeps settings saved before appearance existed and fills in the default', async () => {
    Storage.setItemSync(KEY, JSON.stringify({ state: { units: 'metric', coordinateFormat: 'dms' }, version: 0 }));

    await store.persist.rehydrate();

    expect(store.getState()).toMatchObject({ units: 'metric', coordinateFormat: 'dms', appearance: 'system' });
  });
});

describe('track spacing', () => {
  it('starts at each mode\'s default', () => {
    expect(store.getState().trackSpacingM).toEqual(DEFAULT_FIX_SPACING_M);
  });

  it('changes one mode without touching the others, and saves it', () => {
    store.getState().setTrackSpacing('horse', 20);
    expect(store.getState().trackSpacingM).toEqual({ ...DEFAULT_FIX_SPACING_M, horse: 20 });
    expect((saved()?.state.trackSpacingM as Record<string, number>).horse).toBe(20);
  });

  it('clamps a value outside what the recorder accepts', () => {
    store.getState().setTrackSpacing('foot', 0);
    expect(store.getState().trackSpacingM.foot).toBe(1);
    store.getState().setTrackSpacing('foot', 9999);
    expect(store.getState().trackSpacingM.foot).toBe(100);
  });

  it('resets every mode to its default', () => {
    store.getState().setTrackSpacing('foot', 2);
    store.getState().setTrackSpacing('vehicle', 100);
    store.getState().resetTrackSpacing();
    expect(store.getState().trackSpacingM).toEqual(DEFAULT_FIX_SPACING_M);
  });

  it('restores what was saved on the last launch', async () => {
    Storage.setItemSync(KEY, JSON.stringify({ state: { units: 'metric', trackSpacingM: { ...DEFAULT_FIX_SPACING_M, atv: 30 } }, version: 0 }));
    await store.persist.rehydrate();
    expect(store.getState().trackSpacingM.atv).toBe(30);
    expect(store.getState().units).toBe('metric');
  });

  it('fills in the defaults for settings saved before spacing existed', async () => {
    Storage.setItemSync(KEY, JSON.stringify({ state: { units: 'metric' }, version: 0 }));
    await store.persist.rehydrate();
    expect(store.getState().trackSpacingM).toEqual(DEFAULT_FIX_SPACING_M);
  });

  it('ignores corrupt saved values instead of passing them to the GPS', async () => {
    Storage.setItemSync(
      KEY,
      JSON.stringify({ state: { trackSpacingM: { foot: 'lots', horse: null, bike: 0, atv: 5000, vehicle: 40, jetpack: 3 } }, version: 0 })
    );
    await store.persist.rehydrate();
    expect(store.getState().trackSpacingM).toEqual({
      ...DEFAULT_FIX_SPACING_M, // foot and horse were not numbers
      bike: 1, // clamped
      atv: 100, // clamped
      vehicle: 40,
    });
    expect(store.getState().trackSpacingM).not.toHaveProperty('jetpack');
  });
});

describe('sanitizeSpacing', () => {
  it('gives the defaults for anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 5, [1, 2]]) expect(sanitizeSpacing(bad)).toEqual(DEFAULT_FIX_SPACING_M);
  });

  it('drops non-finite numbers', () => {
    expect(sanitizeSpacing({ foot: Infinity, horse: NaN })).toEqual(DEFAULT_FIX_SPACING_M);
  });
});
