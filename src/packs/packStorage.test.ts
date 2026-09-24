/** packStorage against an in-memory fake of expo-file-system's class API. */

import type { FeatureCollection } from 'geojson';

import {
  deletePackCell,
  deletePackLayer,
  listPackCells,
  packCellUri,
  packLayerBytes,
  PACKS_DIRECTORY,
  writePackCell,
} from './packStorage.ts';

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>(); // uri -> content
  const dirs = new Set<string>();
  const join = (parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .join('/');

  class FakeDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return dirs.has(this.uri);
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    create() {
      dirs.add(this.uri);
    }
    delete() {
      for (const key of [...files.keys()]) if (key.startsWith(`${this.uri}/`)) files.delete(key);
      for (const key of [...dirs]) if (key === this.uri || key.startsWith(`${this.uri}/`)) dirs.delete(key);
    }
    list() {
      return [...files.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'))
        .map((uri) => new FakeFile(uri));
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
    get name() {
      return this.uri.split('/').pop()!;
    }
    get size() {
      return files.has(this.uri) ? new TextEncoder().encode(files.get(this.uri)!).length : 0;
    }
    create() {
      files.set(this.uri, '');
    }
    write(content: string) {
      files.set(this.uri, content);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { document: new FakeDirectory('file:///doc') },
    __files: files,
  };
});

const fc: FeatureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { name: 'café' }, geometry: { type: 'Point', coordinates: [1, 2] } }],
};

describe('packStorage', () => {
  beforeEach(() => {
    deletePackLayer('land');
    deletePackLayer('osm');
  });

  it('packCellUri is a file:// URI under packs/<layer>/<cx>_<cy>.json', () => {
    expect(PACKS_DIRECTORY.uri).toBe('file:///doc/packs');
    expect(packCellUri('land', 181, 373)).toBe('file:///doc/packs/land/181_373.json');
    expect(packCellUri('osm', 5, 7)).toMatch(/^file:\/\/.*\/packs\/osm\/5_7\.json$/);
  });

  it('writePackCell writes JSON and returns its byte size', () => {
    const bytes = writePackCell('land', 181, 373, fc);
    const stored = (jest.requireMock('expo-file-system') as any).__files.get(packCellUri('land', 181, 373));
    expect(JSON.parse(stored)).toEqual(fc);
    expect(bytes).toBe(new TextEncoder().encode(JSON.stringify(fc)).length);
    expect(bytes).toBeGreaterThan(JSON.stringify(fc).length - 1); // 'é' is 2 bytes
  });

  it('lists cells, sums bytes, deletes one cell or the whole layer', () => {
    const a = writePackCell('land', 1, 2, fc);
    const b = writePackCell('land', 3, 4, fc);
    writePackCell('osm', 9, 9, fc);
    expect(listPackCells('land').sort((x, y) => x.cx - y.cx)).toEqual([
      { cx: 1, cy: 2 },
      { cx: 3, cy: 4 },
    ]);
    expect(packLayerBytes('land')).toBe(a + b);

    deletePackCell('land', 1, 2);
    expect(listPackCells('land')).toEqual([{ cx: 3, cy: 4 }]);

    deletePackLayer('land');
    expect(listPackCells('land')).toEqual([]);
    expect(packLayerBytes('land')).toBe(0);
    expect(listPackCells('osm')).toEqual([{ cx: 9, cy: 9 }]); // other layers untouched
  });

  it('rewriting a cell replaces it', () => {
    writePackCell('osm', 1, 1, fc);
    const bytes = writePackCell('osm', 1, 1, { type: 'FeatureCollection', features: [] });
    expect(packLayerBytes('osm')).toBe(bytes);
    expect(listPackCells('osm')).toHaveLength(1);
  });

  it('empty layers list nothing', () => {
    expect(listPackCells('poi')).toEqual([]);
    expect(packLayerBytes('poi')).toBe(0);
  });
});
