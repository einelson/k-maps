import type { CoverageRow } from '../data/types';
import { BUNDLED_CELL_RECT } from '../packs/region.ts';
import type { RegionEntry, RegionPackFile } from '../packs/regionPacks.ts';
import { regionPackStatus } from './regionPackStatus';

const cells: [number, number][] = [
  [100, 100],
  [101, 100],
  [102, 100],
];
const region: RegionEntry = { id: 'test', name: 'Test', cells, packs: [] };
const pack = (layer: RegionPackFile['layer'] = 'land'): RegionPackFile => ({ layer, file: 'x.zip', bytes: 1, version: 'v2' });

const row = (layer: string, cx: number, cy: number, status: CoverageRow['status'] = 'complete'): CoverageRow => ({
  layer,
  cell_x: cx,
  cell_y: cy,
  max_zoom: 0,
  status,
  bytes: 10,
  updated_at: 1,
});
const all = (layer: string) => cells.map(([cx, cy]) => row(layer, cx, cy));

describe('regionPackStatus', () => {
  it('none when no cell of the layer is covered', () => {
    expect(regionPackStatus(region, pack(), [], undefined)).toEqual({ state: 'none', covered: 0, total: 3 });
  });

  it('partial when only some cells are; other layers and unfinished rows do not count', () => {
    const coverage = [row('land', 100, 100), row('land', 101, 100, 'partial'), row('mvum', 102, 100), row('land', 102, 100, 'failed')];
    expect(regionPackStatus(region, pack('land'), coverage, undefined)).toEqual({ state: 'partial', covered: 1, total: 3 });
  });

  it('installed when every cell is covered and the version matches', () => {
    expect(regionPackStatus(region, pack(), all('land'), 'v2')).toEqual({ state: 'installed', covered: 3, total: 3 });
  });

  it('installed when fully covered by cells that did not come from a pack (no recorded version)', () => {
    expect(regionPackStatus(region, pack(), all('land'), undefined).state).toBe('installed');
  });

  it('update when fully covered but a different version was installed', () => {
    expect(regionPackStatus(region, pack(), all('land'), 'v1').state).toBe('update');
  });

  it('counts bundled starter cells as covered for land/mvum but not trails', () => {
    const { cxMin, cyMin } = BUNDLED_CELL_RECT;
    const bundledRegion: RegionEntry = { ...region, cells: [[cxMin, cyMin], [100, 100]] };
    expect(regionPackStatus(bundledRegion, pack('land'), [], undefined)).toEqual({ state: 'partial', covered: 1, total: 2 });
    expect(regionPackStatus(bundledRegion, pack('trails'), [], undefined)).toEqual({ state: 'none', covered: 0, total: 2 });
  });
});
