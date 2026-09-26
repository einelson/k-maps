/**
 * "Likely private (inferred)" layer (spec §6.4): the cell rectangle minus the
 * union of every public-land polygon. In a cell that is only partly US (coast,
 * Canada, Mexico) the start is the US part of the cell instead of its whole
 * rectangle, so nothing is inferred for the ocean or another country.
 *
 * polyclip-ts (behind turf `difference`) is slow for hundreds of overlapping
 * polygons — ~0.6 s in V8 for a city cell, and Hermes is 5-10x slower — so
 * the work is split with an adaptive quadtree: a region with few vertices is
 * differenced in one go, a busy one is split in four (clipping the polygons
 * into each quadrant) and the event loop is yielded between leaves so the UI
 * keeps responding. Leaves share exact edges, so there are no gaps; the
 * result is simply cut into more (adjacent) polygons along quadrant borders.
 *
 * Float gaps between adjacent public polygons come out as slivers and are
 * dropped: anything under MIN_PRIVATE_AREA_M2, or long-and-thin (mean width
 * 2A/P under MIN_PRIVATE_WIDTH_M — a 5 m wide, 10 km long gap is 50,000 m²
 * and would pass an area test alone).
 */

import { area, difference, featureCollection } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

import { boundsToPolygon, clipPolygonGeometry, roundRings } from './clip.ts';
import type { PolygonGeometry } from './clip.ts';
import { throwIfAborted } from './http.ts';
import type { Bounds } from './types.ts';

export const MIN_PRIVATE_AREA_M2 = 5000;
export const MIN_PRIVATE_WIDTH_M = 15;
const PRIVATE_COORD_DECIMALS = 6;

export interface LikelyPrivateOptions {
  signal?: AbortSignal;
  /** Limits the result to this land (the US part of a coast or border cell); left out, the whole cell counts. */
  land?: PolygonGeometry;
  /** Split a region while its clipped polygons have more vertices than this. */
  maxLeafVertices?: number;
  maxDepth?: number;
  /** Yield to the event loop when a slice of work has run this long (ms). */
  sliceMs?: number;
}

interface Item {
  geometry: PolygonGeometry;
  bbox: Bounds;
  vertices: number;
}

function ringsOf(g: PolygonGeometry): Position[][][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

function measure(g: PolygonGeometry): { bbox: Bounds; vertices: number } {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  let vertices = 0;
  for (const rings of ringsOf(g)) {
    for (const ring of rings) {
      vertices += ring.length;
    }
    for (const [x, y] of rings[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return { bbox: [w, s, e, n], vertices };
}

function toItem(geometry: PolygonGeometry): Item {
  return { geometry, ...measure(geometry) };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function feature(geometry: Polygon): Feature<Polygon> {
  return { type: 'Feature', properties: {}, geometry };
}

/** (`land`, else the rectangle) - polys, tolerating an occasional geometry polyclip rejects. */
function subtract(rect: Bounds, polys: PolygonGeometry[], land?: PolygonGeometry): (Polygon | MultiPolygon)[] {
  const rectFeature: Feature<Polygon | MultiPolygon> = land
    ? { type: 'Feature', properties: {}, geometry: land }
    : feature(boundsToPolygon(rect));
  const run = (subject: Feature<Polygon | MultiPolygon>, clips: PolygonGeometry[]) =>
    difference(
      featureCollection([subject, ...clips.map((g) => ({ type: 'Feature' as const, properties: {}, geometry: g }))])
    );
  try {
    const result = polys.length === 0 ? rectFeature : run(rectFeature, polys);
    return result ? [result.geometry] : [];
  } catch {
    // Fall back to one polygon at a time, skipping any that polyclip can't take.
    let current: Feature<Polygon | MultiPolygon> | null = rectFeature;
    for (const p of polys) {
      if (!current) break;
      try {
        current = run(current, [p]);
      } catch {
        // ignore this polygon
      }
    }
    return current ? [current.geometry] : [];
  }
}

function toMeters(dLon: number, dLat: number, midLat: number): number {
  const mx = dLon * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const my = dLat * 110_540;
  return Math.sqrt(mx * mx + my * my);
}

function perimeterMeters(rings: Position[][]): number {
  let total = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      total += toMeters(
        ring[i + 1][0] - ring[i][0],
        ring[i + 1][1] - ring[i][1],
        (ring[i][1] + ring[i + 1][1]) / 2
      );
    }
  }
  return total;
}

/** True for float-gap slivers: tiny, or so thin that no real parcel could look like that. */
export function isSliver(rings: Position[][]): boolean {
  const a = area(feature({ type: 'Polygon', coordinates: rings }));
  if (a < MIN_PRIVATE_AREA_M2) return true;
  const p = perimeterMeters(rings);
  return p > 0 && (2 * a) / p < MIN_PRIVATE_WIDTH_M;
}

/**
 * Returns the "likely private" Polygons for `bounds`: cell minus
 * union(publicGeometries), slivers removed. No public land -> the full cell;
 * fully covered -> [].
 */
export async function computeLikelyPrivate(
  bounds: Bounds,
  publicGeometries: PolygonGeometry[],
  options: LikelyPrivateOptions = {}
): Promise<Polygon[]> {
  const { signal, maxLeafVertices = 400, maxDepth = 4, sliceMs = 30 } = options;
  const collected: (Polygon | MultiPolygon)[] = [];
  let sliceStart = Date.now();

  const maybeYield = async () => {
    if (Date.now() - sliceStart >= sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      throwIfAborted(signal);
      sliceStart = Date.now();
    }
  };

  // `land` is the part of `region` that counts: undefined = all of it, null = none of it (nothing to infer there).
  async function solve(
    region: Bounds,
    items: Item[],
    depth: number,
    land: PolygonGeometry | null | undefined
  ): Promise<void> {
    throwIfAborted(signal);
    if (land === null) return;
    const vertices = items.reduce((sum, item) => sum + item.vertices, 0);
    if (items.length === 0 || vertices <= maxLeafVertices || depth >= maxDepth) {
      for (const g of subtract(region, items.map((i) => i.geometry), land)) collected.push(g);
      await maybeYield();
      return;
    }
    const [w, s, e, n] = region;
    const mx = (w + e) / 2;
    const my = (s + n) / 2;
    const quadrants: Bounds[] = [
      [w, s, mx, my],
      [mx, s, e, my],
      [w, my, mx, n],
      [mx, my, e, n],
    ];
    for (const quadrant of quadrants) {
      const childItems: Item[] = [];
      for (const item of items) {
        if (!overlaps(item.bbox, quadrant)) continue;
        const clipped = clipPolygonGeometry(item.geometry, quadrant);
        if (clipped) childItems.push(toItem(clipped));
      }
      await solve(quadrant, childItems, depth + 1, land === undefined ? undefined : clipPolygonGeometry(land, quadrant));
    }
  }

  const items: Item[] = [];
  for (const g of publicGeometries) {
    const clipped = clipPolygonGeometry(g, bounds);
    if (clipped) items.push(toItem(clipped));
  }
  const land = options.land ? clipPolygonGeometry(options.land, bounds) : undefined;
  await solve(bounds, items, 0, land);

  const out: Polygon[] = [];
  for (const g of collected) {
    for (const rings of ringsOf(g)) {
      if (isSliver(rings)) continue;
      // ~0.1 m: polyclip's 15-digit intersection points would roughly double the pack size.
      const rounded = roundRings(rings, bounds, PRIVATE_COORD_DECIMALS);
      if (rounded) out.push({ type: 'Polygon', coordinates: rounded });
    }
  }
  return out;
}
