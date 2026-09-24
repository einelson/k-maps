/**
 * mbtiles.ts touches expo-file-system at import time (`new Directory(...)`) and
 * expo-sqlite in every function, so both are replaced with in-memory fakes.
 * This covers path/URL shaping and the SQL parameters (notably the XYZ -> TMS
 * row flip); it cannot prove MapLibre or SQLite accept the resulting paths —
 * that needs a device (spec §12.1/§12.4).
 */

const mockFs = {
  /** What `Directory.uri` looks like: Android always ends directory URIs with "/". */
  trailingSlash: false,
  documentUri: 'file:///data/user/0/com.kmaps/files',
  exists: true,
  created: [] as unknown[],
  entries: [] as unknown[],
};

jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    name: string;
    constructor(...parts: (string | { uri: string })[]) {
      const joined = parts
        .map((p) => (typeof p === 'string' ? p : p.uri))
        .map((p) => p.replace(/\/+$/, ''))
        .join('/');
      this.uri = joined + (mockFs.trailingSlash ? '/' : '');
      this.name = joined.split('/').pop() ?? '';
    }
    get exists() {
      return mockFs.exists;
    }
    create(options: unknown) {
      mockFs.created.push(options);
    }
    list() {
      return mockFs.entries;
    }
  }
  class File {
    mockName: string;
    size: number | null;
    constructor(fileName: string, fileSize: number | null) {
      this.mockName = fileName;
      this.size = fileSize;
    }
    get name() {
      return this.mockName;
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document() {
        return new Directory(mockFs.documentUri);
      },
    },
  };
});

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

type MbtilesModule = typeof import('./mbtiles');

function loadMbtiles(options: { trailingSlash?: boolean; exists?: boolean } = {}) {
  mockFs.trailingSlash = options.trailingSlash ?? false;
  mockFs.exists = options.exists ?? true;
  mockFs.created = [];
  mockFs.entries = [];
  let mod!: MbtilesModule;
  let sqlite!: { openDatabaseAsync: jest.Mock };
  let fs!: { Directory: new (...args: string[]) => object; File: new (name: string, size: number | null) => object };
  /* eslint-disable @typescript-eslint/no-require-imports -- isolateModules needs synchronous require to re-run mbtiles.ts's module-level `new Directory(...)` per test */
  jest.isolateModules(() => {
    mod = require('./mbtiles');
    sqlite = require('expo-sqlite');
    fs = require('expo-file-system');
  });
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { mod, sqlite, fs };
}

function fakeDb() {
  return {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue(null),
  };
}

describe('mbtilesFileName', () => {
  it('is "<layer>.mbtiles"', () => {
    const { mod } = loadMbtiles();
    expect(mod.mbtilesFileName('topo')).toBe('topo.mbtiles');
    expect(mod.mbtilesFileName('satellite')).toBe('satellite.mbtiles');
    expect(mod.mbtilesFileName('osm')).toBe('osm.mbtiles');
  });
});

