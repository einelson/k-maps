import { featureCollection, union } from '@turf/turf';
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';

import type { HuntSetConfig, HuntUnitProperties } from './types.ts';

export type UnitFeature = Feature<Geometry, HuntUnitProperties>;
type SourceFeature = Feature<Geometry, Record<string, any> | null>;

/** Trimmed string form of an attribute; empty for null / undefined. */
export function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** "FLATHEAD INDIAN RESERVATION" -> "Flathead Indian Reservation" (agencies love upper case). */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
}

/** The value if it is an http(s) URL, else null — a few services put prose ("Hunting not allowed ...") in link columns. */
export function httpUrl(value: unknown): string | null {
  const t = text(value);
  return /^https?:\/\/\S+$/i.test(t) ? t : null;
}

/** `<a href="https://x">Unit 1</a>` -> `https://x` (IDFG's link columns are HTML anchors). */
export function hrefOf(html: unknown): string | null {
  const match = /href\s*=\s*["']([^"']+)["']/i.exec(text(html));
  return match ? httpUrl(match[1]) : null;
}

/** Joins non-empty parts with " – ": `["Unit 27", "Chetco"]` -> "Unit 27 – Chetco". */
export function joinTitle(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim() !== '').join(' – ');
}

const isPolygon = (g: Geometry | null | undefined): g is Polygon | MultiPolygon =>
  g?.type === 'Polygon' || g?.type === 'MultiPolygon';

/** Merges the polygons that share `attribute` (KY's deer zones are drawn per county) into one feature per value. */
export function dissolveBy(features: SourceFeature[], attribute: string): SourceFeature[] {
  const groups = new Map<string, SourceFeature[]>();
  for (const feature of features) {
    if (!isPolygon(feature.geometry)) continue;
    const key = text(feature.properties?.[attribute]);
    const group = groups.get(key);
    if (group) group.push(feature);
    else groups.set(key, [feature]);
  }
  const merged: SourceFeature[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (group.length === 1) {
      merged.push(first);
      continue;
    }
    const combined = union(featureCollection(group as Feature<Polygon | MultiPolygon>[]));
    merged.push({ type: 'Feature', properties: first.properties, geometry: (combined?.geometry ?? first.geometry) as Geometry });
  }
  return merged;
}

/** Applies a set's mapping to what the service returned: normalized properties only, polygons only, skipped features dropped. */
export function normalizeSet(set: HuntSetConfig, features: SourceFeature[]): UnitFeature[] {
  const source = set.dissolveBy ? dissolveBy(features, set.dissolveBy) : features;
  const out: UnitFeature[] = [];
  for (const feature of source) {
    if (!isPolygon(feature.geometry)) continue;
    const info = set.map(feature.properties ?? {});
    if (!info || !text(info.unit)) continue;
    const unit = text(info.unit);
    out.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        set: set.id,
        unit,
        title: info.title?.trim() || `${set.noun} ${unit}`,
        note: info.note?.trim() || null,
        url: info.url ?? null,
        urlLabel: info.url ? (info.urlLabel ?? 'More information') : null,
        url2: info.url2 ?? null,
        url2Label: info.url2 ? (info.url2Label ?? 'More information') : null,
      },
    });
  }
  return out;
}

/** Every [lon, lat] position in a (Multi)Polygon's coordinates. */
function positions(coordinates: unknown, out: [number, number][] = []): [number, number][] {
  if (Array.isArray(coordinates) && typeof coordinates[0] === 'number') out.push([coordinates[0], coordinates[1] as number]);
  else if (Array.isArray(coordinates)) for (const c of coordinates) positions(c, out);
  return out;
}

/**
 * `[west, south, east, north]` of a state's features, rounded outward to 2 decimals. Alaska's Aleutians cross the
 * antimeridian (longitudes both near -180 and near +180); a plain min/max would give a box spanning the whole
 * world that overlaps every view. When the raw span exceeds half the globe, eastern-hemisphere longitudes are
 * shifted down by 360 so the box runs continuously west past -180 instead (west may then be below -180).
 */
export function boundsOf(features: UnitFeature[]): [number, number, number, number] {
  const points = features.flatMap((f) => positions((f.geometry as { coordinates: unknown }).coordinates));
  // Plain loops, not Math.min(...array): a big state has hundreds of thousands of positions.
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const wraps = maxLon - minLon > 180;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    const x = wraps && lon > 0 ? lon - 360 : lon;
    if (x < west) west = x;
    if (x > east) east = x;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const down = (v: number) => Math.floor(v * 100) / 100;
  const up = (v: number) => Math.ceil(v * 100) / 100;
  return [down(west), down(south), up(east), up(north)];
}
