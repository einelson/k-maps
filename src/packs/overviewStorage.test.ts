/** overviewStorage against an in-memory fake of expo-file-system's class API. */

import {
  overviewFilesExist,
  overviewUri,
  pruneOverview,
  readOverviewMeta,
  writeOverviewBlock,
} from './overviewStorage.ts';

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const join = (parts: unknown[]) =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');

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
    list() {
      return [...files.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'))
        .map((uri) => new FakeFile(uri));
    }
  }
  class FakeFile {
    uri: string;
    name: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
      this.name = this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      if (!files.has(this.uri)) files.set(this.uri, '');
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
  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { document: { uri: 'file:///docs' } },
    __files: files,
    __dirs: dirs,
  };
});

const fake = jest.requireMock('expo-file-system') as { __files: Map<string, string>; __dirs: Set<string> };
const names = () => [...fake.__files.keys()].map((uri) => uri.slice(uri.lastIndexOf('/') + 1)).sort();

beforeEach(() => {
  fake.__files.clear();
  fake.__dirs.clear();
});

const json = { coarse: '{"c":1}', fine: '{"f":1}' };

describe('overviewStorage', () => {
  it('writes both levels and the meta for a block, and reads the meta back', async () => {
    writeOverviewBlock(12, 45, { stamp: '3:9:20', builtAt: 1000 }, json);

    expect(names()).toEqual(['12_45.1000.coarse.json', '12_45.1000.fine.json', '12_45.meta.json']);
    expect(await readOverviewMeta(12, 45)).toEqual({ stamp: '3:9:20', builtAt: 1000 });
    expect(overviewFilesExist(12, 45, 1000)).toBe(true);
    expect(overviewFilesExist(12, 45, 999)).toBe(false);
  });

  it('gives each build its own URI, so MapLibre re-reads a rebuilt block', () => {
    expect(overviewUri(12, 45, 1000, 'fine')).not.toBe(overviewUri(12, 45, 2000, 'fine'));
    expect(overviewUri(12, 45, 1000, 'fine')).toMatch(/12_45\.1000\.fine\.json$/);
    expect(overviewUri(12, 45, 1000, 'coarse')).not.toBe(overviewUri(12, 45, 1000, 'fine'));
  });

  it('removes the old build when a block is rebuilt, but not other blocks', () => {
    writeOverviewBlock(12, 45, { stamp: 'a', builtAt: 1000 }, json);
    writeOverviewBlock(13, 45, { stamp: 'b', builtAt: 1500 }, json);
    writeOverviewBlock(12, 45, { stamp: 'c', builtAt: 2000 }, json);

    expect(names()).toEqual([
      '12_45.2000.coarse.json',
      '12_45.2000.fine.json',
      '12_45.meta.json',
      '13_45.1500.coarse.json',
      '13_45.1500.fine.json',
      '13_45.meta.json',
    ]);
  });

  it('does not confuse blocks whose numbers start the same (1_2 and 11_2)', () => {
    writeOverviewBlock(1, 2, { stamp: 'a', builtAt: 1 }, json);
    writeOverviewBlock(11, 2, { stamp: 'b', builtAt: 2 }, json);
    writeOverviewBlock(1, 2, { stamp: 'c', builtAt: 3 }, json);
    expect(names()).toContain('11_2.2.fine.json');
  });

  it('has no meta for a block never built, or one that is unreadable', async () => {
    expect(await readOverviewMeta(1, 1)).toBeNull();
    writeOverviewBlock(1, 1, { stamp: 'a', builtAt: 1 }, json);
    for (const uri of fake.__files.keys()) if (uri.endsWith('.meta.json')) fake.__files.set(uri, 'not json');
    expect(await readOverviewMeta(1, 1)).toBeNull();
  });

  it('prunes the files of blocks that no longer have downloaded land', () => {
    writeOverviewBlock(12, 45, { stamp: 'a', builtAt: 1 }, json);
    writeOverviewBlock(13, 45, { stamp: 'b', builtAt: 2 }, json);

    pruneOverview(new Set(['13_45']));

    expect(names().every((name) => name.startsWith('13_45'))).toBe(true);
    expect(names()).toHaveLength(3);
  });

  it('pruning with nothing built yet is a no-op', () => {
    expect(() => pruneOverview(new Set())).not.toThrow();
  });
});