describe('localRasterTileUrl', () => {
  it('swaps file:// for mbtiles:// and appends the z/x/y template (XYZ order, TMS handled natively)', () => {
    const { mod } = loadMbtiles({ trailingSlash: false });
    expect(mod.localRasterTileUrl('topo')).toBe(
      'mbtiles:///data/user/0/com.kmaps/files/maps/topo.mbtiles/{z}/{x}/{y}'
    );
  });

  it('is layer specific', () => {
    const { mod } = loadMbtiles();
    expect(mod.localRasterTileUrl('satellite')).toContain('/satellite.mbtiles/');
    expect(mod.localRasterTileUrl('hybrid')).toContain('/hybrid.mbtiles/');
    expect(mod.localRasterTileUrl('topo')).not.toEqual(mod.localRasterTileUrl('satellite'));
  });

  it('never leaves a file:// scheme behind and only rewrites the leading scheme', () => {
    const { mod } = loadMbtiles();
    const url = mod.localRasterTileUrl('topo');
    expect(url.startsWith('mbtiles://')).toBe(true);
    expect(url).not.toContain('file:');
    expect(url.match(/mbtiles:\/\//g)).toHaveLength(1);
  });

  it('keeps the template placeholders MapLibre substitutes', () => {
    const { mod } = loadMbtiles();
    expect(mod.localRasterTileUrl('topo').endsWith('/{z}/{x}/{y}')).toBe(true);
  });

  // BUG (src/downloads/mbtiles.ts:117): expo-file-system's Directory.uri ends
  // with "/" on Android (FileSystemDirectory.asString() in the native module
  // appends one), but localRasterTileUrl() then adds its own "/", yielding
  // "…/maps//topo.mbtiles/{z}/{x}/{y}". POSIX tolerates the double slash when
  // opening, but MapLibre's mbtiles:// handler splits the URL path on the
  // .mbtiles suffix and it is not verified to normalise it. Proposed fix:
  //   const base = MAPS_DIRECTORY.uri.replace(/\/+$/, '');
  //   const fileUri = `${base}/${mbtilesFileName(layer)}`;
  it('does not produce a double slash when the directory URI ends with "/"', () => {
    const { mod } = loadMbtiles({ trailingSlash: true });
    expect(mod.localRasterTileUrl('topo')).not.toMatch(/[^:/]\/\/[^/]/);
    expect(mod.localRasterTileUrl('topo')).toBe(
      'mbtiles:///data/user/0/com.kmaps/files/maps/topo.mbtiles/{z}/{x}/{y}'
    );
  });
});

describe('openMBTiles', () => {
  it('creates the maps directory when it does not exist yet', async () => {
    const { mod, sqlite } = loadMbtiles({ exists: false });
    sqlite.openDatabaseAsync.mockResolvedValue(fakeDb());
    await mod.openMBTiles('topo');
    expect(mockFs.created).toEqual([{ intermediates: true, idempotent: true }]);
  });

  it('leaves an existing directory alone', async () => {
    const { mod, sqlite } = loadMbtiles({ exists: true });
    sqlite.openDatabaseAsync.mockResolvedValue(fakeDb());
    await mod.openMBTiles('topo');
    expect(mockFs.created).toEqual([]);
  });

  it('opens "<layer>.mbtiles" in the maps directory on the shared connection', async () => {
    const { mod, sqlite } = loadMbtiles();
    sqlite.openDatabaseAsync.mockResolvedValue(fakeDb());
    await mod.openMBTiles('hybrid');
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith(
      'hybrid.mbtiles',
      { useNewConnection: false },
      mod.MAPS_DIRECTORY.uri
    );
  });

  it('enables WAL and creates the MBTiles schema with a unique tile index', async () => {
    const { mod, sqlite } = loadMbtiles();
    const db = fakeDb();
    sqlite.openDatabaseAsync.mockResolvedValue(db);
    const returned = await mod.openMBTiles('topo');
    expect(returned).toBe(db);
    expect(db.execAsync).toHaveBeenCalledTimes(1);
    const sql: string = db.execAsync.mock.calls[0][0];
    expect(sql).toMatch(/PRAGMA journal_mode = WAL/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS metadata \(name TEXT, value TEXT\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS metadata_name_idx ON metadata \(name\)/);
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS tiles \(\s*zoom_level INTEGER,\s*tile_column INTEGER,\s*tile_row INTEGER,\s*tile_data BLOB\s*\)/
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS tiles_zxy_idx ON tiles \(zoom_level, tile_column, tile_row\)/
    );
  });
});

describe('setMetadata', () => {
  it('upserts one row per entry', async () => {
    const { mod } = loadMbtiles();
    const db = fakeDb();
    await mod.setMetadata(db as never, { name: 'topo', format: 'jpg', minzoom: '10' });
    expect(db.runAsync).toHaveBeenCalledTimes(3);
    const params = db.runAsync.mock.calls.map(([, ...rest]) => rest);
    expect(params).toEqual([
      ['name', 'topo'],
      ['format', 'jpg'],
      ['minzoom', '10'],
    ]);
    expect(db.runAsync.mock.calls[0][0]).toMatch(/ON CONFLICT\(name\) DO UPDATE SET value = excluded\.value/);
  });

  it('does nothing for an empty record', async () => {
    const { mod } = loadMbtiles();
    const db = fakeDb();
    await mod.setMetadata(db as never, {});
    expect(db.runAsync).not.toHaveBeenCalled();
  });
});

describe('tile rows use the TMS y flip', () => {
  it('hasTile queries the flipped row and reports presence', async () => {
    const { mod } = loadMbtiles();
    const db = fakeDb();
    db.getFirstAsync.mockResolvedValueOnce({ found: 1 });
    await expect(mod.hasTile(db as never, 3, 2, 0)).resolves.toBe(true);
    // z=3, y=0 (top row in XYZ) is the last row (7) in TMS.
    expect(db.getFirstAsync.mock.calls[0].slice(1)).toEqual([3, 2, 7]);

    db.getFirstAsync.mockResolvedValueOnce(null);
    await expect(mod.hasTile(db as never, 3, 2, 7)).resolves.toBe(false);
    expect(db.getFirstAsync.mock.calls[1].slice(1)).toEqual([3, 2, 0]);
  });

  it('putTile upserts the tile blob at the flipped row', async () => {
    const { mod } = loadMbtiles();
    const db = fakeDb();
    const data = new Uint8Array([1, 2, 3]);
    await mod.putTile(db as never, 12, 700, 1500, data);
    const [sql, ...params] = db.runAsync.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tiles/);
    expect(sql).toMatch(/ON CONFLICT\(zoom_level, tile_column, tile_row\) DO UPDATE SET tile_data = excluded\.tile_data/);
    expect(params).toEqual([12, 700, (1 << 12) - 1 - 1500, data]);
  });

  it('hasTile and putTile agree on the row for the same tile', async () => {
    const { mod } = loadMbtiles();
    const db = fakeDb();
    await mod.putTile(db as never, 14, 3000, 5000, new Uint8Array());
    await mod.hasTile(db as never, 14, 3000, 5000);
    expect(db.runAsync.mock.calls[0][3]).toBe(db.getFirstAsync.mock.calls[0][3]);
  });
});

describe('mbtilesByteSize', () => {
  it('returns the file size of the layer file', async () => {
    const { mod, fs } = loadMbtiles();
    mockFs.entries = [new fs.File('topo.mbtiles', 123456), new fs.File('satellite.mbtiles', 9)];
    await expect(mod.mbtilesByteSize('topo')).resolves.toBe(123456);
    await expect(mod.mbtilesByteSize('satellite')).resolves.toBe(9);
  });

  it('is 0 when the layer has not been downloaded', async () => {
    const { mod, fs } = loadMbtiles();
    mockFs.entries = [new fs.File('satellite.mbtiles', 9)];
    await expect(mod.mbtilesByteSize('topo')).resolves.toBe(0);
  });

  it('is 0 when the size is unknown', async () => {
    const { mod, fs } = loadMbtiles();
    mockFs.entries = [new fs.File('topo.mbtiles', null)];
    await expect(mod.mbtilesByteSize('topo')).resolves.toBe(0);
  });

  it('is 0 when a directory happens to carry the file name', async () => {
    const { mod, fs } = loadMbtiles();
    const dir = new fs.Directory('file:///x/topo.mbtiles') as { name: string };
    dir.name = 'topo.mbtiles';
    mockFs.entries = [dir];
    await expect(mod.mbtilesByteSize('topo')).resolves.toBe(0);
  });
});
