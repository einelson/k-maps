import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import { cellBounds, lonLatToCell } from '../downloads/cells';
import { BUNDLED_CELL_RECT } from '../packs/region';
import { PUBLIC_LAND_DATA } from './landSource';
import {
  OVERVIEW_BLOCK_CELLS,
  OVERVIEW_LEVELS,
  overviewBlockKey,
  overviewBlockOf,
  overviewBlocksFor,
  overviewFeatures,
  overviewLevelFor,
  overviewStamp,
  sameWanted,
  type CellBox,
  type LandCellRef,
} from './landOverview';

const box: CellBox = [0, 0, 1, 1];
const feature = (kind: string, geometry: Polygon | MultiPolygon, extra: Record<string, unknown> = {}) => ({
  type: 'Feature' as const,
  properties: { kind, ...extra },
  geometry,
});
const collection = (...features: ReturnType<typeof feature>[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

/** A wiggly ring: a square with lots of tiny bumps along the bottom edge (half-way up the cell, off its edge). */
function bumpy(step: number): Polygon {
  const bottom: [number, number][] = [];
  for (let x = 0.1; x <= 0.9; x += step) bottom.push([x, 0.1 + (bottom.length % 2 === 0 ? 0 : step / 4)]);
  const ring: [number, number][] = [...bottom, [0.9, 0.9], [0.1, 0.9], bottom[0]];
  return { type: 'Polygon', coordinates: [ring] };
}
const vertexCount = (polygon: Polygon | MultiPolygon) => JSON.stringify(polygon.coordinates).split('],[').length;

describe('overviewLevelFor', () => {
  it('uses the coarse level for state-sized views and the fine one for county-sized', () => {
    expect(overviewLevelFor(5)).toBe('coarse');
    expect(overviewLevelFor(6.9)).toBe('coarse');
    expect(overviewLevelFor(7.5)).toBe('fine');
    expect(overviewLevelFor(8.9)).toBe('fine');
  });

  it('is not used far out, or from zoom 9 in where the detailed cells draw', () => {
    expect(overviewLevelFor(4.9)).toBeNull();
    expect(overviewLevelFor(9)).toBeNull();
    expect(overviewLevelFor(12)).toBeNull();
    expect(overviewLevelFor(Number.NaN)).toBeNull();
  });

  it('the two levels meet without a gap or an overlap', () => {
    expect(OVERVIEW_LEVELS.coarse.maxZoom).toBe(OVERVIEW_LEVELS.fine.minZoom);
    expect(OVERVIEW_LEVELS.fine.maxZoom).toBe(9);
  });
});

describe('overviewFeatures', () => {
  const square: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
        [0.1, 0.1],
      ],
    ],
  };

  it('keeps only the fills, and only what colours them', () => {
    const out = overviewFeatures(
      collection(
        feature('public', square, { Pub_Access: 'OA', Unit_Nm: 'A long name', Mang_Name: 'BLM' }),
        feature('private', square),
        {
          type: 'Feature',
          properties: { kind: 'outline', Pub_Access: 'OA' },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        } as never
      ),
      box,
      0.01
    );
    expect(out.map((f) => f.properties)).toEqual([{ kind: 'public', Pub_Access: 'OA' }, { kind: 'private' }]);
  });

  it('gives a public polygon with no access code the unknown-access colour rather than none', () => {
    const [out] = overviewFeatures(collection(feature('public', square)), box, 0.01);
    expect(out.properties).toEqual({ kind: 'public', Pub_Access: 'UK' });
  });

  it('thins a detailed ring, more the coarser the tolerance', () => {
    // A zigzag along the bottom edge: 0.02 high every 0.02 across.
    const bottom: [number, number][] = [];
    for (let i = 0; i <= 40; i++) bottom.push([Number((0.1 + i * 0.02).toFixed(3)), i % 2 === 0 ? 0.1 : 0.12]);
    const zigzag: Polygon = { type: 'Polygon', coordinates: [[...bottom, [0.9, 0.9], [0.1, 0.9], bottom[0]]] };
    const fine = overviewFeatures(collection(feature('public', zigzag)), box, 0.006)[0].geometry as Polygon;
    const coarse = overviewFeatures(collection(feature('public', zigzag)), box, 0.1)[0].geometry as Polygon;
    expect(vertexCount(coarse)).toBeLessThan(vertexCount(fine));
    expect(vertexCount(fine)).toBeLessThanOrEqual(vertexCount(zigzag));
  });

  it('flattens wiggles smaller than the tolerance into straight edges', () => {
    const [out] = overviewFeatures(collection(feature('public', bumpy(0.002))), box, 0.03);
    // A rectangle: four corners and the closing point.
    expect((out.geometry as Polygon).coordinates[0]).toHaveLength(5);
  });
  it('closes every ring it keeps', () => {
    const [out] = overviewFeatures(collection(feature('public', bumpy(0.002))), box, 0.03);
    const ring = (out.geometry as Polygon).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBeGreaterThanOrEqual(4);
  });

  it('drops a polygon too small to see at this scale, and a hole too small to see', () => {
    const speck: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0.5, 0.5],
          [0.5005, 0.5],
          [0.5005, 0.5005],
          [0.5, 0.5005],
          [0.5, 0.5],
        ],
      ],
    };
    expect(overviewFeatures(collection(feature('public', speck)), box, 0.01)).toEqual([]);

    const withPinhole: Polygon = {
      type: 'Polygon',
      coordinates: [square.coordinates[0], speck.coordinates[0]],
    };
    const [out] = overviewFeatures(collection(feature('private', withPinhole)), box, 0.01);
    expect((out.geometry as Polygon).coordinates).toHaveLength(1);
  });

  it('thins each polygon of a multipolygon and drops the ones that vanish', () => {
    const multi: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        square.coordinates,
        [
          [
            [0.5, 0.5],
            [0.5005, 0.5],
            [0.5005, 0.5005],
            [0.5, 0.5005],
            [0.5, 0.5],
          ],
        ],
      ],
    };
    const [out] = overviewFeatures(collection(feature('public', multi, { Pub_Access: 'OA' })), box, 0.01);
    expect(out.geometry.type).toBe('MultiPolygon');
    expect((out.geometry as MultiPolygon).coordinates).toHaveLength(1);
  });

  it('leaves the shared border of two polygons in the same place for both, so no gap opens between them', () => {
    // A jagged border, walked up by the public polygon on its left and back down by the private one on its right.
    const border: [number, number][] = [];
    for (let i = 0; i <= 100; i++)
      border.push([Number((0.5 + 0.03 * Math.sin(i)).toFixed(5)), Number((0.1 + i * 0.008).toFixed(5))]);
    const left: Polygon = { type: 'Polygon', coordinates: [[[0.1, 0.1], ...border, [0.1, 0.9], [0.1, 0.1]]] };
    const right: Polygon = {
      type: 'Polygon',
      coordinates: [[[0.9, 0.1], [0.9, 0.9], ...[...border].reverse(), [0.9, 0.1]]],
    };
    for (const tolerance of [0.006, 0.03]) {
      const [a, b] = overviewFeatures(
        collection(feature('public', left, { Pub_Access: 'OA' }), feature('private', right)),
        box,
        tolerance
      );
      const onBorder = (polygon: Polygon) =>
        polygon.coordinates[0]
          .filter(([x, y]) => x > 0.3 && x < 0.7 && y > 0.1 && y < 0.9)
          .map(([x, y]) => `${x},${y}`)
          .sort();
      expect(onBorder(a.geometry as Polygon)).toEqual(onBorder(b.geometry as Polygon));
      expect(onBorder(a.geometry as Polygon).length).toBeGreaterThan(2);
    }
  });

  it('keeps vertices on the cell edge on the cell edge, and gives two neighbouring cells the same points along it', () => {
    const edgeYs = [0.1, 0.1301, 0.5, 0.7773, 0.9];
    const inA: Polygon = {
      type: 'Polygon',
      coordinates: [[[0.5, 0.1], ...edgeYs.map((y): [number, number] => [1, y]), [0.5, 0.9], [0.5, 0.1]]],
    };
    const inB: Polygon = {
      type: 'Polygon',
      coordinates: [
        [[1.5, 0.1], [1.5, 0.9], ...[...edgeYs].reverse().map((y): [number, number] => [1, y]), [1.5, 0.1]],
      ],
    };
    for (const tolerance of [0.006, 0.05]) {
      const [a] = overviewFeatures(collection(feature('public', inA)), [0, 0, 1, 1], tolerance);
      const [b] = overviewFeatures(collection(feature('public', inB)), [1, 0, 2, 1], tolerance);
      const alongEdge = (f: { geometry: unknown }) =>
        (f.geometry as Polygon).coordinates[0]
          .filter(([x]) => x === 1)
          .map(([, y]) => y)
          .sort((p, q) => p - q);
      expect(alongEdge(a).length).toBeGreaterThan(1);
      expect(alongEdge(a)).toEqual(alongEdge(b));
    }
  });
  it('writes coordinates with at most four decimals, so the file is not full of 15-digit numbers', () => {
    const noisy: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0.123456789, 0.123456789],
          [0.923456789, 0.123456789],
          [0.923456789, 0.923456789],
          [0.123456789, 0.923456789],
          [0.123456789, 0.123456789],
        ],
      ],
    };
    const [out] = overviewFeatures(collection(feature('public', noisy)), [0.05, 0.05, 1.05, 1.05], 0.037);
    for (const [x, y] of (out.geometry as Polygon).coordinates[0]) {
      expect(String(x).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
      expect(String(y).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
    }
  });
  it('ignores features with no polygon geometry, and a collection with none at all', () => {
    expect(overviewFeatures({ type: 'FeatureCollection', features: [] }, box, 0.01)).toEqual([]);
    expect(
      overviewFeatures(
        collection({ type: 'Feature', properties: { kind: 'public' }, geometry: null } as never),
        box,
        0.01
      )
    ).toEqual([]);
  });
});

