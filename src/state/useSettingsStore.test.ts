import Storage from 'expo-sqlite/kv-store';

import { useSettingsStore } from './useSettingsStore';

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
