/**
 * In-memory stand-in for expo-sqlite's key-value store, used by every test automatically (Jest picks up a
 * `__mocks__` folder next to node_modules). The real module needs the native SQLite runtime, and the app's
 * persisted stores (src/state/kvStorage.ts) load it as soon as they're imported. A test that wants its own
 * behaviour still gets it with `jest.mock('expo-sqlite/kv-store', factory)`.
 */
const disk = new Map<string, string>();

const Storage = {
  getItemSync: (key: string): string | null => disk.get(key) ?? null,
  setItemSync: (key: string, value: string): void => void disk.set(key, value),
  removeItemSync: (key: string): boolean => disk.delete(key),
};

export default Storage;
