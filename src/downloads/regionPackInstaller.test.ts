import JSZip from 'jszip';

import { writePackCellText } from '../packs/packStorage.ts';
import { BUNDLED_CELL_RECT } from '../packs/region.ts';
import { cellEntryName, type RegionEntry, type RegionPackFile } from '../packs/regionPacks.ts';
import { installRegionPack } from './regionPackInstaller';

const mockCoverage = new Map<string, any>();
const mockTempFiles = new Map<string, Uint8Array>();
let mockDownload: (url: string, dest: { uri: string }, options: any) => Promise<void>;

jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    get exists() {
      return mockTempFiles.has(this.uri);
    }
    delete() {
      mockTempFiles.delete(this.uri);
    }
    async bytes() {
      return mockTempFiles.get(this.uri)!;
    }
    static downloadFileAsync = jest.fn((url: string, dest: FakeFile, options: unknown) => mockDownload(url, dest, options));
  }
  return { File: FakeFile, Paths: { cache: { uri: 'file:///cache' } } };
});
jest.mock('./coverageRepo', () => ({
  listCoverage: jest.fn(async () => [...mockCoverage.values()]),
  upsertCoverage: jest.fn(async (_db: unknown, row: any) => {
    mockCoverage.set(`${row.layer}/${row.cx}/${row.cy}`, {
      layer: row.layer,
      cell_x: row.cx,
      cell_y: row.cy,
      status: row.status,
      bytes: row.bytes,
      updated_at: Date.now(),
    });
  }),
}));
jest.mock('../packs/packStorage.ts', () => ({
  writePackCellText: jest.fn((_layer: string, _cx: number, _cy: number, json: string) => json.length),
}));

const db: any = { withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()) };
const MANIFEST_URL = 'https://example.test/data/manifest.json';
const BUILT_AT = '2026-09-25T00:00:00.000Z';

const fc = (name: string) => JSON.stringify({ type: 'FeatureCollection', features: [{ properties: { name } }] });

/** Cells well away from the bundled starter region. */
const outsideCells = (n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [100 + (i % 10), 100 + Math.floor(i / 10)]);

const region = (cells: [number, number][]): RegionEntry => ({ id: 'test', name: 'Test', cells, packs: [] });
const packFile = (layer: RegionPackFile['layer'] = 'land'): RegionPackFile => ({
  layer,
  file: `test-${layer}.zip`,
  bytes: 1000,
  version: BUILT_AT,
});

