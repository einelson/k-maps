import {
  clipLineGeometry,
  clipPolygonGeometry,
  polygonOutlineRuns,
  ringOutlineRuns,
  roundLine,
  roundRings,
  segmentOnBoundary,
} from './clip.ts';
import type { Bounds } from './types.ts';

const BOUNDS: Bounds = [0, 0, 1, 1];

function segmentsOf(runs: number[][][]): [number[], number[]][] {
  const out: [number[], number[]][] = [];
  for (const run of runs) for (let i = 0; i < run.length - 1; i++) out.push([run[i], run[i + 1]]);
  return out;
}

function anySegmentOnBoundary(runs: number[][][], bounds: Bounds = BOUNDS): boolean {
  return segmentsOf(runs).some(([a, b]) => segmentOnBoundary(a, b, bounds));
}

describe('clipPolygonGeometry', () => {
  it('clips a polygon straddling the boundary and drops one entirely outside', () => {
    const straddling = {
      type: 'Polygon' as const,
      coordinates: [[[0.5, 0.2], [1.5, 0.2], [1.5, 0.8], [0.5, 0.8], [0.5, 0.2]]],
    };
    const clipped = clipPolygonGeometry(straddling, BOUNDS)!;
    const xs = (clipped as any).coordinates[0].map((p: number[]) => p[0]);
    expect(Math.max(...xs)).toBe(1);
    expect(clipPolygonGeometry({ type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]] }, BOUNDS)).toBeNull();
  });

  it('survives a polygon that only touches the box (bboxClip alone would throw)', () => {
    const touching = { type: 'Polygon' as const, coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] };
    expect(() => clipPolygonGeometry(touching, BOUNDS)).not.toThrow();
    expect(clipPolygonGeometry(touching, BOUNDS)).toBeNull();
  });

  it('keeps holes and returns a MultiPolygon for multi-part input', () => {
    const multi = {
      type: 'MultiPolygon' as const,
      coordinates: [
        [[[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4], [0.1, 0.1]], [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.3], [0.2, 0.2]]],
        [[[0.6, 0.6], [1.6, 0.6], [1.6, 0.9], [0.6, 0.9], [0.6, 0.6]]],
      ],
    };
    const clipped = clipPolygonGeometry(multi, BOUNDS)!;
    expect(clipped.type).toBe('MultiPolygon');
    expect((clipped as any).coordinates[0]).toHaveLength(2);
  });
});

describe('outline boundary stripping', () => {
  it('strips the segment on the clip edge but keeps the interior edges', () => {
    const straddling = {
      type: 'Polygon' as const,
      coordinates: [[[0.5, 0.2], [1.5, 0.2], [1.5, 0.8], [0.5, 0.8], [0.5, 0.2]]],
    };
    const clipped = clipPolygonGeometry(straddling, BOUNDS)!;
    const runs = polygonOutlineRuns(clipped, BOUNDS);
    expect(runs.length).toBeGreaterThan(0);
    expect(anySegmentOnBoundary(runs)).toBe(false);
    // The bottom (y=0.2), left (x=0.5) and top (y=0.8) edges survive as one open line.
    const segs = segmentsOf(runs);
    expect(segs).toContainEqual([[0.5, 0.8], [0.5, 0.2]]);
    expect(segs.some(([a, b]) => a[1] === 0.2 && b[1] === 0.2)).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0][0]).not.toEqual(runs[0][runs[0].length - 1]);
  });

  it('strips zero-width bridges that clipping a concave polygon leaves along the edge', () => {
    // A "C" opening east whose two arms poke out past x=1: bboxClip bridges the gap along x=1.
    const cShape = {
      type: 'Polygon' as const,
      coordinates: [[[0.5, 0.1], [1.5, 0.1], [1.5, 0.2], [0.6, 0.2], [0.6, 0.8], [1.5, 0.8], [1.5, 0.9], [0.5, 0.9], [0.5, 0.1]]],
    };
    const clipped = clipPolygonGeometry(cShape, BOUNDS)!;
    const ring = (clipped as any).coordinates[0] as number[][];
    const bridged = ring.some((p, i) => i > 0 && segmentOnBoundary(ring[i - 1], p, BOUNDS));
    expect(bridged).toBe(true); // precondition: the clip really did produce boundary segments

    const runs = polygonOutlineRuns(clipped, BOUNDS);
    expect(anySegmentOnBoundary(runs)).toBe(false);
    const segs = segmentsOf(runs);
    expect(segs).toContainEqual([[0.6, 0.2], [0.6, 0.8]]); // the inner wall of the C survives
    expect(segs.some(([a, b]) => a[0] === 0.5 && b[0] === 0.5)).toBe(true); // outer wall too
  });

  it('returns a ring with no boundary contact as one closed loop', () => {
    const ring = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]];
    const runs = ringOutlineRuns(ring, BOUNDS);
    expect(runs).toEqual([ring]);
  });

  it('a polygon lying along the whole boundary has no outline', () => {
    const full = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    expect(polygonOutlineRuns(full, BOUNDS)).toEqual([]);
  });

  it('keeps a diagonal that cuts across a corner (endpoints on different edges)', () => {
    expect(segmentOnBoundary([1, 0.5], [0.5, 1], BOUNDS)).toBe(false);
    expect(segmentOnBoundary([1, 0.2], [1, 0.9], BOUNDS)).toBe(true);
  });
});

