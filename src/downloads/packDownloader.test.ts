import { fetchLandPack } from '../packs/land.ts';
import { fetchOsmRoadsPack } from '../packs/osm.ts';
import { fetchTrailsPack } from '../packs/trails.ts';
import { deletePackCell, deletePackLayer, writePackCell } from '../packs/packStorage.ts';
import { BUNDLED_CELL_RECT } from '../packs/region.ts';
import { cellBounds } from './cells';
import { deletePackCellData, deletePackCells, deletePackData, downloadPackCell } from './packDownloader';

const mockCoverage = new Map<string, any>();

jest.mock('./coverageRepo', () => ({
  getCoverage: jest.fn(async (_db: unknown, layer: string, cx: number, cy: number) => mockCoverage.get(`${layer}/${cx}/${cy}`) ?? null),
  upsertCoverage: jest.fn(async (_db: unknown, row: any) => {
    mockCoverage.set(`${row.layer}/${row.cx}/${row.cy}`, { layer: row.layer, cell_x: row.cx, cell_y: row.cy, max_zoom: row.maxZoom, status: row.status, bytes: row.bytes });
  }),
  deleteCoverage: jest.fn(async (_db: unknown, layer: string, cx: number, cy: number) => {
    mockCoverage.delete(`${layer}/${cx}/${cy}`);
  }),
}));
jest.mock('../packs/packStorage.ts', () => ({
  writePackCell: jest.fn(() => 1234),
  deletePackLayer: jest.fn(),
  deletePackCell: jest.fn(),
}));
jest.mock('../packs/land.ts', () => ({ fetchLandPack: jest.fn() }));
jest.mock('../packs/mvum.ts', () => ({ fetchMvumPack: jest.fn() }));
jest.mock('../packs/poi.ts', () => ({ fetchPoiPack: jest.fn() }));
jest.mock('../packs/osm.ts', () => ({ fetchOsmRoadsPack: jest.fn() }));
jest.mock('../packs/trails.ts', () => ({ fetchTrailsPack: jest.fn() }));


const db: any = {
  runAsync: jest.fn(async () => undefined),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
};
const EMPTY = { type: 'FeatureCollection', features: [] };
const OUTSIDE = { cx: 100, cy: 100 };

const row = (layer: string, cx = OUTSIDE.cx, cy = OUTSIDE.cy) => mockCoverage.get(`${layer}/${cx}/${cy}`);

beforeEach(() => {
  mockCoverage.clear();
  jest.clearAllMocks();
});

