import Storage from 'expo-sqlite/kv-store';
import type { StateStorage } from 'zustand/middleware';

// expo-sqlite's key-value store is synchronous, so persisted state is in place before the
// first render — no flash of the wrong theme on launch.
export const kvStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => Storage.setItemSync(name, value),
  removeItem: (name) => {
    Storage.removeItemSync(name);
  },
};
