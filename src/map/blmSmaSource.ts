import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import blmPrivateUnknownData from '../../assets/land/blm-private-unknown.json';
import blmPrivateUnknownMeta from '../../assets/land/blm-private-unknown.meta.json';

/**
 * BLM SMA cross-check layer (spec §2, §6.1): "not federal/state/local public
 * land" as a second opinion alongside PAD-US (src/map/landSource.ts) — not a
 * parcel-level private-ownership claim. Built by tools/fetch_blm_sma.mjs.
 */
export const BLM_PRIVATE_UNKNOWN_DATA = blmPrivateUnknownData as FeatureCollection<
  Polygon | MultiPolygon
>;
export const BLM_PRIVATE_UNKNOWN_META = blmPrivateUnknownMeta as {
  source: string;
  serviceUrl: string;
  bbox: [number, number, number, number];
  featureCount: number;
  fetchedAt: string;
  license: string;
  note: string;
};

export const BLM_AGENCY_COLORS: Record<string, string> = {
  PVT: '#9ca3af', // private
  UND: '#a855f7', // undetermined/unknown
};
const DEFAULT_BLM_COLOR = BLM_AGENCY_COLORS.UND;

export function blmAgencyLabel(code: string | null | undefined): string {
  if (code === 'PVT') return 'Private';
  if (code === 'UND') return 'Undetermined';
  return code ?? 'Unknown';
}

export const BLM_FILL_COLOR_EXPRESSION = [
  'match',
  ['get', 'ADMIN_AGENCY_CODE'],
  'PVT',
  BLM_AGENCY_COLORS.PVT,
  'UND',
  BLM_AGENCY_COLORS.UND,
  DEFAULT_BLM_COLOR,
] as unknown as import('@maplibre/maplibre-gl-style-spec').DataDrivenPropertyValueSpecification<string>;
