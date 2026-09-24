#!/usr/bin/env node
/**
 * Pulls the BLM "Private or Unknown" surface-management layer — the
 * second-opinion cross-check on "not public" the spec calls out in §2
 * ("One BLM service variant includes Private and Unknown classes"). Not the
 * full agency-by-agency SMA layer, since PAD-US (src/packs/land.ts, tools/build_starter_pack.mjs)
 * already covers the federal-agency side; this fills the specific gap
 * PAD-US doesn't cover.
 *
 * This service returns each intersecting feature's FULL (unclipped)
 * geometry same as PAD-US (see src/packs/land.ts), but its geometries
 * are dense enough that an unsimplified query 500s or returns tens of MB
 * for a small bbox — `maxAllowableOffset` (server-side line simplification,
 * in output SR units — degrees here) is required to get a response at all.
 * ~0.0005° (~50 m) is a display-only simplification, not survey-grade.
 *
 * Usage: node tools/fetch_blm_sma.mjs [west south east north]
 * Default bbox: the cell-aligned bundled region, see tools/region.mjs / src/packs/region.ts.
 */

import { bboxClip } from '@turf/turf';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { bboxArcGisEnvelope, BBOX_WSEN } from './region.mjs';

const wsen = process.argv.slice(2).length === 4 ? process.argv.slice(2).map(Number) : BBOX_WSEN;
const envelope = bboxArcGisEnvelope(wsen);

const SERVICE_URL =
  'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/16';
const OUT_FIELDS = 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE,ADMIN_DEPT_CODE,ADMIN_UNIT_TYPE';

function isEmptyGeometry(geometry) {
  if (!geometry) return true;
  if (geometry.type === 'Polygon') return geometry.coordinates.length === 0;
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.length === 0 || geometry.coordinates.every((poly) => poly.length === 0);
  }
  return false;
}

console.log(`Fetching BLM Private/Unknown layer for bbox ${envelope}...`);
const params = new URLSearchParams({
  geometry: envelope,
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
  outFields: OUT_FIELDS,
  returnGeometry: 'true',
  outSR: '4326',
  maxAllowableOffset: '0.0005',
  geometryPrecision: '5',
  f: 'geojson',
});
const res = await fetch(`${SERVICE_URL}/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params.toString(),
});
if (!res.ok) throw new Error(`BLM SMA query: HTTP ${res.status}: ${await res.text()}`);
const json = await res.json();
if (json.error) throw new Error(`BLM SMA query: ${JSON.stringify(json.error)}`);

let kept = 0;
const features = [];
for (const feature of json.features ?? []) {
  if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;
  const clipped = bboxClip(feature, wsen);
  if (isEmptyGeometry(clipped.geometry)) continue;
  features.push({ type: 'Feature', properties: feature.properties, geometry: clipped.geometry });
  kept++;
}
console.log(`${json.features?.length ?? 0} intersecting, ${kept} kept after clipping to bbox`);

const outDir = path.join(import.meta.dirname, '..', 'assets', 'land');
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'blm-private-unknown.json'),
  JSON.stringify({ type: 'FeatureCollection', features }, null, 0)
);

const meta = {
  source: 'BLM National Surface Management Agency (Private or Unknown layer)',
  serviceUrl: SERVICE_URL,
  bbox: wsen,
  featureCount: features.length,
  fetchedAt: new Date().toISOString(),
  license: 'Public domain (BLM)',
  note: 'Cross-check layer only — "not classified as federal/state/local public land", not a parcel-level private-ownership claim. Simplified with maxAllowableOffset=0.0005° for size; display only.',
};
await writeFile(path.join(outDir, 'blm-private-unknown.meta.json'), JSON.stringify(meta, null, 2));
console.log(`Wrote ${features.length} features.`);
