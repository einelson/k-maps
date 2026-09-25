import type { HuntUnitPackEntry } from '../packs/regionPacks';
import { resolveActiveSet, useHuntUnitStore } from './useHuntUnitStore';

// The store persists through expo-sqlite's key-value store, which jest can't load.
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));

const store = useHuntUnitStore;

const pack = (over: Partial<HuntUnitPackEntry> = {}): HuntUnitPackEntry => ({
  state: 'WY',
  name: 'Wyoming',
  agency: 'WGFD',
  regsUrl: 'https://example.test/regs',
  vintage: '2025–2026',
  file: 'hunt-wy.zip',
  bytes: 1000,
  version: 'v1',
  bbox: [-111, 41, -104, 45],
  unitCount: 4,
  sets: [
    { id: 'elk', label: 'Elk Hunt Areas', count: 2 },
    { id: 'deer', label: 'Deer Hunt Areas', count: 2 },
  ],
  ...over,
});

beforeEach(() => store.setState(store.getInitialState(), true));

describe('useHuntUnitStore', () => {
  it('records what the map needs to draw and describe a state with no network', () => {
    store.getState().markInstalled(pack(), 4321);
    expect(store.getState().installed.WY).toMatchObject({
      state: 'WY',
      name: 'Wyoming',
      agency: 'WGFD',
      regsUrl: 'https://example.test/regs',
      vintage: '2025–2026',
      bbox: [-111, 41, -104, 45],
      version: 'v1',
      bytes: 4321,
    });
    expect(store.getState().installed.WY.sets.map((s) => s.id)).toEqual(['elk', 'deer']);
    expect(store.getState().installed.WY.installedAt).toBeGreaterThan(0);
  });

  it('reinstalling replaces the record (an update) without touching other states', () => {
    store.getState().markInstalled(pack(), 1);
    store.getState().markInstalled(pack({ state: 'MT', name: 'Montana' }), 2);
    store.getState().markInstalled(pack({ version: 'v2' }), 3);
    expect(store.getState().installed.WY).toMatchObject({ version: 'v2', bytes: 3 });
    expect(store.getState().installed.MT.bytes).toBe(2);
  });

  it('removing a state forgets it and its chosen set, and only it', () => {
    store.getState().markInstalled(pack(), 1);
    store.getState().markInstalled(pack({ state: 'MT', name: 'Montana' }), 2);
    store.getState().setActiveSet('WY', 'deer');
    store.getState().setActiveSet('MT', 'elk');
    store.getState().markRemoved('WY');
    expect(Object.keys(store.getState().installed)).toEqual(['MT']);
    expect(store.getState().activeSets).toEqual({ MT: 'elk' });
  });

  it('starts with the disclaimer not yet accepted, and remembers acceptance', () => {
    expect(store.getState().disclaimerAccepted).toBe(false);
    store.getState().acceptDisclaimer();
    expect(store.getState().disclaimerAccepted).toBe(true);
  });

  it('acceptance survives removing every state (it is about the feature, not a state)', () => {
    store.getState().acceptDisclaimer();
    store.getState().markInstalled(pack(), 1);
    store.getState().markRemoved('WY');
    expect(store.getState().disclaimerAccepted).toBe(true);
  });

  it('remembers when the units were downloaded, for the card', () => {
    store.getState().markInstalled(pack({ fetchedAt: '2026-09-24T22:00:00.000Z' }), 1);
    expect(store.getState().installed.WY.fetchedAt).toBe('2026-09-24T22:00:00.000Z');
  });

  it('remembers accepted old-data notices per state, and merges later ones in', () => {
    store.getState().acceptStale({ MA: 'zone:2021-09-17' });
    store.getState().acceptStale({ ND: 'deer:2021-12-21' });
    expect(store.getState().staleAccepted).toEqual({ MA: 'zone:2021-09-17', ND: 'deer:2021-12-21' });
    store.getState().acceptStale({ MA: 'zone:2022-04-06' }); // a newer (still old) date replaces it
    expect(store.getState().staleAccepted.MA).toBe('zone:2022-04-06');
  });

  it('removing a state forgets its old-data acceptance so the next download asks again — and only that state', () => {
    store.getState().markInstalled(pack({ state: 'MA', name: 'Massachusetts' }), 1);
    store.getState().acceptStale({ MA: 'zone:2021-09-17', ND: 'deer:2021-12-21' });
    store.getState().markRemoved('MA');
    expect(store.getState().staleAccepted).toEqual({ ND: 'deer:2021-12-21' });
  });

  it('remembers the chosen set per state', () => {
    store.getState().setActiveSet('WY', 'deer');
    expect(store.getState().activeSets.WY).toBe('deer');
  });
});

describe('resolveActiveSet', () => {
  const info = { sets: [{ id: 'elk', label: 'Elk', count: 1 }, { id: 'deer', label: 'Deer', count: 1 }] };

  it('uses the chosen set when the state has it, else the first', () => {
    expect(resolveActiveSet(info, 'deer')).toBe('deer');
    expect(resolveActiveSet(info, undefined)).toBe('elk');
    // An update that dropped the chosen set falls back rather than drawing nothing.
    expect(resolveActiveSet(info, 'moose')).toBe('elk');
  });
});
