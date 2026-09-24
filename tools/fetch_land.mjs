#!/usr/bin/env node
/**
 * Pulls a starter public-land layer from the federal PAD-US mirror hosted by
 * USDOT (geo.dot.gov) — an alternative to the full PAD-US 4.1 GeoPackage
 * pipeline in tools/pad_us_to_mbtiles.sh, useful for a small bbox where
 * downloading/processing a whole state with ogr2ogr+tippecanoe is overkill.
 *
 * Covers the 6 federal land-management agencies this mirror exposes (BLM,
 * FWS, NPS, USACE, BOR, USFS) — NOT state/local/private-protected land, so
 * it's a subset of full PAD-US. Good enough for the "likely private
 * (inferred)" v1 approach in spec §6.1, since federal land is what matters
 * most for the public/private contrast the spec calls out.
 *
 * The ArcGIS query API returns each intersecting feature's FULL geometry,
 * not clipped to the query bbox (some of these polygons span huge
 * multi-part areas) — so every feature is clipped locally with
 * @turf/bbox-clip before writing, or the bundled file would be enormous.
 *
 * Usage: node tools/fetch_land.mjs [west south east north]
 * Default bbox: see tools/region.mjs.
 */

import { bboxClip } from '@turf/turf';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { bboxArcGisEnvelope, BBOX_WSEN } from './region.mjs';

const wsen = process.argv.slice(2).length === 4 ? process.argv.slice(2).map(Number) : BBOX_WSEN;
const envelope = bboxArcGisEnvelope(wsen);

const SERVICE_URL = 'https://geo.dot.gov/server/rest/services/FLMA/PADUS/MapServer';
const LAYERS = [
  { id: 0, name: 'PADUS_BLM' },
  { id: 1, name: 'PADUS_FWS' },
  { id: 2, name: 'PADUS_NPS' },
  { id: 3, name: 'PADUS_USACE' },
  { id: 4, name: 'PADUS_BOR' },
  { id: 5, name: 'PADUS_USFS' },
];
const OUT_FIELDS = 'Pub_Access,Own_Type,Own_Name,Mang_Type,Mang_Name,Unit_Nm,Des_Tp,GAP_Sts';

async function fetchLayer(layerId) {
  const params = new URLSearchParams({
    geometry: envelope,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    f: 'geojson',
  });
  const res = await fetch(`${SERVICE_URL}/${layerId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`ArcGIS layer ${layerId}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`ArcGIS layer ${layerId}: ${JSON.stringify(json.error)}`);
  return json.features ?? [];
}

function isEmptyGeometry(geometry) {
  if (!geometry) return true;
  if (geometry.type === 'Polygon') return geometry.coordinates.length === 0;
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.length === 0 || geometry.coordinates.every((poly) => poly.length === 0);
  }
  return false;
}

const allFeatures = [];

for (const layer of LAYERS) {
  console.log(`Fetching ${layer.name}...`);
  const features = await fetchLayer(layer.id);
  let kept = 0;
  for (const feature of features) {
    if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;
    const clipped = bboxClip(feature, wsen);
    if (isEmptyGeometry(clipped.geometry)) continue;
    allFeatures.push({
      type: 'Feature',
      properties: { ...feature.properties, source_layer: layer.name },
      geometry: clipped.geometry,
    });
    kept++;
  }
  console.log(`  ${features.length} intersecting, ${kept} kept after clipping to bbox`);
}

const outDir = path.join(import.meta.dirname, '..', 'assets', 'land');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, 'public-land.json');
await writeFile(
  outPath,
  JSON.stringify({ type: 'FeatureCollection', features: allFeatures }, null, 0)
);

const meta = {
  source: 'USGS PAD-US via USDOT ArcGIS mirror (geo.dot.gov)',
  serviceUrl: SERVICE_URL,
  agencies: LAYERS.map((l) => l.name),
  bbox: wsen,
  featureCount: allFeatures.length,
  fetchedAt: new Date().toISOString(),
  license: 'Public domain (USGS)',
  note: 'Federal land-management agencies only (BLM/FWS/NPS/USACE/BOR/USFS) — not full PAD-US (state/local/private-protected land excluded). See spec §6.5.',
};
await writeFile(path.join(outDir, 'public-land.meta.json'), JSON.stringify(meta, null, 2));

console.log(`Wrote ${allFeatures.length} clipped features to ${path.relative(process.cwd(), outPath)}`);
console.log('Source: USGS PAD-US via USDOT ArcGIS mirror (public domain) — federal agencies only, not full PAD-US. See spec §6.5 for honest limits.');
