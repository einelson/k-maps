/**
 * Public-land pack (spec §6): PAD-US polygons for one cell, clipped to it,
 * plus boundary-free outlines and the inferred "likely private" remainder.
 *
 *  - Federal land (BLM/FWS/NPS/USACE/BOR/USFS): USDOT FLMA mirror of PAD-US,
 *    one MapServer layer per agency.
 *  - Non-federal PUBLIC land (state/local/special-district/joint): USGS's own
 *    PAD-US 4.1 FeatureServer. State endowment land is a big share of the
 *    acreage in places like Idaho; without it that land would render as
 *    "likely private". Private and NGO conservation land is deliberately
 *    excluded — protected is not public.
 */

import { queryArcGisFeatures } from './arcgis.ts';
import type { ArcGisFeature } from './arcgis.ts';
import { clipPolygonGeometry, linesToGeometry, polygonOutlineRuns } from './clip.ts';
import type { PolygonGeometry } from './clip.ts';
import { computeLikelyPrivate } from './likelyPrivate.ts';
import type { Bounds, PackContext, PackFeature, PackFeatureCollection } from './types.ts';
import { throwIfAborted } from './http.ts';
import { emptyCollection, usEdgeLand, usRestriction } from './usFilter.ts';

export const LAND_FEDERAL_SERVICE_URL =
  'https://geo.dot.gov/server/rest/services/FLMA/PADUS/MapServer';
export const LAND_FEDERAL_LAYERS = [
  { id: 0, name: 'PADUS_BLM' },
  { id: 1, name: 'PADUS_FWS' },
  { id: 2, name: 'PADUS_NPS' },
  { id: 3, name: 'PADUS_USACE' },
  { id: 4, name: 'PADUS_BOR' },
  { id: 5, name: 'PADUS_USFS' },
] as const;
export const LAND_OUT_FIELDS = 'Pub_Access,Own_Type,Own_Name,Mang_Type,Mang_Name,Unit_Nm,Des_Tp,GAP_Sts';

export const LAND_NONFEDERAL_URL =
  'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Type_PADUS/FeatureServer/0';
export const LAND_NONFEDERAL_MANAGER_TYPES = ['STAT', 'LOC', 'DIST', 'JNT'] as const;
/**
 * Des_Tp values dropped from the non-federal query. `UNKE` ("unknown easement", e.g. "Unknown Idaho
 * Department of Lands") is easement linework, not public land: Pub_Access is always UK, Own_Type UNK,
 * and in the Treasure Valley it is 68% of all polygons but 0.2% of the area — small parcels that would
 * only punch holes in the likely-private layer.
 */
export const LAND_EXCLUDED_DESIGNATIONS = ['UNKE'] as const;
/** ~22 m — display-only simplification, keeps packs small (spec §6.5: boundaries are approximate anyway). */
export const LAND_SIMPLIFY_DEG = 0.0002;
/** ~3 m for federal polygons: far below the data's own accuracy, but halves the vertex count of forest-scale polygons. */
export const LAND_FEDERAL_SIMPLIFY_DEG = 0.00003;
export const PUB_ACCESS_VINTAGE = 'PAD-US 4.1 (USGS, March 2025)';

export type LandKind = 'public' | 'outline' | 'private';

export type LandFeatureCollection = PackFeatureCollection;

function envelopeOf([w, s, e, n]: Bounds): string {
  return `${w},${s},${e},${n}`;
}

interface Progress {
  step: number;
  total: number;
  report: (fraction: number) => void;
}

function bump(p: Progress): void {
  p.step++;
  p.report(Math.min(1, p.step / p.total));
}

/** Clips service polygons to `bounds` and tags them as `public` features. */
function toPublicFeatures(
  features: ArcGisFeature[],
  bounds: Bounds,
  sourceLayer: (f: ArcGisFeature) => string
): PackFeature[] {
  const out: PackFeature[] = [];
  for (const feature of features) {
    const g = feature.geometry;
    if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') continue;
    const clipped = clipPolygonGeometry(g as PolygonGeometry, bounds);
    if (!clipped) continue;
    const p = feature.properties ?? {};
    out.push({
      type: 'Feature',
      properties: {
        kind: 'public',
        Pub_Access: p.Pub_Access ?? null,
        Own_Type: p.Own_Type ?? null,
        Own_Name: p.Own_Name ?? null,
        Mang_Type: p.Mang_Type ?? null,
        Mang_Name: p.Mang_Name ?? null,
        Unit_Nm: p.Unit_Nm ?? null,
        Des_Tp: p.Des_Tp ?? null,
        GAP_Sts: p.GAP_Sts ?? null,
        source_layer: sourceLayer(feature),
      },
      geometry: clipped,
    });
  }
  return out;
}