describe('overviewFeatures on real land data', () => {
  const nw = cellBounds(BUNDLED_CELL_RECT.cxMin, BUNDLED_CELL_RECT.cyMin);
  const se = cellBounds(BUNDLED_CELL_RECT.cxMax, BUNDLED_CELL_RECT.cyMax);
  const region: CellBox = [nw[0], se[1], se[2], nw[3]];
  const fills = PUBLIC_LAND_DATA.features.filter((f) => f.properties?.kind !== 'outline');
  const bytes = (features: unknown[]) => JSON.stringify(features).length;
  const cells =
    (BUNDLED_CELL_RECT.cxMax - BUNDLED_CELL_RECT.cxMin + 1) * (BUNDLED_CELL_RECT.cyMax - BUNDLED_CELL_RECT.cyMin + 1);

  it('the coarse level is a small fraction of the source and the fine level a moderate one', () => {
    const coarse = overviewFeatures(PUBLIC_LAND_DATA as FeatureCollection, region, OVERVIEW_LEVELS.coarse.tolerance);
    const fine = overviewFeatures(PUBLIC_LAND_DATA as FeatureCollection, region, OVERVIEW_LEVELS.fine.tolerance);
    expect(bytes(coarse)).toBeLessThan(bytes(fills) * 0.1);
    expect(bytes(fine)).toBeLessThan(bytes(fills) * 0.3);
    // The sizes the level budgets were set from: a few KB a cell coarse, tens fine.
    expect(bytes(coarse) / cells / 1024).toBeLessThan(6);
    expect(bytes(fine) / cells / 1024).toBeLessThan(25);
  });

  it('still has both kinds of fill, with valid closed rings', () => {
    const out = overviewFeatures(PUBLIC_LAND_DATA as FeatureCollection, region, OVERVIEW_LEVELS.coarse.tolerance);
    expect(new Set(out.map((f) => f.properties?.kind))).toEqual(new Set(['public', 'private']));
    for (const f of out) {
      const polygons =
        f.geometry.type === 'Polygon'
          ? [(f.geometry as Polygon).coordinates]
          : (f.geometry as MultiPolygon).coordinates;
      for (const rings of polygons) {
        for (const ring of rings) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
        }
      }
    }
  });
});