async function zipOf(cells: [number, number][], skip: [number, number][] = []): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [cx, cy] of cells) {
    if (skip.some(([sx, sy]) => sx === cx && sy === cy)) continue;
    zip.file(cellEntryName(cx, cy), fc(`${cx},${cy}`));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function serve(bytes: Uint8Array) {
  mockDownload = async (_url, dest, options) => {
    options.onProgress?.({ bytesWritten: bytes.length / 2, totalBytes: bytes.length });
    mockTempFiles.set(dest.uri, bytes);
    options.onProgress?.({ bytesWritten: bytes.length, totalBytes: bytes.length });
  };
}

const coverageOf = (layer: string, cx: number, cy: number) => mockCoverage.get(`${layer}/${cx}/${cy}`);

beforeEach(() => {
  mockCoverage.clear();
  mockTempFiles.clear();
  jest.clearAllMocks();
});

describe('installRegionPack', () => {
  it('downloads next to the manifest, writes every cell, records coverage, and cleans up', async () => {
    const cells = outsideCells(3);
    serve(await zipOf(cells));
    const progress: number[] = [];

    const result = await installRegionPack({
      appDb: db,
      region: region(cells),
      pack: packFile('mvum'),
      manifestUrl: MANIFEST_URL,
      onProgress: (f) => progress.push(f),
    });

    const File = jest.requireMock('expo-file-system').File;
    expect(File.downloadFileAsync.mock.calls[0][0]).toBe('https://example.test/data/test-mvum.zip');
    expect(writePackCellText).toHaveBeenCalledTimes(3);
    expect(writePackCellText).toHaveBeenCalledWith('mvum', 100, 100, fc('100,100'));
    for (const [cx, cy] of cells) {
      expect(coverageOf('mvum', cx, cy)).toMatchObject({ status: 'complete', bytes: fc(`${cx},${cy}`).length });
    }
    expect(result).toEqual({ cells: 3, bytes: 3 * fc('100,100').length, keptNewer: 0 });
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b)); // never goes backwards
    expect(mockTempFiles.size).toBe(0); // the temp zip is gone
  });

  it('installs one part of a split layer: only that part\'s cells, from that part\'s own zip', async () => {
    const all = outsideCells(6);
    const part = all.slice(2, 4);
    serve(await zipOf(part)); // the part's zip holds just its two cells
    const pack: RegionPackFile = { ...packFile('osm'), file: 'test-osm-2.zip', cells: part };

    const result = await installRegionPack({ appDb: db, region: region(all), pack, manifestUrl: MANIFEST_URL });

    const File = jest.requireMock('expo-file-system').File;
    expect(File.downloadFileAsync.mock.calls[0][0]).toBe('https://example.test/data/test-osm-2.zip');
    expect(writePackCellText).toHaveBeenCalledTimes(2);
    expect(coverageOf('osm', part[0][0], part[0][1])).toMatchObject({ status: 'complete' });
    expect(coverageOf('osm', all[0][0], all[0][1])).toBeUndefined();
    expect(result.cells).toBe(2);
  });

  it('a part that is missing one of its own cells is refused, though the region has plenty of others', async () => {
    const all = outsideCells(6);
    const part = all.slice(0, 3);
    serve(await zipOf(part, [part[1]]));
    const pack: RegionPackFile = { ...packFile('osm'), file: 'test-osm-1.zip', cells: part };

    await expect(installRegionPack({ appDb: db, region: region(all), pack, manifestUrl: MANIFEST_URL })).rejects.toThrow(
      /incomplete \(1 cells missing\)/
    );
    expect(writePackCellText).not.toHaveBeenCalled();
  });

  it('two parts of one layer use different temp files, so one cannot clobber the other', async () => {
    const all = outsideCells(4);
    const names: string[] = [];
    mockDownload = async (_url, dest) => {
      names.push(dest.uri);
      mockTempFiles.set(dest.uri, await zipOf(dest.uri.includes('-1') ? all.slice(0, 2) : all.slice(2)));
    };
    for (const [n, cells] of [[1, all.slice(0, 2)], [2, all.slice(2)]] as const) {
      await installRegionPack({
        appDb: db,
        region: region(all),
        pack: { ...packFile('osm'), file: `test-osm-${n}.zip`, cells: cells as [number, number][] },
        manifestUrl: MANIFEST_URL,
      });
    }
    expect(new Set(names).size).toBe(2);
    expect(writePackCellText).toHaveBeenCalledTimes(4);
  });

  it('does not write bundled starter cells for land/mvum, but marks them covered; trails there are written', async () => {
    const { cxMin, cyMin } = BUNDLED_CELL_RECT;
    const cells: [number, number][] = [[cxMin, cyMin], ...outsideCells(1)];
    serve(await zipOf(cells));

    await installRegionPack({ appDb: db, region: region(cells), pack: packFile('land'), manifestUrl: MANIFEST_URL });
    expect(writePackCellText).toHaveBeenCalledTimes(1);
    expect(coverageOf('land', cxMin, cyMin)).toMatchObject({ status: 'complete', bytes: 0 });

    jest.clearAllMocks();
    serve(await zipOf(cells));
    await installRegionPack({ appDb: db, region: region(cells), pack: packFile('trails'), manifestUrl: MANIFEST_URL });
    expect(writePackCellText).toHaveBeenCalledTimes(2); // trails aren't bundled
    expect(coverageOf('trails', cxMin, cyMin).bytes).toBeGreaterThan(0);
  });

  it('keeps a cell the device fetched after the pack was built, and replaces an older one', async () => {
    const cells = outsideCells(2);
    serve(await zipOf(cells));
    const builtAt = Date.parse(BUILT_AT);
    mockCoverage.set('land/100/100', { layer: 'land', cell_x: 100, cell_y: 100, status: 'complete', bytes: 500, updated_at: builtAt + 1000 });
    mockCoverage.set('land/101/100', { layer: 'land', cell_x: 101, cell_y: 100, status: 'complete', bytes: 500, updated_at: builtAt - 1000 });

    const result = await installRegionPack({ appDb: db, region: region(cells), pack: packFile(), manifestUrl: MANIFEST_URL });

    expect(result.keptNewer).toBe(1);
    expect(writePackCellText).toHaveBeenCalledTimes(1);
    expect(writePackCellText).toHaveBeenCalledWith('land', 101, 100, fc('101,100'));
    expect(coverageOf('land', 100, 100).bytes).toBe(500); // untouched
  });

  it('writes nothing when the zip is missing cells the manifest promises', async () => {
    const cells = outsideCells(3);
    serve(await zipOf(cells, [cells[1]]));

    await expect(
      installRegionPack({ appDb: db, region: region(cells), pack: packFile(), manifestUrl: MANIFEST_URL })
    ).rejects.toThrow(/incomplete \(1 cells missing\)/);
    expect(writePackCellText).not.toHaveBeenCalled();
    expect(mockCoverage.size).toBe(0);
    expect(mockTempFiles.size).toBe(0);
  });

  it('reports a corrupt download (e.g. an HTML error page) without touching anything', async () => {
    serve(new TextEncoder().encode('<html>Not Found</html>'));
    await expect(
      installRegionPack({ appDb: db, region: region(outsideCells(1)), pack: packFile(), manifestUrl: MANIFEST_URL })
    ).rejects.toThrow(/didn't download correctly/);
    expect(writePackCellText).not.toHaveBeenCalled();
    expect(mockTempFiles.size).toBe(0);
  });

  it('propagates a failed download', async () => {
    mockDownload = async () => {
      throw new Error('Network request failed');
    };
    await expect(
      installRegionPack({ appDb: db, region: region(outsideCells(1)), pack: packFile(), manifestUrl: MANIFEST_URL })
    ).rejects.toThrow('Network request failed');
    expect(mockCoverage.size).toBe(0);
  });

  it('on abort between batches, keeps the batches already installed and throws an AbortError', async () => {
    const cells = outsideCells(45); // batches of 20 -> 20 + 20 + 5
    serve(await zipOf(cells));
    const controller = new AbortController();
    (writePackCellText as jest.Mock).mockImplementation((_l: string, _x: number, _y: number, json: string) => {
      if ((writePackCellText as jest.Mock).mock.calls.length === 20) controller.abort(); // mid first batch
      return json.length;
    });

    const run = installRegionPack({
      appDb: db,
      region: region(cells),
      pack: packFile(),
      manifestUrl: MANIFEST_URL,
      signal: controller.signal,
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(writePackCellText).toHaveBeenCalledTimes(20);
    expect(mockCoverage.size).toBe(20); // first batch flushed before the abort was noticed
    expect(mockTempFiles.size).toBe(0);
  });

  it('an already-aborted signal does nothing at all', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      installRegionPack({ appDb: db, region: region(outsideCells(1)), pack: packFile(), manifestUrl: MANIFEST_URL, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    const File = jest.requireMock('expo-file-system').File;
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
  });
});
