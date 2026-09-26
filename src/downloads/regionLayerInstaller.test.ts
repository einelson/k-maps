import type { RegionEntry, RegionLayerPacks } from '../packs/regionPacks.ts';
import { installRegionLayer } from './regionLayerInstaller';

const mockInstall = jest.fn();
jest.mock('./regionPackInstaller', () => ({
  installRegionPack: (options: unknown) => mockInstall(options),
}));

const db: any = {};
const region: RegionEntry = { id: 'test', name: 'Test', cells: [[1, 1]], packs: [] };
const layer = (sizes: number[]): RegionLayerPacks => ({
  layer: 'osm',
  files: sizes.map((bytes, i) => ({ layer: 'osm' as const, file: `osm-${i + 1}.zip`, bytes, version: 'v1' })),
  bytes: sizes.reduce((a, b) => a + b, 0),
  version: 'v1',
});

beforeEach(() => mockInstall.mockReset());

describe('installRegionLayer', () => {
  it('installs the parts one after another', async () => {
    const order: string[] = [];
    mockInstall.mockImplementation(async ({ pack }) => void order.push(pack.file));
    await installRegionLayer({ appDb: db, region, packs: layer([40, 60]) });
    expect(order).toEqual(['osm-1.zip', 'osm-2.zip']);
  });

  it('reports one progress across the parts, weighted by size', async () => {
    const seen: number[] = [];
    mockInstall.mockImplementation(async ({ onProgress }) => {
      onProgress(0.5);
      onProgress(1);
    });
    await installRegionLayer({ appDb: db, region, packs: layer([40, 60]), onProgress: (f) => seen.push(f) });
    expect(seen).toEqual([0.2, 0.4, 0.4 + 0.3, 1]);
  });

  it('stops at the first part that fails', async () => {
    mockInstall.mockRejectedValueOnce(new Error('pack is incomplete'));
    await expect(installRegionLayer({ appDb: db, region, packs: layer([1, 1]) })).rejects.toThrow('incomplete');
    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it('hands the abort signal and manifest address through', async () => {
    const signal = new AbortController().signal;
    await installRegionLayer({ appDb: db, region, packs: layer([1]), signal, manifestUrl: 'https://x.test/m.json' });
    expect(mockInstall).toHaveBeenCalledWith(expect.objectContaining({ signal, manifestUrl: 'https://x.test/m.json' }));
  });
});
