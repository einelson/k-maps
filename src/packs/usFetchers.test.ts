/**
 * The fetchers only deal in US territory: a whole-cell fetch for a cell with no US land makes no request and returns
 * nothing, and in a cell that is only part US nothing outside the US is kept. Uses a made-up US: cell 180,373 is wholly
 * inside, cell 181,373 is a border cell whose west half is US, every other cell is outside.
 */
import { area } from '@turf/turf';

import { cellBounds } from '../downloads/cells.ts';
import { boundsToPolygon } from './clip.ts';
import { fetchLandPack } from './land.ts';
import { computeLikelyPrivate } from './likelyPrivate.ts';
import { fetchMvumPack } from './mvum.ts';
import { fetchOsmRoadsPack } from './osm.ts';
import { fetchPoiPack } from './poi.ts';
import { jsonResponse, mockFetch } from './testUtils.ts';
import { fetchTrailsPack } from './trails.ts';
import type { Bounds, PackFeature } from './types.ts';
import { createUsCoverage, encodeMultiPolygon, type UsCellData } from './usCoverage.ts';

const OUTSIDE = cellBounds(182, 373) as Bounds;
const INSIDE = cellBounds(180, 373) as Bounds;
const BORDER = cellBounds(181, 373) as Bounds;
const [W, S, E, N] = BORDER;
const MID = (W + E) / 2;
const us = createUsCoverage({
  version: 1,
  source: 'test',
  rows: { '373': [180, 180] },
  edges: {
    '181_373': encodeMultiPolygon(
      [
        [
          [
            [W, S],
            [MID, S],
            [MID, N],
            [W, N],
            [W, S],
          ],
        ],
      ],
      BORDER
    ),
  },
} as UsCellData);

const m2 = (geometry: object) => area({ type: 'Feature', properties: {}, geometry } as never);
const cellArea = m2(boundsToPolygon(BORDER));

