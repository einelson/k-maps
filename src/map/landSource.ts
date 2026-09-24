import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import publicLandData from '../../assets/land/public-land.json';
import publicLandMeta from '../../assets/land/public-land.meta.json';

/**
 * Public land layer (spec §6). Bundled as static GeoJSON — same reasoning as
 * src/map/poiSources.ts. Built by tools/fetch_land.mjs from PAD-US via a
 * USDOT ArcGIS mirror, which only covers 6 federal agencies (not full
 * PAD-US); re-run tools/pad_us_to_mbtiles.sh against a real state PAD-US
 * download for full coverage including state/local/private-protected land.
 */
export const PUBLIC_LAND_DATA = publicLandData as FeatureCollection<Polygon | MultiPolygon>;
export const PUBLIC_LAND_META = publicLandMeta as {
  source: string;
  serviceUrl: string;
  agencies: string[];
  bbox: [number, number, number, number];
  featureCount: number;
  fetchedAt: string;
  license: string;
  note: string;
};

/** PAD-US `Pub_Access` codes (spec §2, §6.3). */
export type PubAccessCode = 'OA' | 'RA' | 'XA' | 'UK';

export const PUB_ACCESS_LABELS: Record<PubAccessCode, string> = {
  OA: 'Open',
  RA: 'Restricted',
  XA: 'Closed',
  UK: 'Unknown access',
};

export const PUB_ACCESS_COLORS: Record<PubAccessCode, string> = {
  OA: '#2f6f4f', // green
  RA: '#b45309', // amber
  XA: '#b91c1c', // red
  UK: '#64748b', // blue-gray
};

const DEFAULT_ACCESS_COLOR = PUB_ACCESS_COLORS.UK;

export function pubAccessLabel(code: string | null | undefined): string {
  return (code && PUB_ACCESS_LABELS[code as PubAccessCode]) || 'Unknown access';
}

/**
 * MapLibre `match` expression: Pub_Access code -> fill/line color (§6.3
 * styling rules). Cast at this boundary rather than fighting the style
 * spec's deep discriminated-union typing — same reasoning as
 * src/map/filterExpression.ts.
 */
export const LAND_FILL_COLOR_EXPRESSION = [
  'match',
  ['get', 'Pub_Access'],
  'OA',
  PUB_ACCESS_COLORS.OA,
  'RA',
  PUB_ACCESS_COLORS.RA,
  'XA',
  PUB_ACCESS_COLORS.XA,
  'UK',
  PUB_ACCESS_COLORS.UK,
  DEFAULT_ACCESS_COLOR,
] as unknown as import('@maplibre/maplibre-gl-style-spec').DataDrivenPropertyValueSpecification<string>;