describe('downloadPackCell', () => {
  it('fetches the cell bounds, writes the file, and records downloading -> complete with bytes', async () => {
    const statuses: string[] = [];
    (fetchLandPack as jest.Mock).mockImplementation(async (bounds, ctx) => {
      statuses.push(row('land').status);
      ctx.onProgress(0.5);
      ctx.onProgress(1);
      return EMPTY;
    });
    const progress: number[] = [];
    await downloadPackCell({ appDb: db, layer: 'land', ...OUTSIDE, onProgress: (f) => progress.push(f) });

    expect((fetchLandPack as jest.Mock).mock.calls[0][0]).toEqual(cellBounds(100, 100));
    expect(statuses).toEqual(['downloading']);
    expect(writePackCell).toHaveBeenCalledWith('land', 100, 100, EMPTY);
    expect(row('land')).toMatchObject({ status: 'complete', bytes: 1234, max_zoom: 0 });
    expect(progress[progress.length - 1]).toBe(1);
    expect(Math.max(...progress.slice(0, -1))).toBeLessThan(1);
  });

  it('marks bundled cells complete with 0 bytes without fetching (never for osm)', async () => {
    const { cxMin, cyMin } = BUNDLED_CELL_RECT;
    await downloadPackCell({ appDb: db, layer: 'land', cx: cxMin, cy: cyMin });
    expect(fetchLandPack).not.toHaveBeenCalled();
    expect(writePackCell).not.toHaveBeenCalled();
    expect(row('land', cxMin, cyMin)).toMatchObject({ status: 'complete', bytes: 0 });

    (fetchOsmRoadsPack as jest.Mock).mockResolvedValue(EMPTY);
    await downloadPackCell({ appDb: db, layer: 'osm', cx: cxMin, cy: cyMin });
    expect(fetchOsmRoadsPack).toHaveBeenCalledTimes(1);
  });

  it('trails packs are fetched even inside the bundled region (only land/mvum/poi ship with the app)', async () => {
    const { cxMin, cyMin } = BUNDLED_CELL_RECT;
    (fetchTrailsPack as jest.Mock).mockResolvedValue(EMPTY);
    await downloadPackCell({ appDb: db, layer: 'trails', cx: cxMin, cy: cyMin });
    expect(fetchTrailsPack).toHaveBeenCalledTimes(1);
    expect((fetchTrailsPack as jest.Mock).mock.calls[0][0]).toEqual(cellBounds(cxMin, cyMin));
    expect(writePackCell).toHaveBeenCalledWith('trails', cxMin, cyMin, EMPTY);
    expect(row('trails', cxMin, cyMin)).toMatchObject({ status: 'complete', bytes: 1234 });
  });

  it('records failed and rethrows on a fetch error', async () => {
    (fetchLandPack as jest.Mock).mockRejectedValue(new Error('HTTP 500'));
    await expect(downloadPackCell({ appDb: db, layer: 'land', ...OUTSIDE })).rejects.toThrow('HTTP 500');
    expect(row('land')).toMatchObject({ status: 'failed', bytes: 0 });
    expect(writePackCell).not.toHaveBeenCalled();
  });

  it('records failed when writing the file fails', async () => {
    (fetchLandPack as jest.Mock).mockResolvedValue(EMPTY);
    (writePackCell as jest.Mock).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(downloadPackCell({ appDb: db, layer: 'land', ...OUTSIDE })).rejects.toThrow('disk full');
    expect(row('land').status).toBe('failed');
  });

  it('records partial and resolves on abort', async () => {
    const controller = new AbortController();
    (fetchLandPack as jest.Mock).mockImplementation(async () => {
      controller.abort();
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(downloadPackCell({ appDb: db, layer: 'land', ...OUTSIDE, signal: controller.signal })).resolves.toBeUndefined();
    expect(row('land')).toMatchObject({ status: 'partial', bytes: 0 });
  });

  it('does not write if aborted after the fetch finished', async () => {
    const controller = new AbortController();
    (fetchLandPack as jest.Mock).mockImplementation(async () => {
      controller.abort();
      return EMPTY;
    });
    await downloadPackCell({ appDb: db, layer: 'land', ...OUTSIDE, signal: controller.signal });
    expect(writePackCell).not.toHaveBeenCalled();
    expect(row('land').status).toBe('partial');
  });

  it('an update that fails leaves a previously complete cell complete (old file is intact)', async () => {
    mockCoverage.set('land/100/100', { layer: 'land', cell_x: 100, cell_y: 100, max_zoom: 0, status: 'complete', bytes: 999 });
    (fetchLandPack as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(downloadPackCell({ appDb: db, layer: 'land', ...OUTSIDE })).rejects.toThrow('offline');
    expect(row('land')).toMatchObject({ status: 'complete', bytes: 999 });
  });
});

describe('deletePackData', () => {
  it('deletes the layer files and its coverage rows', async () => {
    await deletePackData(db, 'osm');
    expect(deletePackLayer).toHaveBeenCalledWith('osm');
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM coverage WHERE layer = ?', 'osm');
  });

  it('deletePackCellData removes one cell', async () => {
    mockCoverage.set('osm/5/6', { status: 'complete' });
    await deletePackCellData(db, 'osm', 5, 6);
    expect(deletePackCell).toHaveBeenCalledWith('osm', 5, 6);
    expect(mockCoverage.has('osm/5/6')).toBe(false);
  });
});

describe('deletePackCells', () => {
  it('removes each cell’s file and coverage row, and only those cells', async () => {
    mockCoverage.set('land/1/1', { status: 'complete' });
    mockCoverage.set('land/2/1', { status: 'complete' });
    mockCoverage.set('land/3/1', { status: 'complete' });
    mockCoverage.set('mvum/1/1', { status: 'complete' });

    await deletePackCells(db, 'land', [
      { cx: 1, cy: 1 },
      { cx: 2, cy: 1 },
    ]);

    expect(deletePackCell).toHaveBeenCalledTimes(2);
    expect(deletePackCell).toHaveBeenCalledWith('land', 1, 1);
    expect(mockCoverage.has('land/1/1')).toBe(false);
    expect(mockCoverage.has('land/2/1')).toBe(false);
    expect(mockCoverage.has('land/3/1')).toBe(true);
    expect(mockCoverage.has('mvum/1/1')).toBe(true);
  });

  it('works through a long list in several transactions', async () => {
    const cells = Array.from({ length: 120 }, (_, i) => ({ cx: i, cy: 0 }));
    await deletePackCells(db, 'osm', cells);
    expect(deletePackCell).toHaveBeenCalledTimes(120);
    expect(db.withTransactionAsync).toHaveBeenCalledTimes(3);
  });

  it('does nothing for an empty list', async () => {
    await deletePackCells(db, 'osm', []);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });
});
