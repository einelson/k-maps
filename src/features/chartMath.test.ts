import {
  areaPath,
  downsample,
  extentOf,
  linePath,
  nearestIndex,
  niceTicks,
  scaleLinear,
  toPoints,
} from './chartMath';

describe('niceTicks', () => {
  it('picks round steps that cover the range', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(4820, 5390, 4)).toEqual([5000, 5200]);
  });

  it('stays inside the range', () => {
    for (const [min, max] of [[3, 97], [0.3, 0.9], [1200, 8400], [-50, 50]]) {
      const ticks = niceTicks(min, max);
      expect(ticks.length).toBeGreaterThan(0);
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(min);
        expect(t).toBeLessThanOrEqual(max);
      }
    }
  });

  it('avoids float dust in fractional steps', () => {
    expect(niceTicks(0, 0.6, 3)).toEqual([0, 0.2, 0.4, 0.6]);
  });

  it('handles a flat range and bad input', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(NaN, 5)).toEqual([]);
    expect(niceTicks(0, Infinity)).toEqual([]);
  });
});

describe('toPoints', () => {
  it('pairs x with y and drops unknown y', () => {
    expect(toPoints([0, 1, 2], [10, null, 30])).toEqual([{ x: 0, y: 10 }, { x: 2, y: 30 }]);
  });

  it('drops non-finite values and tolerates length mismatch', () => {
    expect(toPoints([0, NaN, 2, 3], [1, 2, Infinity, 4])).toEqual([{ x: 0, y: 1 }, { x: 3, y: 4 }]);
    expect(toPoints([0, 1, 2], [5])).toEqual([{ x: 0, y: 5 }]);
  });
});

describe('downsample', () => {
  const ramp = (n: number) => Array.from({ length: n }, (_, x) => ({ x, y: x }));

  it('returns short series untouched', () => {
    const points = ramp(50);
    expect(downsample(points, 100)).toBe(points);
  });

  it('thins a long series to about the limit, keeping the ends and the order', () => {
    const out = downsample(ramp(10_000), 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.length).toBeGreaterThan(100);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 9999, y: 9999 });
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThan(out[i - 1].x);
  });

  it('keeps a lone spike and a lone dip', () => {
    const points = ramp(5000).map((p) => ({ x: p.x, y: 100 }));
    points[2500].y = 500;
    points[3700].y = -300;
    const out = downsample(points, 100);
    expect(Math.max(...out.map((p) => p.y))).toBe(500);
    expect(Math.min(...out.map((p) => p.y))).toBe(-300);
  });

  it('does not thin when the limit is tiny', () => {
    const points = ramp(20);
    expect(downsample(points, 2)).toBe(points);
  });
});

describe('extentOf and scaleLinear', () => {
  it('finds min and max', () => {
    expect(extentOf([3, 1, 2])).toEqual({ min: 1, max: 3 });
    expect(extentOf([])).toBeNull();
  });

  it('maps a value between ranges, including flipped ones (SVG y grows downward)', () => {
    expect(scaleLinear(5, { min: 0, max: 10 }, { min: 0, max: 200 })).toBe(100);
    expect(scaleLinear(0, { min: 0, max: 10 }, { min: 150, max: 10 })).toBe(150);
    expect(scaleLinear(10, { min: 0, max: 10 }, { min: 150, max: 10 })).toBe(10);
  });

  it('puts a zero-width domain in the middle', () => {
    expect(scaleLinear(3, { min: 3, max: 3 }, { min: 0, max: 100 })).toBe(50);
  });
});

describe('paths', () => {
  const pts = [{ x: 0, y: 10 }, { x: 5.5, y: 20 }, { x: 10, y: 5 }];

  it('draws a polyline', () => {
    expect(linePath(pts)).toBe('M0.0 10.0 L5.5 20.0 L10.0 5.0');
    expect(linePath([])).toBe('');
  });

  it('closes an area down to the baseline', () => {
    expect(areaPath(pts, 100)).toBe(`${linePath(pts)} L10.0 100.0 L0.0 100.0 Z`);
    expect(areaPath([], 100)).toBe('');
  });
});

describe('nearestIndex', () => {
  const xs = [0, 10, 20, 40, 100];

  it('finds the closest x, with exact hits and clamping', () => {
    expect(nearestIndex(xs, 0)).toBe(0);
    expect(nearestIndex(xs, 21)).toBe(2);
    expect(nearestIndex(xs, 31)).toBe(3);
    expect(nearestIndex(xs, 29)).toBe(2);
    expect(nearestIndex(xs, -50)).toBe(0);
    expect(nearestIndex(xs, 1000)).toBe(4);
  });

  it('handles empty and single-element arrays', () => {
    expect(nearestIndex([], 5)).toBe(-1);
    expect(nearestIndex([7], 100)).toBe(0);
  });
});
