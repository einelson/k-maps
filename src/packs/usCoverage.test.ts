import usCellData from '../../assets/us/us-cells.json';
import { cellBounds, lonLatToCell } from '../downloads/cells.ts';
import { cellOfBounds, createUsCoverage, encodeMultiPolygon, GRID_STEPS, type UsCellData } from './usCoverage.ts';
import type { Bounds } from './types.ts';

const real = createUsCoverage(usCellData as unknown as UsCellData);
const statusAt = (lon: number, lat: number) => {
  const { cx, cy } = lonLatToCell(lon, lat);
  return real.status(cx, cy);
};

describe('the bundled US map (assets/us/us-cells.json)', () => {
  it.each([
    ['Boise', -116.2, 43.6, 'inside'],
    ['central Nevada', -116.9, 39.5, 'inside'],
    ['Kansas', -98.5, 38.5, 'inside'],
    ['Miami, on the coast', -80.19, 25.77, 'edge'],
    ['Seattle, on Puget Sound', -122.33, 47.6, 'edge'],
    ['Detroit, across the river from Canada', -83.05, 42.33, 'edge'],
    ['the Idaho panhandle, at the Canadian border', -116.5, 49.0, 'edge'],
    ['Calgary', -114.07, 51.05, 'outside'],
    ['Winnipeg', -97.14, 49.9, 'outside'],
    ['Monterrey, Mexico', -100.3, 25.7, 'outside'],
    ['the Pacific, 100 miles off California', -128.5, 40.5, 'outside'],
    ['the middle of Lake Michigan', -87.0, 43.5, 'outside'],
    ['the Gulf of Mexico', -90.0, 27.0, 'outside'],
  ])('%s is %s', (_name, lon, lat, expected) => {
    expect(statusAt(lon, lat)).toBe(expected);
  });

  it('knows Alaska and Hawaii', () => {
    expect(real.hasLand(...(Object.values(lonLatToCell(-134.4, 58.3)) as [number, number]))).toBe(true); // Juneau
    expect(real.contains(-149.9, 61.2)).toBe(true); // Anchorage
    expect(real.contains(-157.86, 21.31)).toBe(true); // Honolulu
    expect(real.contains(-175, 60)).toBe(false); // Bering Sea
  });

  it('puts the border where the border is: US side in, Canadian side out, in the same cell', () => {
    expect(real.contains(-116.2, 48.9)).toBe(true);
    expect(real.contains(-116.2, 49.1)).toBe(false);
    expect(real.contains(-83.05, 42.33)).toBe(true); // Detroit
    expect(real.contains(-83.03, 42.31)).toBe(false); // Windsor, Ontario
  });

  it('puts the shore where the shore is', () => {
    expect(real.contains(-122.33, 47.6)).toBe(true); // Seattle
    expect(real.contains(-122.45, 47.85)).toBe(false); // Puget Sound
    expect(real.contains(-87.65, 41.88)).toBe(true); // Chicago
    expect(real.contains(-87.3, 41.88)).toBe(false); // Lake Michigan just off Chicago
  });

  it('the whole of Idaho, and only Idaho, is 329 of its cells (what the published pack has)', () => {
    let inIdaho = 0;
    for (let cx = 170; cx <= 200; cx++) {
      for (let cy = 355; cy <= 385; cy++) {
        if (real.hasLand(cx, cy)) inIdaho++;
      }
    }
    expect(inIdaho).toBeGreaterThan(329); // the box also holds Montana, Oregon, Utah, Washington, Wyoming
  });

  it('a point is never US land in a cell that is wholly outside', () => {
    expect(real.contains(-114.07, 51.05)).toBe(false);
  });

  it('edge cells decode to closed rings that stay inside their cell', () => {
    const { cx, cy } = lonLatToCell(-80.19, 25.77);
    const land = real.edgeLand(cx, cy);
    const [w, s, e, n] = cellBounds(cx, cy);
    expect(land?.type).toBe('MultiPolygon');
    for (const rings of land!.coordinates) {
      for (const ring of rings) {
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        for (const [lon, lat] of ring) {
          expect(lon).toBeGreaterThanOrEqual(w - 1e-9);
          expect(lon).toBeLessThanOrEqual(e + 1e-9);
          expect(lat).toBeGreaterThanOrEqual(s - 1e-9);
          expect(lat).toBeLessThanOrEqual(n + 1e-9);
        }
      }
    }
  });

  it('has no edge data for cells that are wholly inside or outside', () => {
    const boise = lonLatToCell(-116.2, 43.6);
    const calgary = lonLatToCell(-114.07, 51.05);
    expect(real.edgeLand(boise.cx, boise.cy)).toBeNull();
    expect(real.edgeLand(calgary.cx, calgary.cy)).toBeNull();
  });

  it('is small enough to ship in the app', () => {
    expect(JSON.stringify(usCellData).length).toBeLessThan(2_000_000);
  });
});

