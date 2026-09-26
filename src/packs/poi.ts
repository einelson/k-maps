/**
 * POI pins from OpenStreetMap via Overpass: boat launches and campsites /
 * trailheads (nodes only) for one cell. Categories are camelCase to match
 * src/map/poiSources.ts PoiCategory.
 */

import { httpSettings, overpassQuery, sleep, throwIfAborted } from './http.ts';
import type { Bounds, PackContext, PackFeature, PackFeatureCollection } from './types.ts';
import { emptyCollection, restrictToUs, usRestriction } from './usFilter.ts';

export type PoiPackCategory = 'boatLaunches' | 'campsitesTrails';

function bboxClause([w, s, e, n]: Bounds): string {
  return `${s},${w},${n},${e}`;
}

export function poiQueries(bounds: Bounds): Record<PoiPackCategory, string> {
  const bbox = bboxClause(bounds);
  return {
    boatLaunches: `[out:json][timeout:60];node["leisure"="slipway"](${bbox});out body;`,
    campsitesTrails: `[out:json][timeout:60];(
    node["tourism"="camp_site"](${bbox});
    node["highway"="trailhead"](${bbox});
    node["tourism"="information"]["information"="trailhead"](${bbox});
  );out body;`,
  };
}

interface OverpassNode {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

export function overpassNodesToFeatures(
  elements: OverpassNode[],
  category: PoiPackCategory,
  bounds?: Bounds
): PackFeature[] {
  const features: PackFeature[] = [];
  for (const el of elements) {
    if (el.type !== 'node' || typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
    if (bounds && (el.lon < bounds[0] || el.lon > bounds[2] || el.lat < bounds[1] || el.lat > bounds[3])) continue;
    features.push({
      type: 'Feature',
      properties: { category, name: el.tags?.name ?? null, osm_id: el.id },
      geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
    });
  }
  return features;
}

export async function fetchPoiPack(bounds: Bounds, ctx: PackContext = {}): Promise<PackFeatureCollection> {
  const us = usRestriction(bounds, ctx.us);
  if (us.skip) {
    ctx.onProgress?.(1);
    return emptyCollection(); // no US land in this cell
  }
  const queries = poiQueries(bounds);
  const categories = Object.keys(queries) as PoiPackCategory[];
  const features: PackFeature[] = [];
  ctx.onProgress?.(0);
  for (let i = 0; i < categories.length; i++) {
    throwIfAborted(ctx.signal);
    if (i > 0) await sleep(httpSettings.overpassPauseMs, ctx.signal);
    const category = categories[i];
    const json = await overpassQuery<{ elements: OverpassNode[] }>(queries[category], {
      signal: ctx.signal,
    });
    features.push(...overpassNodesToFeatures(json.elements, category, bounds));
    ctx.onProgress?.((i + 1) / categories.length);
  }
  return { type: 'FeatureCollection', features: us.contains ? restrictToUs(features, us.contains) : features };
}
