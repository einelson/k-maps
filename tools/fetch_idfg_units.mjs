#!/usr/bin/env node
/**
 * Pulls Idaho Fish and Game's Game Management Unit (hunt unit) polygons — the state-level layer the
 * spec's "State-level" note asks for — from IDFG's own open-data FeatureServer and bundles them as a
 * static asset. Unlike land/MVUM this is one small statewide collection (100 units), so it ships with
 * the app instead of downloading per cell. Units are re-drawn rarely (regulations are yearly);
 * re-run this once a season.
 *
 * `maxAllowableOffset` (~30 m) is display-only simplification, same reasoning as tools/fetch_blm_sma.mjs.
 * The service's `*_url` columns are HTML anchors (`<a href="...">Unit 60A</a>`); only the hrefs are kept.
 *
 * Usage: node tools/fetch_idfg_units.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SERVICE_URL =
  'https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/GameManagementUnits/FeatureServer/0';
const OUT_FIELDS = 'NAME,ID,Elk_Zone,regular_deer_url,elkZone_url_1';

/** `<a href="https://x" target="_top">Unit 1</a>` -> `https://x`. */
export function hrefOf(html) {
  if (typeof html !== 'string') return null;
  const match = /href\s*=\s*["']([^"']+)["']/i.exec(html);
  return match && /^https?:\/\//i.test(match[1]) ? match[1] : null;
}

/** Hunt units are numbers with an optional letter (39, 60A). Anything else in the layer isn't a unit. */
const UNIT_PATTERN = /^\d+[A-Z]?$/;
/** Non-unit polygons IDFG includes in the layer, by their NAME. */
const NON_UNIT_NAMES = { YNP: 'Yellowstone National Park' };

/** What the map and tap card call a polygon: "Unit 39", or its real name when it isn't a hunt unit. */
export function displayLabel(name) {
  if (UNIT_PATTERN.test(name)) return `Unit ${name}`;
  return NON_UNIT_NAMES[name] ?? name;
}

function normalize(feature) {
  const p = feature.properties ?? {};
  const unit = String(p.NAME ?? '').trim();
  return {
    type: 'Feature',
    properties: {
      unit,
      label: displayLabel(unit),
      isUnit: UNIT_PATTERN.test(unit),
      id: typeof p.ID === 'number' ? p.ID : null,
      elkZone: typeof p.Elk_Zone === 'string' && p.Elk_Zone.trim() ? p.Elk_Zone.trim() : null,
      deerUrl: hrefOf(p.regular_deer_url),
      elkUrl: hrefOf(p.elkZone_url_1),
    },
    geometry: feature.geometry,
  };
}

console.log('Fetching IDFG Game Management Units...');
const params = new URLSearchParams({
  where: '1=1',
  outFields: OUT_FIELDS,
  returnGeometry: 'true',
  outSR: '4326',
  maxAllowableOffset: '0.0003',
  geometryPrecision: '5',
  f: 'geojson',
});
const res = await fetch(`${SERVICE_URL}/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params.toString(),
});
if (!res.ok) throw new Error(`IDFG units query: HTTP ${res.status}: ${await res.text()}`);
const json = await res.json();
if (json.error) throw new Error(`IDFG units query: ${JSON.stringify(json.error)}`);
if (json.exceededTransferLimit || json.properties?.exceededTransferLimit) {
  throw new Error('IDFG units query was truncated — page it before bundling');
}

const features = (json.features ?? [])
  .filter((f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
  .map(normalize)
  .filter((f) => f.properties.unit !== '');
features.sort((a, b) => a.properties.unit.localeCompare(b.properties.unit, undefined, { numeric: true }));
console.log(`${json.features?.length ?? 0} returned, ${features.length} kept`);

const outDir = path.join(import.meta.dirname, '..', 'assets', 'idfg');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'game-units.json'), JSON.stringify({ type: 'FeatureCollection', features }));
await writeFile(
  path.join(outDir, 'game-units.meta.json'),
  JSON.stringify(
    {
      source: 'Idaho Department of Fish and Game — Game Management Units',
      serviceUrl: SERVICE_URL,
      featureCount: features.length,
      fetchedAt: new Date().toISOString(),
      license: 'Idaho Fish and Game open GIS data (informational; no warranty)',
      note: "IDFG calls this a best representation only: confirm unit boundaries in the current IDFG regulation booklet before hunting. Simplified with maxAllowableOffset=0.0003° for size; display only.",
    },
    null,
    2
  )
);
console.log(`Wrote ${features.length} units to assets/idfg/.`);
