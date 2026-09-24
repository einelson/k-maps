import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';

import publicLandData from '../../assets/land/public-land.json';
import publicLandMeta from '../../assets/land/public-land.meta.json';

/**
 * Land layer (spec §6) for the bundled, cell-aligned starter region
 * (src/packs/region.ts) — the same pack format that `fetchLandPack`
 * (src/packs/land.ts) downloads per cell on-device. Built by
 * tools/build_starter_pack.mjs from PAD-US: federal agencies via a USDOT
 * ArcGIS mirror, plus state/local/district/joint public land from USGS's
 * PAD-US 4.1 feature service. Private and NGO conservation land is excluded
 * and tribal land isn't covered.
 *
 * One collection, three feature kinds (`properties.kind`):
 *  - `public`  Polygon|MultiPolygon, colored by `Pub_Access`
 *  - `outline` LineString|MultiLineString, `Pub_Access` for color (dash `RA`); the segments on the
 *              region/cell border are removed so adjacent packs draw no grid lines
 *  - `private` Polygon, "likely private (inferred)": the region minus all public land
 */
export type LandKind = 'public' | 'outline' | 'private';
export type LandGeometry = Polygon | MultiPolygon | LineString | MultiLineString;

export const PUBLIC_LAND_DATA = publicLandData as FeatureCollection<LandGeometry>;
export const PUBLIC_LAND_META = publicLandMeta as {
  source: string;
  serviceUrl: string;
  agencies: string[];
  nonFederal: { serviceUrl: string; managerTypes: string[] };
  /** [west, south, east, north] of the bundled region (cell-aligned). */
  bbox: [number, number, number, number];
  cellRect: { cxMin: number; cxMax: number; cyMin: number; cyMax: number };
  /** Number of `public` polygons (same meaning as before the pack format). */
  featureCount: number;
  /** Feature counts per `kind`. */
  kinds: Record<LandKind, number>;
  fetchedAt: string;
  /** PAD-US release the `Pub_Access` values come from. */
  pubAccessVintage: string;
  license: string;
  note: string;
};

/** MapLibre filter (as a plain expression) selecting one land feature kind, e.g. for a Layer's `filter` prop. */
export function landKindFilter(kind: LandKind) {
  return ['==', ['get', 'kind'], kind] as unknown as import('@maplibre/maplibre-gl-style-spec').FilterSpecification;
}

/** Tint for the inferred "likely private" areas (spec §6.4) — deliberately muted, it is an inference, not data. */
export const LIKELY_PRIVATE_COLOR = '#7c3aed';
export const LIKELY_PRIVATE_LABEL = 'Likely private (inferred)';

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