describe.each([
  ['land', fetchLandPack],
  ['MVUM', fetchMvumPack],
  ['USFS trails', fetchTrailsPack],
  ['POI', fetchPoiPack],
  ['OSM roads', fetchOsmRoadsPack],
] as const)('%s pack', (_name, fetchPack) => {
  it('makes no request and returns nothing for a cell with no US land', async () => {
    const { calls } = mockFetch(() => {
      throw new Error('should not be called');
    });
    const progress: number[] = [];

    const fc = await fetchPack(OUTSIDE, { us, onProgress: (f) => progress.push(f) });

    expect(fc).toEqual({ type: 'FeatureCollection', features: [] });
    expect(calls).toHaveLength(0);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('is not restricted without US data, or for a box that is not exactly one cell', async () => {
    const { calls } = mockFetch(() => jsonResponse({ type: 'FeatureCollection', features: [], elements: [] }));

    await fetchPack(OUTSIDE, {});
    await fetchPack([-116.3, 43.6, -116.1, 43.7], { us });

    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('land pack in a border cell', () => {
  const noPublicLand = () => jsonResponse({ type: 'FeatureCollection', features: [] });

  it('shades only the US half as likely private', async () => {
    mockFetch(noPublicLand);

    const fc = await fetchLandPack(BORDER, { us });

    const privateFeatures = fc.features.filter((f: PackFeature) => f.properties?.kind === 'private');
    expect(privateFeatures.length).toBeGreaterThan(0);
    const total = privateFeatures.reduce((sum, f) => sum + m2(f.geometry), 0);
    expect(total / cellArea).toBeCloseTo(0.5, 2);
    for (const f of privateFeatures) {
      const g = f.geometry as { coordinates: number[][][] };
      for (const [lon] of g.coordinates[0]) expect(lon).toBeLessThanOrEqual(MID + 1e-6);
    }
  });

  it('shades a cell wholly inside the US in full', async () => {
    mockFetch(noPublicLand);

    const fc = await fetchLandPack(INSIDE, { us });

    const total = fc.features
      .filter((f: PackFeature) => f.properties?.kind === 'private')
      .reduce((s, f) => s + m2(f.geometry), 0);
    expect(total / m2(boundsToPolygon(INSIDE))).toBeCloseTo(1, 2);
  });
});

describe('computeLikelyPrivate with a land limit', () => {
  const land = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [W, S],
        [MID, S],
        [MID, N],
        [W, N],
        [W, S],
      ],
    ],
  };
  const box = (w: number, s: number, e: number, n: number) => ({
    type: 'Polygon' as const,
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });
  const total = (polygons: object[]) => polygons.reduce<number>((sum, g) => sum + m2(g), 0);

  it('starts from the land instead of the whole cell', async () => {
    const out = await computeLikelyPrivate(BORDER, [], { land });
    expect(total(out) / cellArea).toBeCloseTo(0.5, 3);
  });

  it('still subtracts public land, and ignores public land outside the limit', async () => {
    const north = (S + N) / 2;
    const publicInLand = box(W, S, MID, north); // the south half of the US half
    const publicOutside = box(MID, S, E, N); // wholly in the non-US half
    const out = await computeLikelyPrivate(BORDER, [publicInLand, publicOutside], { land });
    expect(total(out) / cellArea).toBeCloseTo(0.25, 2);
  });

  it('infers nothing when the land is entirely covered by public land', async () => {
    expect(await computeLikelyPrivate(BORDER, [box(W - 1, S - 1, MID + 0.1, N + 1)], { land })).toEqual([]);
  });

  it('infers nothing when the land does not reach the cell', async () => {
    const elsewhere = box(E + 1, N + 1, E + 2, N + 2);
    expect(await computeLikelyPrivate(BORDER, [], { land: elsewhere })).toEqual([]);
  });

  it('splits into quadrants without changing the area', async () => {
    const many = Array.from({ length: 40 }, (_, i) => {
      const x = W + 0.005 + (i % 8) * 0.01;
      const y = S + 0.005 + Math.floor(i / 8) * 0.03;
      return box(x, y, x + 0.006, y + 0.02);
    });
    const whole = await computeLikelyPrivate(BORDER, many, { land, maxLeafVertices: 1e9 });
    const split = await computeLikelyPrivate(BORDER, many, { land, maxLeafVertices: 10 });
    expect(total(split)).toBeCloseTo(total(whole), -3);
  });
});

describe('POI and OSM in a border cell', () => {
  it('drops points in the non-US half', async () => {
    mockFetch(() =>
      jsonResponse({
        elements: [
          { type: 'node', id: 1, lat: S + 0.1, lon: W + 0.05, tags: { leisure: 'slipway', name: 'US ramp' } },
          { type: 'node', id: 2, lat: S + 0.1, lon: E - 0.05, tags: { leisure: 'slipway', name: 'Foreign ramp' } },
        ],
      })
    );

    const fc = await fetchPoiPack(BORDER, { us });

    const names = fc.features.map((f: PackFeature) => f.properties?.name);
    expect(names).toContain('US ramp');
    expect(names).not.toContain('Foreign ramp');
  });

  it('cuts roads where they cross the border', async () => {
    const road = {
      type: 'way',
      id: 7,
      tags: { highway: 'primary', name: 'Border Hwy' },
      geometry: [
        { lat: S + 0.1, lon: W + 0.05 },
        { lat: S + 0.1, lon: W + 0.1 },
        { lat: S + 0.1, lon: E - 0.1 },
        { lat: S + 0.1, lon: E - 0.05 },
      ],
    };
    mockFetch(() => jsonResponse({ elements: [road] }));

    const fc = await fetchOsmRoadsPack(BORDER, { us });

    expect(fc.features).toHaveLength(1);
    const g = fc.features[0].geometry as { type: string; coordinates: number[][] };
    expect(g.type).toBe('LineString');
    for (const [lon] of g.coordinates) expect(lon).toBeLessThanOrEqual(MID);
  });
});
