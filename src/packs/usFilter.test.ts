import { cellBounds } from '../downloads/cells.ts';
import type { Bounds, PackFeature } from './types.ts';
import { createUsCoverage, encodeMultiPolygon, type UsCellData } from './usCoverage.ts';
import { emptyCollection, restrictToUs, usEdgeLand, usRestriction } from './usFilter.ts';

const CELL = cellBounds(10, 20) as Bounds;
const [W, S, E, N] = CELL;
const MID = (W + E) / 2;
/** Cell 10,20 is a border cell whose west half is US; 5,20 is wholly inside; everything else is outside. */
const us = createUsCoverage({
  version: 1,
  source: 'test',
  rows: { '20': [5, 5] },
  edges: {
    '10_20': encodeMultiPolygon(
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
      CELL
    ),
  },
} as UsCellData);

const line = (...coords: [number, number][]): PackFeature => ({
  type: 'Feature',
  properties: { name: 'x' },
  geometry: { type: 'LineString', coordinates: coords },
});
const point = (lon: number, lat: number): PackFeature => ({
  type: 'Feature',
  properties: { category: 'camp' },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});
const inWest = (dx: number, lat = (S + N) / 2): [number, number] => [W + dx, lat];
const inEast = (dx: number, lat = (S + N) / 2): [number, number] => [E - dx, lat];

describe('usRestriction', () => {
  it('skips a cell with no US land', () => {
    expect(usRestriction(cellBounds(11, 20) as Bounds, us)).toEqual({ skip: true, contains: null });
  });

  it('leaves a cell wholly inside the US alone', () => {
    expect(usRestriction(cellBounds(5, 20) as Bounds, us)).toEqual({ skip: false, contains: null });
  });

  it('limits a coast or border cell to its US land', () => {
    const { skip, contains } = usRestriction(CELL, us);
    expect(skip).toBe(false);
    expect(contains?.(...inWest(0.01))).toBe(true);
    expect(contains?.(...inEast(0.01))).toBe(false);
  });

  it('cannot judge anything but a whole cell, so leaves other boxes and missing data unrestricted', () => {
    expect(usRestriction([-116.3, 43.6, -116.1, 43.7], us)).toEqual({ skip: false, contains: null });
    expect(usRestriction(cellBounds(11, 20) as Bounds, undefined)).toEqual({ skip: false, contains: null });
  });
});

describe('usEdgeLand', () => {
  it('gives the US part of a border cell, and nothing for other cells or boxes', () => {
    expect(usEdgeLand(CELL, us)?.type).toBe('MultiPolygon');
    expect(usEdgeLand(cellBounds(5, 20) as Bounds, us)).toBeUndefined();
    expect(usEdgeLand(cellBounds(11, 20) as Bounds, us)).toBeUndefined();
    expect(usEdgeLand([-116.3, 43.6, -116.1, 43.7], us)).toBeUndefined();
    expect(usEdgeLand(CELL, undefined)).toBeUndefined();
  });
});

describe('restrictToUs', () => {
  const { contains } = usRestriction(CELL, us);

  it('keeps points on US land and drops the rest', () => {
    const kept = restrictToUs([point(...inWest(0.01)), point(...inEast(0.01))], contains!);
    expect(kept).toHaveLength(1);
    expect(kept[0].geometry).toEqual({ type: 'Point', coordinates: inWest(0.01) });
  });

  it('keeps a line that stays in the US untouched', () => {
    const feature = line(inWest(0.01), inWest(0.05), inWest(0.09));
    expect(restrictToUs([feature], contains!)).toEqual([feature]);
  });

  it('drops a line that never touches the US', () => {
    expect(restrictToUs([line(inEast(0.01), inEast(0.05))], contains!)).toEqual([]);
  });

  it('cuts a line where it leaves the US, keeping its properties', () => {
    const [cut] = restrictToUs([line(inWest(0.02), inWest(0.05), inEast(0.05), inEast(0.02))], contains!);
    expect(cut.properties).toEqual({ name: 'x' });
    expect(cut.geometry).toEqual({ type: 'LineString', coordinates: [inWest(0.02), inWest(0.05)] });
  });

  it('splits a line that leaves and comes back into a MultiLineString', () => {
    const [cut] = restrictToUs(
      [line(inWest(0.01), inWest(0.02), inEast(0.02), inEast(0.03), inWest(0.03), inWest(0.04))],
      contains!
    );
    expect(cut.geometry.type).toBe('MultiLineString');
    expect((cut.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2);
  });

  it('a single vertex in the US is not a line', () => {
    expect(restrictToUs([line(inWest(0.02), inEast(0.02), inEast(0.03))], contains!)).toEqual([]);
  });

  it('empty collection is a valid empty result', () => {
    expect(emptyCollection()).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
