/**
 * USFS National Forest System trails for one cell (spec §2: "USFS trails from the same Enterprise
 * Data Warehouse" as MVUM) — singletrack and hiking trails that OSM's tagging often misses in remote
 * areas. Lines are clipped to the cell locally. The service's ~100 columns are boiled down to what a
 * tap card and the styling need, so packs stay small.
 */

import { queryArcGisFeatures } from './arcgis.ts';
import { clipLineGeometry } from './clip.ts';
import type { LineGeometry } from './clip.ts';
import { throwIfAborted } from './http.ts';
import type { Bounds, PackContext, PackFeature, PackFeatureCollection } from './types.ts';
import { emptyCollection, usRestriction } from './usFilter.ts';

export const TRAILS_SERVICE_URL =
  'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0';

/** ~2 m — trail vertices are far denser than any phone screen needs. */
export const TRAILS_SIMPLIFY_DEG = 0.00002;

/**
 * The service has one `<use>_managed` / `<use>_accpt` column pair per trail use, holding the season
 * (e.g. `01/01-12/31`) when that use is managed for / accepted on the trail, and null when it isn't.
 */
export const TRAIL_USES = [
  { key: 'hiker_pedestrian', label: 'Hiking' },
  { key: 'pack_saddle', label: 'Horse' },
  { key: 'bicycle', label: 'Bike' },
  { key: 'motorcycle', label: 'Motorcycle' },
  { key: 'atv', label: 'ATV' },
  { key: 'fourwd', label: '4WD' },
] as const;

const MOTORIZED_USES = new Set(['motorcycle', 'atv', 'fourwd']);

export const TRAILS_OUT_FIELDS = [
  'trail_name',
  'trail_no',
  'trail_class',
  'trail_surface',
  'typical_tread_width',
  'terra_motorized',
  'gis_miles',
  ...TRAIL_USES.flatMap((u) => [`${u.key}_managed`, `${u.key}_accpt`]),
].join(',');

export type TrailClass = 'motorized' | 'nonmotorized';

const isSet = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : v != null;

/** Use keys (see `TRAIL_USES`) allowed on this trail, from the raw service properties. */
export function allowedTrailUseKeys(props: Record<string, unknown>): string[] {
  return TRAIL_USES.filter((u) => isSet(props[`${u.key}_managed`]) || isSet(props[`${u.key}_accpt`])).map(
    (u) => u.key
  );
}

/**
 * Motorized when the agency flags the tread as motorized, or the only allowed uses are motor vehicles;
 * everything else (hiking, horse, bike, or unlisted) is non-motorized.
 */
export function trailClass(props: Record<string, unknown>): TrailClass {
  if (props.terra_motorized === 'Y') return 'motorized';
  const uses = allowedTrailUseKeys(props);
  return uses.length > 0 && uses.every((u) => MOTORIZED_USES.has(u)) ? 'motorized' : 'nonmotorized';
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Title-cases the agency's ALL-CAPS names ("MORES MOUNTAIN INTERPRETIVE" -> "Mores Mountain Interpretive"). */
export function prettyTrailName(name: unknown): string | null {
  const s = text(name);
  if (!s) return null;
  return s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** The compact properties a trail feature carries in a pack. */
export function trailProperties(props: Record<string, unknown>): Record<string, unknown> {
  const uses = TRAIL_USES.filter((u) => allowedTrailUseKeys(props).includes(u.key)).map((u) => u.label);
  return {
    kind: 'trail',
    name: prettyTrailName(props.trail_name),
    trail_no: text(props.trail_no),
    trailClass: trailClass(props),
    uses: uses.length > 0 ? uses.join(', ') : null,
    surface: prettyTrailName(props.trail_surface),
    width: text(props.typical_tread_width),
    tc: text(props.trail_class),
    miles: typeof props.gis_miles === 'number' ? props.gis_miles : null,
  };
}

export async function fetchTrailsPack(bounds: Bounds, ctx: PackContext = {}): Promise<PackFeatureCollection> {
  const us = usRestriction(bounds, ctx.us);
  if (us.skip) {
    ctx.onProgress?.(1);
    return emptyCollection(); // no US land in this cell
  }
  const [w, s, e, n] = bounds;
  ctx.onProgress?.(0);
  throwIfAborted(ctx.signal);
  const raw = await queryArcGisFeatures(
    TRAILS_SERVICE_URL,
    {
      // Snow and water "trails" are snowmobile / boating routes, not something you walk or ride.
      where: "trail_type = 'TERRA'",
      geometry: `${w},${s},${e},${n}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: TRAILS_OUT_FIELDS,
      returnGeometry: true,
      outSR: 4326,
      geometryPrecision: 6,
      maxAllowableOffset: TRAILS_SIMPLIFY_DEG,
    },
    { signal: ctx.signal, paginate: true, pageSize: 2000 }
  );
  const features: PackFeature[] = [];
  for (const feature of raw) {
    const g = feature.geometry;
    if (g?.type !== 'LineString' && g?.type !== 'MultiLineString') continue;
    const clipped = clipLineGeometry(g as LineGeometry, bounds);
    if (!clipped) continue;
    features.push({ type: 'Feature', properties: trailProperties(feature.properties ?? {}), geometry: clipped });
  }
  ctx.onProgress?.(1);
  return { type: 'FeatureCollection', features };
}