describe('overviewBlocksFor', () => {
  // Downloaded land in the four blocks around block (40, 46): 4 cells in each.
  const cellsIn = (bx: number, by: number, updatedAt = 100): LandCellRef[] => {
    const out: LandCellRef[] = [];
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        out.push({ cx: bx * OVERVIEW_BLOCK_CELLS + dx, cy: by * OVERVIEW_BLOCK_CELLS + dy, updatedAt });
    return out;
  };
  const view = (zoom: number, lon: number, lat: number) => {
    const half = 2 ** (10 - zoom) * 0.1;
    return {
      zoom,
      center: [lon, lat] as [number, number],
      bounds: [lon - half, lat - half / 2, lon + half, lat + half / 2] as [number, number, number, number],
    };
  };
  // Where the block (bx, by) is on the map, as a lon/lat, so views can be pointed at it.
  const lonLatOfBlock = (bx: number, by: number): [number, number] => {
    const [w, s, e, n] = cellBounds(bx * OVERVIEW_BLOCK_CELLS, by * OVERVIEW_BLOCK_CELLS);
    return [(w + e) / 2, (s + n) / 2];
  };
  it('wants nothing outside the zoom range: far out, or zoomed in where detailed cells draw', () => {
    const cells = cellsIn(40, 46);
    const [lon, lat] = lonLatOfBlock(40, 46);
    expect(overviewBlocksFor(view(4, lon, lat), cells)).toBeNull();
    expect(overviewBlocksFor(view(9, lon, lat), cells)).toBeNull();
    expect(overviewBlocksFor(view(12, lon, lat), cells)).toBeNull();
  });

  it('groups downloaded cells by block, with the level the zoom uses', () => {
    const cells = [...cellsIn(40, 46), ...cellsIn(41, 46)];
    const [lon, lat] = lonLatOfBlock(40, 46);
    const wanted = overviewBlocksFor(view(6, lon, lat), cells)!;
    expect(wanted.level).toBe('coarse');
    expect(wanted.blocks.map((w) => overviewBlockKey(w.block)).sort()).toEqual(['40_46', '41_46']);
    expect(wanted.blocks.every((w) => w.cells.length === 4)).toBe(true);
    expect(overviewBlocksFor(view(8, lon, lat), cells)!.level).toBe('fine');
  });

  it('nearest the centre first', () => {
    const cells = [...cellsIn(42, 46), ...cellsIn(40, 46), ...cellsIn(41, 46)];
    const [lon, lat] = lonLatOfBlock(40, 46);
    const keys = overviewBlocksFor(view(5, lon, lat), cells)!.blocks.map((w) => overviewBlockKey(w.block));
    expect(keys).toEqual(['40_46', '41_46', '42_46']);
  });

  it('leaves out blocks well away from the view, and blocks with nothing downloaded', () => {
    const cells = [...cellsIn(40, 46), ...cellsIn(60, 46)];
    const [lon, lat] = lonLatOfBlock(40, 46);
    const keys = overviewBlocksFor(view(7, lon, lat), cells)!.blocks.map((w) => overviewBlockKey(w.block));
    expect(keys).toEqual(['40_46']);
  });

  it('draws at most as many blocks as the level allows', () => {
    const cells: LandCellRef[] = [];
    for (let bx = 30; bx < 60; bx++) cells.push(...cellsIn(bx, 46));
    const [lon, lat] = lonLatOfBlock(45, 46);
    const wide = overviewBlocksFor(view(5, lon, lat), cells)!;
    expect(wide.blocks.length).toBeLessThanOrEqual(OVERVIEW_LEVELS.coarse.maxBlocks);
    const fine = overviewBlocksFor(view(8.5, lon, lat), cells)!;
    expect(fine.blocks.length).toBeLessThanOrEqual(OVERVIEW_LEVELS.fine.maxBlocks);
  });

  it('orders a block’s cells the same way every time, so its stamp and build are stable', () => {
    const cells = cellsIn(40, 46).reverse();
    const [lon, lat] = lonLatOfBlock(40, 46);
    const [a] = overviewBlocksFor(view(6, lon, lat), cells)!.blocks;
    const [b] = overviewBlocksFor(view(6, lon, lat), [...cells].reverse())!.blocks;
    expect(a.cells).toEqual(b.cells);
    expect(a.stamp).toBe(b.stamp);
  });

  it('finds a downloaded cell’s block from its cell coordinates', () => {
    const { cx: x, cy: y } = lonLatToCell(-116.2, 43.6);
    expect(overviewBlockOf(x, y)).toEqual({ bx: Math.floor(x / 8), by: Math.floor(y / 8) });
    expect(overviewBlockOf(7, 7)).toEqual({ bx: 0, by: 0 });
    expect(overviewBlockOf(8, 16)).toEqual({ bx: 1, by: 2 });
  });
});

