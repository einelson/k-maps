/**
 * OSM roads & trails for one cell via Overpass (`out geom`).
 *
 * A z10 cell can be a 28 km city, so the bounds are split into a 3x3 grid of
 * sub-boxes queried SEQUENTIALLY with a pause between requests. Overpass
 * returns whole ways for a bbox filter, so ways crossing sub-box borders show
 * up several times: dedupe by way id first, clip to the overall bounds after.
 */

import { clipLineGeometry, roundLine } from './clip.ts';
import type { LineGeometry } from './clip.ts';
import { httpSettings, overpassQuery, sleep, throwIfAborted } from './http.ts';
import type { Bounds, PackContext, PackFeature, PackFeatureCollection } from './types.ts';
import { emptyCollection, restrictToUs, usRestriction } from './usFilter.ts';
import type { Position } from 'geojson';

export type OsmRoadClass = 'highway' | 'primary' | 'street' | 'track' | 'path';

export const OSM_GRID = 3;
export const OSM_COORD_DECIMALS = 5;

const CLASS_BY_HIGHWAY: Record<string, OsmRoadClass> = {
  motorway: 'highway',
  motorway_link: 'highway',
  trunk: 'highway',
  trunk_link: 'highway',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'primary',
  secondary_link: 'primary',
  tertiary: 'street',
  tertiary_link: 'street',
  unclassified: 'street',
  residential: 'street',
  living_street: 'street',
  road: 'street',
  track: 'track',
  path: 'path',
  footway: 'path',
  bridleway: 'path',
  cycleway: 'path',
  steps: 'path',
  pedestrian: 'path',
};

/** highway=* values kept (service, proposed, construction, abandoned, razed, ... are simply not listed). */
export const OSM_HIGHWAY_VALUES = Object.keys(CLASS_BY_HIGHWAY);

export function osmRoadClass(highway: string | undefined): OsmRoadClass | null {
  return (highway && CLASS_BY_HIGHWAY[highway]) || null;
}

/** Splits bounds into an n x n grid of sub-boxes (row-major from the south-west). */
export function splitBounds([w, s, e, n]: Bounds, parts = OSM_GRID): Bounds[] {
  const boxes: Bounds[] = [];
  for (let j = 0; j < parts; j++) {
    for (let i = 0; i < parts; i++) {
      boxes.push([
        i === 0 ? w : w + ((e - w) * i) / parts,
        j === 0 ? s : s + ((n - s) * j) / parts,
        i === parts - 1 ? e : w + ((e - w) * (i + 1)) / parts,
        j === parts - 1 ? n : s + ((n - s) * (j + 1)) / parts,
      ]);
    }
  }
  return boxes;
}

/**
 * highway=* values excluded server-side. An exclusion list is ~3x faster on
 * Overpass than an inclusion regex; whatever else slips through (rare
 * values) is dropped client-side by the OSM_HIGHWAY_VALUES whitelist.
 */
const EXCLUDED_HIGHWAYS =
  'service|proposed|construction|abandoned|razed|platform|raceway|bus_guideway|elevator|corridor|via_ferrata|services|rest_area|escape|emergency_bay|planned|disused|no|yes';

export function osmRoadsQuery([w, s, e, n]: Bounds): string {
  return (
    `[out:json][timeout:60];` +
    `way["highway"]["highway"!~"^(${EXCLUDED_HIGHWAYS})$"]["footway"!~"^(sidewalk|crossing)$"](${s},${w},${n},${e});` +
    `out tags geom;`
  );
}

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
}

const OPTIONAL_TAGS = ['name', 'ref', 'surface', 'tracktype'] as const;

/** Overpass way -> LineString feature (unclipped, coordinates rounded), or null if it's not a road we keep. */
export function wayToFeature(way: OverpassWay): PackFeature | null {
  if (way.type !== 'way' || !way.geometry) return null;
  const tags = way.tags ?? {};
  const cls = osmRoadClass(tags.highway);
  if (!cls) return null;
  if (tags.footway === 'sidewalk' || tags.footway === 'crossing') return null;
  const line: Position[] = [];
  for (const p of way.geometry) {
    if (p) line.push([p.lon, p.lat]);
  }
  const rounded = roundLine(line, OSM_COORD_DECIMALS);
  if (!rounded) return null;
  const properties: Record<string, unknown> = { highway: tags.highway, cls };
  for (const key of OPTIONAL_TAGS) {
    if (tags[key]) properties[key] = tags[key];
  }
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: rounded } };
}

/**
 * Accumulates ways from several Overpass responses: dedupes by way id (a way
 * crossing a sub-box border is returned by each box), converts each to a
 * compact feature straight away, and clips to `bounds`.
 */
export function createWayAccumulator(bounds: Bounds) {
  const seen = new Set<number>();
  const features: PackFeature[] = [];
  return {
    features,
    add(elements: OverpassWay[]): void {
      for (const way of elements) {
        if (way.type !== 'way' || seen.has(way.id)) continue;
        seen.add(way.id);
        const feature = wayToFeature(way);
        if (!feature) continue;
        const clipped = clipLineGeometry(feature.geometry as LineGeometry, bounds);
        if (clipped) features.push({ ...feature, geometry: clipped });
      }
    },
  };
}

export async function fetchOsmRoadsPack(bounds: Bounds, ctx: PackContext = {}): Promise<PackFeatureCollection> {
  const us = usRestriction(bounds, ctx.us);
  if (us.skip) {
    ctx.onProgress?.(1);
    return emptyCollection(); // no US land in this cell
  }
  const boxes = splitBounds(bounds);
  const acc = createWayAccumulator(bounds);
  ctx.onProgress?.(0);
  for (let i = 0; i < boxes.length; i++) {
    throwIfAborted(ctx.signal);
    if (i > 0) await sleep(httpSettings.overpassPauseMs, ctx.signal);
    const json = await overpassQuery<{ elements: OverpassWay[] }>(osmRoadsQuery(boxes[i]), {
      signal: ctx.signal,
    });
    acc.add(json.elements);
    ctx.onProgress?.((i + 1) / boxes.length);
  }
  return { type: 'FeatureCollection', features: us.contains ? restrictToUs(acc.features, us.contains) : acc.features };
}