describe('clipLineGeometry / roundLine', () => {
  it('clips a line crossing the box and splits one that leaves and re-enters', () => {
    const through = clipLineGeometry({ type: 'LineString', coordinates: [[-1, 0.5], [2, 0.5]] }, BOUNDS)!;
    expect(through).toEqual({ type: 'LineString', coordinates: [[0, 0.5], [1, 0.5]] });
    const reentry = clipLineGeometry(
      { type: 'LineString', coordinates: [[0.2, 0.2], [1.5, 0.2], [1.5, 0.6], [0.2, 0.6]] },
      BOUNDS
    )!;
    expect(reentry.type).toBe('MultiLineString');
    expect(clipLineGeometry({ type: 'LineString', coordinates: [[2, 2], [3, 3]] }, BOUNDS)).toBeNull();
  });

  it('rounds and drops consecutive duplicates', () => {
    expect(roundLine([[0.123456, 0.1], [0.123457, 0.1], [0.2, 0.2]], 5)).toEqual([
      [0.12346, 0.1],
      [0.2, 0.2],
    ]);
    expect(roundLine([[0.1, 0.1], [0.1000001, 0.1]], 5)).toBeNull();
  });
});

describe('roundRings', () => {
  it('rounds interior coordinates but keeps boundary coordinates exactly on the boundary', () => {
    const bounds: Bounds = [-116.3671875, 43.58039085560785, -116.015625, 43.834526782236836];
    const ring = [
      [-116.3671875, 43.58039085560785],
      [-116.1234567891, 43.58039085560785],
      [-116.1234567891, 43.7000001234],
      [-116.3671875, 43.834526782236836],
      [-116.3671875, 43.58039085560785],
    ];
    const [out] = roundRings([ring], bounds, 6)!;
    expect(out).toEqual([
      [-116.3671875, 43.58039085560785],
      [-116.123457, 43.58039085560785],
      [-116.123457, 43.7],
      [-116.3671875, 43.834526782236836],
      [-116.3671875, 43.58039085560785],
    ]);
  });

  it('returns null when the outer ring collapses and drops collapsed holes', () => {
    const b: Bounds = [0, 0, 1, 1];
    const tiny = [[0.5, 0.5], [0.5000001, 0.5], [0.5000001, 0.5000001], [0.5, 0.5000001], [0.5, 0.5]];
    expect(roundRings([tiny], b, 6)).toBeNull();
    const outer = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]];
    expect(roundRings([outer, tiny], b, 6)).toEqual([outer]);
  });
});