describe('overviewStamp and sameWanted', () => {
  const cell = (cx: number, updatedAt: number): LandCellRef => ({ cx, cy: 0, updatedAt });

  it('changes when a cell is added, deleted or fetched again', () => {
    const base = overviewStamp([cell(1, 10), cell(2, 20)]);
    expect(overviewStamp([cell(1, 10), cell(2, 20)])).toBe(base);
    expect(overviewStamp([cell(1, 10)])).not.toBe(base);
    expect(overviewStamp([cell(1, 10), cell(2, 20), cell(3, 5)])).not.toBe(base);
    expect(overviewStamp([cell(1, 10), cell(2, 25)])).not.toBe(base);
  });

  it('tells whether two wanted lists ask for the same files', () => {
    const wanted = (stamp: string, level: 'coarse' | 'fine' = 'coarse') => ({
      level,
      blocks: [{ block: { bx: 1, by: 2 }, cells: [], stamp }],
    });
    expect(sameWanted(null, null)).toBe(true);
    expect(sameWanted(null, wanted('a'))).toBe(false);
    expect(sameWanted(wanted('a'), wanted('a'))).toBe(true);
    expect(sameWanted(wanted('a'), wanted('b'))).toBe(false);
    expect(sameWanted(wanted('a'), wanted('a', 'fine'))).toBe(false);
  });
});
