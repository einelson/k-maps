import { area } from '@turf/turf';

import { cellBounds } from '../downloads/cells.ts';
import { boundsToPolygon } from './clip.ts';
import { computeLikelyPrivate, isSliver, MIN_PRIVATE_AREA_M2 } from './likelyPrivate.ts';
import type { Bounds } from './types.ts';

const CELL = cellBounds(181, 373) as Bounds;
const [W, S, E, N] = CELL;
const MID_LON = (W + E) / 2;
const MID_LAT = (S + N) / 2;

function m2(polygons: { type: 'Polygon'; coordinates: number[][][] }[]): number {
  return polygons.reduce((sum, g) => sum + area({ type: 'Feature', properties: {}, geometry: g }), 0);
}

function box(w: number, s: number, e: number, n: number) {
  return { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

const cellArea = area({ type: 'Feature', properties: {}, geometry: boundsToPolygon(CELL) });

describe('computeLikelyPrivate', () => {
  it('empty cell -> one full-cell private polygon', async () => {
    const out = await computeLikelyPrivate(CELL, []);
    expect(out).toHaveLength(1);
    expect(m2(out)).toBeCloseTo(cellArea, -2);
    expect(out[0].coordinates[0]).toContainEqual([W, S]);
    expect(out[0].coordinates[0]).toContainEqual([E, N]);
  });

  it('fully covered cell -> no private features', async () => {
    expect(await computeLikelyPrivate(CELL, [box(W - 0.1, S - 0.1, E + 0.1, N + 0.1)])).toEqual([]);
    // Covered by two halves that share an edge exactly.
    expect(await computeLikelyPrivate(CELL, [box(W, S, MID_LON, N), box(MID_LON, S, E, N)])).toEqual([]);
  });

  it('a square inside the cell -> cell minus square, with a hole and the right area', async () => {
    const half = 0.05;
    const square = box(MID_LON - half, MID_LAT - half, MID_LON + half, MID_LAT + half);
    const out = await computeLikelyPrivate(CELL, [square]);
    expect(out).toHaveLength(1);
    expect(out[0].coordinates).toHaveLength(2); // outer ring + one hole
    const squareArea = area({ type: 'Feature', properties: {}, geometry: square });
    expect(m2(out)).toBeCloseTo(cellArea - squareArea, -3);
  });

  it('overlapping public polygons are unioned, not double-subtracted', async () => {
    const a = box(MID_LON - 0.1, MID_LAT - 0.05, MID_LON + 0.05, MID_LAT + 0.05);
    const b = box(MID_LON - 0.05, MID_LAT - 0.05, MID_LON + 0.1, MID_LAT + 0.05);
    const union = box(MID_LON - 0.1, MID_LAT - 0.05, MID_LON + 0.1, MID_LAT + 0.05);
    const out = await computeLikelyPrivate(CELL, [a, b]);
    const unionArea = area({ type: 'Feature', properties: {}, geometry: union });
    expect(m2(out)).toBeCloseTo(cellArea - unionArea, -3);
  });

  it('drops float-gap slivers between adjacent public polygons', async () => {
    // Two halves with a ~6 m gap running the full height (~28 km): area ~170,000 m^2 — far over the
    // area threshold — but only 6 m wide.
    const gap = 0.00005;
    const out = await computeLikelyPrivate(CELL, [box(W, S, MID_LON - gap, N), box(MID_LON + gap, S, E, N)]);
    expect(out).toEqual([]);
    const gapArea = area({ type: 'Feature', properties: {}, geometry: box(MID_LON - gap, S, MID_LON + gap, N) });
    expect(gapArea).toBeGreaterThan(MIN_PRIVATE_AREA_M2 * 10);
  });

  it('drops tiny enclosed remnants (a 30 m hole in a public polygon) but keeps real areas', async () => {
    const holed = {
      type: 'Polygon' as const,
      coordinates: [
        [[W - 0.1, S - 0.1], [MID_LON, S - 0.1], [MID_LON, N + 0.1], [W - 0.1, N + 0.1], [W - 0.1, S - 0.1]],
        [[W + 0.05, S + 0.05], [W + 0.05 + 0.0003, S + 0.05], [W + 0.05 + 0.0003, S + 0.05 + 0.0003], [W + 0.05, S + 0.05 + 0.0003], [W + 0.05, S + 0.05]],
      ],
    };
    const out = await computeLikelyPrivate(CELL, [holed]);
    expect(out).toHaveLength(1); // the east half only; the pinhole is gone
    expect(m2(out)).toBeCloseTo(cellArea / 2, -6);
  });

  it('splitting into quadrants gives the same area as one big difference', async () => {
    const polys = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        if ((i + j) % 3 === 0) continue;
        const cx = W + ((E - W) * (i + 0.5)) / 6;
        const cy = S + ((N - S) * (j + 0.5)) / 6;
        polys.push(box(cx - 0.02 * (1 + (i % 2)), cy - 0.02, cx + 0.03, cy + 0.02 * (1 + (j % 2))));
      }
    }
    const whole = await computeLikelyPrivate(CELL, polys, { maxLeafVertices: 1_000_000 });
    const split = await computeLikelyPrivate(CELL, polys, { maxLeafVertices: 8 });
    expect(split.length).toBeGreaterThanOrEqual(whole.length);
    expect(m2(split)).toBeCloseTo(m2(whole), -3);
  });

  it('yields to the event loop between slices', async () => {
    const polys = [];
    for (let i = 0; i < 12; i++) polys.push(box(W + i * 0.02, S + 0.02, W + i * 0.02 + 0.01, S + 0.05));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    await computeLikelyPrivate(CELL, polys, { maxLeafVertices: 8, sliceMs: 0 });
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });

  it('rejects with an AbortError when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      computeLikelyPrivate(CELL, [box(W, S, MID_LON, MID_LAT)], { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('isSliver', () => {
  it('flags small and thin rings, keeps compact ones', () => {
    const at = (w: number, h: number) => [[[W, S], [W + w, S], [W + w, S + h], [W, S + h], [W, S]]];
    expect(isSliver(at(0.0005, 0.0005))).toBe(true); // ~40 x 55 m = ~2,000 m^2
    expect(isSliver(at(0.00005, 0.2))).toBe(true); // 4 m wide, 22 km long
    expect(isSliver(at(0.005, 0.005))).toBe(false); // ~400 x 550 m
  });
});