describe('createUsCoverage on a small map', () => {
  const cell = cellBounds(10, 20) as Bounds;
  const [w, s, e, n] = cell;
  const data: UsCellData = {
    version: 1,
    source: 'test',
    rows: { '20': [5, 9], '21': [10, 10, 12, 14] },
    // The west half of cell 10,20 is US.
    edges: {
      '10_20': encodeMultiPolygon(
        [
          [
            [
              [w, s],
              [(w + e) / 2, s],
              [(w + e) / 2, n],
              [w, n],
              [w, s],
            ],
          ],
        ],
        cell
      ),
    },
  };
  const us = createUsCoverage(data);

  it('reads runs of wholly-inside cells and treats everything else as outside', () => {
    expect(us.status(5, 20)).toBe('inside');
    expect(us.status(9, 20)).toBe('inside');
    expect(us.status(4, 20)).toBe('outside');
    expect(us.status(10, 21)).toBe('inside');
    expect(us.status(11, 21)).toBe('outside');
    expect(us.status(13, 21)).toBe('inside');
    expect(us.status(15, 21)).toBe('outside');
    expect(us.status(7, 99)).toBe('outside');
  });

  it('reports a cell with a stored part as an edge, ahead of the runs', () => {
    expect(us.status(10, 20)).toBe('edge');
    expect(us.hasLand(10, 20)).toBe(true);
    expect(us.hasLand(11, 21)).toBe(false);
  });

  it('answers point questions inside an edge cell from its stored shape', () => {
    expect(us.contains(w + 0.01, (s + n) / 2)).toBe(true);
    expect(us.contains(e - 0.01, (s + n) / 2)).toBe(false);
  });

  it('answers point questions elsewhere from the cell alone', () => {
    const inside = cellBounds(6, 20);
    expect(us.contains((inside[0] + inside[2]) / 2, (inside[1] + inside[3]) / 2)).toBe(true);
    expect(us.contains(0, 0)).toBe(false);
  });
});

describe('encodeMultiPolygon', () => {
  const cell = cellBounds(181, 373) as Bounds;
  const [w, s, e, n] = cell;

  it('round-trips a shape to within a step, and keeps edge vertices exactly on the cell edge', () => {
    const shape: [number, number][][][] = [
      [
        [
          [w, s],
          [e, s],
          [e, n],
          [w + 0.1234567, n],
          [w, s + 0.0765432],
          [w, s],
        ],
      ],
    ];
    const us = createUsCoverage({
      version: 1,
      source: 't',
      rows: {},
      edges: { '181_373': encodeMultiPolygon(shape, cell) },
    });
    const decoded = us.edgeLand(181, 373)!.coordinates[0][0];
    const original = shape[0][0];
    expect(decoded).toHaveLength(original.length);
    const stepLon = (e - w) / GRID_STEPS;
    const stepLat = (n - s) / GRID_STEPS;
    decoded.forEach(([lon, lat], i) => {
      expect(Math.abs(lon - original[i][0])).toBeLessThanOrEqual(stepLon);
      expect(Math.abs(lat - original[i][1])).toBeLessThanOrEqual(stepLat);
    });
    expect(decoded[1][0]).toBe(e); // the east edge
    expect(decoded[2][1]).toBe(n); // the north edge
    expect(decoded[0][0]).toBe(w);
    expect(decoded[0][1]).toBe(s);
  });

  it('merges vertices that fall on one step and drops slivers and empty polygons', () => {
    const sliver: [number, number][][] = [
      [
        [w, s],
        [w + 1e-6, s],
        [w, s + 1e-6],
        [w, s],
      ],
    ];
    const real: [number, number][][] = [
      [
        [w, s],
        [w + 0.1, s],
        [w + 0.1, s + 0.1],
        [w, s + 0.1],
        [w, s],
      ],
    ];
    expect(encodeMultiPolygon([sliver], cell)).toEqual([]);
    expect(encodeMultiPolygon([sliver, real], cell)).toHaveLength(1);
  });

  it('drops a hole that collapses but keeps the outer ring', () => {
    const outer: [number, number][] = [
      [w, s],
      [w + 0.1, s],
      [w + 0.1, s + 0.1],
      [w, s + 0.1],
      [w, s],
    ];
    const hole: [number, number][] = [
      [w + 0.05, s + 0.05],
      [w + 0.05 + 1e-6, s + 0.05],
      [w + 0.05, s + 0.05 + 1e-6],
      [w + 0.05, s + 0.05],
    ];
    const [polygon] = encodeMultiPolygon([[outer, hole]], cell);
    expect(polygon).toHaveLength(1);
  });
});

describe('cellOfBounds', () => {
  it('recognises the exact rectangle of a cell', () => {
    expect(cellOfBounds(cellBounds(181, 373) as Bounds)).toEqual({ cx: 181, cy: 373 });
    expect(cellOfBounds(cellBounds(0, 0) as Bounds)).toEqual({ cx: 0, cy: 0 });
  });

  it('is null for any other box', () => {
    const [w, s, e, n] = cellBounds(181, 373);
    expect(cellOfBounds([w + 0.01, s, e, n])).toBeNull();
    expect(cellOfBounds([w, s, e + 0.5, n])).toBeNull();
    expect(cellOfBounds([-116.3, 43.6, -116.1, 43.7])).toBeNull();
  });
});
