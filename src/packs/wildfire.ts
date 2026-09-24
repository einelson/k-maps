/**
 * Current wildfire perimeters from NIFC's WFIGS interagency feed — the live, public-domain successor
 * to `Public_Wildfire_Perimeters_View` (that service now demands an ArcGIS token; this sibling in the
 * same org is open and carries the same 5-minute `cacheMaxAge`).
 *
 * Unlike the per-cell packs this is one nationwide collection (a few hundred small polygons, ~1 MB),
 * refreshed on a timer and cached on-device as the "last known" state — see wildfireCache.ts.
 */

import { queryArcGisFeatures } from './arcgis.ts';
import type { ArcGisFeature } from './arcgis.ts';
import { throwIfAborted } from './http.ts';
import type { PackContext, PackFeature, PackFeatureCollection } from './types.ts';

export const WILDFIRE_SERVICE_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0';

/** The service's own cache lifetime; polling faster only re-reads the same answer. */
export const WILDFIRE_REFRESH_MS = 5 * 60 * 1000;

/** ~30 m — display-only simplification; a perimeter is an approximation drawn from flights and GPS anyway. */
export const WILDFIRE_SIMPLIFY_DEG = 0.0003;

export const WILDFIRE_OUT_FIELDS = [
  'poly_IncidentName',
  'attr_IncidentName',
  'poly_GISAcres',
  'attr_IncidentSize',
  'attr_PercentContained',
  'attr_FireDiscoveryDateTime',
  'poly_PolygonDateTime',
  'poly_DateCurrent',
  'attr_POOState',
  'attr_POOCounty',
  'attr_IncidentShortDescription',
  'attr_IncidentTypeCategory',
  'attr_FireCause',
].join(',');

/** `WF` wildfire, `RX` prescribed fire, `CX` wildfire complex — the values the feed uses. */
export type WildfireCategory = 'WF' | 'RX' | 'CX';

/** What each fire polygon carries after normalizing (dates are epoch ms; `null` when the feed has none). */
export interface WildfireProperties {
  name: string;
  acres: number | null;
  /** 0-100, or null when no containment has been reported. */
  containment: number | null;
  discovered: number | null;
  /** When this perimeter was last mapped. */
  updated: number | null;
  /** Two-letter state code, e.g. `ID`. */
  state: string | null;
  county: string | null;
  description: string | null;
  category: WildfireCategory | string;
  cause: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** `US-ID` -> `ID`. */
function stateCode(v: unknown): string | null {
  const s = str(v);
  return s ? s.replace(/^US-/i, '') : null;
}

/** Flattens the service's prefixed field names into `WildfireProperties`; null for anything that isn't a polygon. */
export function normalizeWildfireFeature(feature: ArcGisFeature): PackFeature | null {
  const g = feature.geometry;
  if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') return null;
  const p = feature.properties ?? {};
  const containment = num(p.attr_PercentContained);
  const properties: WildfireProperties = {
    name: str(p.poly_IncidentName) ?? str(p.attr_IncidentName) ?? 'Unnamed fire',
    acres: num(p.poly_GISAcres) ?? num(p.attr_IncidentSize),
    containment: containment === null ? null : Math.max(0, Math.min(100, containment)),
    discovered: num(p.attr_FireDiscoveryDateTime),
    updated: num(p.poly_PolygonDateTime) ?? num(p.poly_DateCurrent),
    state: stateCode(p.attr_POOState),
    county: str(p.attr_POOCounty),
    description: str(p.attr_IncidentShortDescription),
    category: str(p.attr_IncidentTypeCategory) ?? 'WF',
    cause: str(p.attr_FireCause),
  };
  return { type: 'Feature', properties: { ...properties }, geometry: g };
}

export async function fetchWildfirePerimeters(ctx: PackContext = {}): Promise<PackFeatureCollection> {
  ctx.onProgress?.(0);
  throwIfAborted(ctx.signal);
  const raw = await queryArcGisFeatures(
    WILDFIRE_SERVICE_URL,
    {
      where: '1=1',
      outFields: WILDFIRE_OUT_FIELDS,
      returnGeometry: true,
      outSR: 4326,
      geometryPrecision: 4,
      maxAllowableOffset: WILDFIRE_SIMPLIFY_DEG,
    },
    { signal: ctx.signal, paginate: true, pageSize: 500 }
  );
  const features: PackFeature[] = [];
  for (const feature of raw) {
    const normalized = normalizeWildfireFeature(feature);
    if (normalized) features.push(normalized);
  }
  ctx.onProgress?.(1);
  return { type: 'FeatureCollection', features };
}
