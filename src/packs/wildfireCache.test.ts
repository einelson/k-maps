/** wildfireCache against an in-memory fake of expo-file-system's class API. */

import type { PackFeatureCollection } from './types.ts';
import { deleteWildfireSnapshot, readWildfireSnapshot, writeWildfireSnapshot } from './wildfireCache.ts';

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');

  class FakeDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create() {
      dirs.add(this.uri);
    }
  }
  class FakeFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, '');
    }
    write(content: string) {
      files.set(this.uri, content);
    }
    async text() {
      return files.get(this.uri) ?? '';
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return { Directory: FakeDirectory, File: FakeFile, Paths: { document: new FakeDirectory('file:///doc') }, __files: files };
});

const files = () => (jest.requireMock('expo-file-system') as any).__files as Map<string, string>;
const FILE_URI = 'file:///doc/live/wildfire.json';

const collection: PackFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Cascade' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    },
  ],
};

beforeEach(() => files().clear());

describe('wildfire snapshot cache', () => {
  it('round-trips the collection with the time it was fetched', async () => {
    writeWildfireSnapshot({ fetchedAt: 1_700_000_000_000, collection });
    expect(files().has(FILE_URI)).toBe(true);
    expect(await readWildfireSnapshot()).toEqual({ fetchedAt: 1_700_000_000_000, collection });
  });

  it('overwrites the previous snapshot', async () => {
    writeWildfireSnapshot({ fetchedAt: 1, collection });
    writeWildfireSnapshot({ fetchedAt: 2, collection: { type: 'FeatureCollection', features: [] } });
    expect(await readWildfireSnapshot()).toEqual({ fetchedAt: 2, collection: { type: 'FeatureCollection', features: [] } });
  });

  it('reads null when nothing was ever saved', async () => {
    expect(await readWildfireSnapshot()).toBeNull();
  });

  it('reads null for a corrupt or wrongly-shaped file instead of throwing', async () => {
    files().set(FILE_URI, '{ not json');
    expect(await readWildfireSnapshot()).toBeNull();
    files().set(FILE_URI, JSON.stringify({ fetchedAt: 'yesterday', collection }));
    expect(await readWildfireSnapshot()).toBeNull();
    files().set(FILE_URI, JSON.stringify({ fetchedAt: 5, collection: { type: 'Feature' } }));
    expect(await readWildfireSnapshot()).toBeNull();
  });

  it('delete removes it, and is a no-op when absent', async () => {
    writeWildfireSnapshot({ fetchedAt: 1, collection });
    deleteWildfireSnapshot();
    expect(await readWildfireSnapshot()).toBeNull();
    expect(() => deleteWildfireSnapshot()).not.toThrow();
  });
});