/**
 * One outline feature per Pub_Access value: every polygon ring with the
 * segments lying ON the clip rectangle removed, so adjacent downloaded
 * cells don't draw artificial grid lines at their shared border.
 */
export function buildOutlines(publicFeatures: PackFeature[], bounds: Bounds): PackFeature[] {
  const byAccess = new Map<string, number[][][]>();
  for (const f of publicFeatures) {
    const runs = polygonOutlineRuns(f.geometry as PolygonGeometry, bounds);
    if (runs.length === 0) continue;
    const key = String(f.properties?.Pub_Access ?? 'UK');
    const list = byAccess.get(key) ?? [];
    for (const run of runs) list.push(run);
    byAccess.set(key, list);
  }
  const out: PackFeature[] = [];
  for (const [access, lines] of byAccess) {
    const geometry = linesToGeometry(lines);
    if (geometry) out.push({ type: 'Feature', properties: { kind: 'outline', Pub_Access: access }, geometry });
  }
  return out;
}

export interface LandPackOptions {
  /** Skip the (CPU-heavy) likely-private computation, e.g. for debugging. */
  skipPrivate?: boolean;
}

export async function fetchLandPack(
  bounds: Bounds,
  ctx: PackContext = {},
  options: LandPackOptions = {}
): Promise<LandFeatureCollection> {
  const { signal } = ctx;
  if (usRestriction(bounds, ctx.us).skip) {
    ctx.onProgress?.(1);
    return emptyCollection(); // no US land in this cell: nothing to draw, nothing to fetch
  }
  const envelope = envelopeOf(bounds);
  const progress: Progress = {
    step: 0,
    total: LAND_FEDERAL_LAYERS.length + 1 + (options.skipPrivate ? 0 : 1),
    report: (f) => ctx.onProgress?.(f),
  };
  ctx.onProgress?.(0);

  const publicFeatures: PackFeature[] = [];

  for (const layer of LAND_FEDERAL_LAYERS) {
    throwIfAborted(signal);
    const features = await queryArcGisFeatures(
      `${LAND_FEDERAL_SERVICE_URL}/${layer.id}`,
      {
        geometry: envelope,
        geometryType: 'esriGeometryEnvelope',
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: LAND_OUT_FIELDS,
        returnGeometry: true,
        outSR: 4326,
        geometryPrecision: 6,
        maxAllowableOffset: LAND_FEDERAL_SIMPLIFY_DEG,
      },
      { signal }
    );
    for (const f of toPublicFeatures(features, bounds, () => layer.name)) publicFeatures.push(f);
    bump(progress);
  }

  throwIfAborted(signal);
  const nonFederal = await queryArcGisFeatures(
    LAND_NONFEDERAL_URL,
    {
      where:
        `Mang_Type IN (${LAND_NONFEDERAL_MANAGER_TYPES.map((t) => `'${t}'`).join(',')})` +
        ` AND (Des_Tp IS NULL OR Des_Tp NOT IN (${LAND_EXCLUDED_DESIGNATIONS.map((t) => `'${t}'`).join(',')}))`,
      geometry: envelope,
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: LAND_OUT_FIELDS,
      returnGeometry: true,
      outSR: 4326,
      geometryPrecision: 5,
      maxAllowableOffset: LAND_SIMPLIFY_DEG,
    },
    { signal, paginate: true, pageSize: 1000 }
  );
  for (const f of toPublicFeatures(nonFederal, bounds, (f) => `PADUS4_1_${f.properties?.Mang_Type}`)) {
    publicFeatures.push(f);
  }
  bump(progress);

  const features: PackFeature[] = [...publicFeatures, ...buildOutlines(publicFeatures, bounds)];

  if (!options.skipPrivate) {
    throwIfAborted(signal);
    const priv = await computeLikelyPrivate(
      bounds,
      publicFeatures.map((f) => f.geometry as PolygonGeometry),
      { signal, land: usEdgeLand(bounds, ctx.us) }
    );
    for (const geometry of priv) {
      features.push({ type: 'Feature', properties: { kind: 'private' }, geometry });
    }
    bump(progress);
  }

  ctx.onProgress?.(1);
  return { type: 'FeatureCollection', features };
}
