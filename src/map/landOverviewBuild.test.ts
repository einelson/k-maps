import type { FeatureCollection, Polygon } from 'geojson';

import { ensureOverviewBlock } from './landOverviewBuild';
import { overviewStamp, type WantedBlock } from './landOverview';

const mockCellText = new Map<string, string>();
let mockMeta: { stamp: string; builtAt: number } | null = null;
let mockFilesExist = true;
const mockWrites: { bx: number; by: number; meta: { stamp: string; builtAt: number }; json: Record<string, string> }[] =
  [];

jest.mock('../packs/packStorage', () => ({
  readPackCellText: jest.fn(async (_layer: string, cx: number, cy: number) => mockCellText.get(`${cx}_${cy}`) ?? null),
}));
jest.mock('../packs/overviewStorage', () => ({
  readOverviewMeta: jest.fn(async () => mockMeta),
  overviewFilesExist: jest.fn(() => mockFilesExist),
  writeOverviewBlock: jest.fn((bx: number, by: number, meta: any, json: any) => {
    mockWrites.push({ bx, by, meta, json });
    mockMeta = meta;
  }),
}));

const square = (x: number, y: number, size = 0.2): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});
const cellText = (kinds: string[] = ['public', 'private']) =>
  JSON.stringify({
    type: 'FeatureCollection',
    features: kinds.map((kind, i) => ({
      type: 'Feature',
      properties: { kind, Pub_Access: 'OA', Unit_Nm: 'x' },
      geometry: square(-116.3 + i * 0.05, 43.5),
    })),
  });

const wanted = (cells: { cx: number; cy: number; updatedAt?: number }[]): WantedBlock => {
  const full = cells.map((c) => ({ ...c, updatedAt: c.updatedAt ?? 100 }));
  return { block: { bx: 12, by: 45 }, cells: full, stamp: overviewStamp(full) };
};
const written = (n = 0) => ({
  coarse: JSON.parse(mockWrites[n].json.coarse) as FeatureCollection,
  fine: JSON.parse(mockWrites[n].json.fine) as FeatureCollection,
});

beforeEach(() => {
  mockCellText.clear();
  mockWrites.length = 0;
  mockMeta = null;
  mockFilesExist = true;
  jest.clearAllMocks();
});

describe('ensureOverviewBlock', () => {
  it('builds both levels of a block from its downloaded cells and records what it was built from', async () => {
    mockCellText.set('96_360', cellText());
    mockCellText.set('97_360', cellText(['public']));
    const want = wanted([
      { cx: 96, cy: 360 },
      { cx: 97, cy: 360 },
    ]);

    const builtAt = await ensureOverviewBlock(want);

    expect(builtAt).not.toBeNull();
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0]).toMatchObject({ bx: 12, by: 45, meta: { stamp: want.stamp, builtAt } });
    // Two cells' worth of fills, joined — 3 features in all.
    expect(written().coarse.features).toHaveLength(3);
    expect(written().fine.features).toHaveLength(3);
    // Only what the fills need survives.
    expect(written().fine.features[0].properties).toEqual({ kind: 'public', Pub_Access: 'OA' });
  });

  it('does nothing when the files were built from these very cells', async () => {
    const want = wanted([{ cx: 96, cy: 360 }]);
    mockMeta = { stamp: want.stamp, builtAt: 555 };

    expect(await ensureOverviewBlock(want)).toBe(555);
    expect(mockWrites).toHaveLength(0);
  });

  it('rebuilds when the cells have changed since', async () => {
    mockCellText.set('96_360', cellText());
    const want = wanted([{ cx: 96, cy: 360, updatedAt: 200 }]);
    mockMeta = { stamp: overviewStamp([{ cx: 96, cy: 360, updatedAt: 100 }]), builtAt: 555 };

    const builtAt = await ensureOverviewBlock(want);

    expect(mockWrites).toHaveLength(1);
    expect(builtAt).not.toBe(555);
  });

  it('rebuilds when the files have gone missing even though the meta is current', async () => {
    mockCellText.set('96_360', cellText());
    const want = wanted([{ cx: 96, cy: 360 }]);
    mockMeta = { stamp: want.stamp, builtAt: 555 };
    mockFilesExist = false;

    await ensureOverviewBlock(want);
    expect(mockWrites).toHaveLength(1);
  });

  it('leaves out a cell whose file is missing or unreadable, and still finishes the block', async () => {
    mockCellText.set('96_360', cellText(['public']));
    mockCellText.set('97_360', '{ this is not json');
    const want = wanted([
      { cx: 96, cy: 360 },
      { cx: 97, cy: 360 },
      { cx: 98, cy: 360 }, // no file at all
    ]);

    expect(await ensureOverviewBlock(want)).not.toBeNull();
    expect(written().coarse.features).toHaveLength(1);
  });

  it('writes an empty block rather than none, so a block with nothing to show is not rebuilt every time', async () => {
    const want = wanted([{ cx: 96, cy: 360 }]);
    await ensureOverviewBlock(want);
    expect(written().coarse.features).toEqual([]);
    expect(mockMeta?.stamp).toBe(want.stamp);
  });

  it('runs one build for a block however many maps ask at once', async () => {
    mockCellText.set('96_360', cellText());
    const want = wanted([{ cx: 96, cy: 360 }]);
    const [a, b] = await Promise.all([ensureOverviewBlock(want), ensureOverviewBlock(want)]);
    expect(mockWrites).toHaveLength(1);
    expect(a).toBe(b);
  });

  it('says when real work starts, and not when the files were already there', async () => {
    const onBuild = jest.fn();
    const want = wanted([{ cx: 96, cy: 360 }]);
    mockMeta = { stamp: want.stamp, builtAt: 1 };
    await ensureOverviewBlock(want, onBuild);
    expect(onBuild).not.toHaveBeenCalled();

    mockMeta = null;
    await ensureOverviewBlock(want, onBuild);
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  it('gives null, not a crash, when the files cannot be written', async () => {
    const { writeOverviewBlock } = jest.requireMock('../packs/overviewStorage');
    writeOverviewBlock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCellText.set('96_360', cellText());

    expect(await ensureOverviewBlock(wanted([{ cx: 96, cy: 360 }]))).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
