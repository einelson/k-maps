#!/usr/bin/env node
/**
 * Builds the BUNDLED starter data (assets/land, assets/mvum, assets/poi) by
 * running the very same pack modules the app runs on-device (src/packs/*.ts,
 * loaded via node's type stripping) over the cell-aligned starter region
 * (src/packs/region.ts). Replaces the old one-off fetch_land / fetch_mvum /
 * fetch_pois scripts.
 *
 *   node tools/build_starter_pack.mjs [land] [mvum] [poi]   # default: all three
 *
 * Writes:
 *   assets/land/public-land.json + public-land.meta.json   (public + outline + private kinds)
 *   assets/mvum/mvum.json        + mvum.meta.json          (with derived vehicleClass)
 *   assets/poi/boat-launches.json, campsites-trails.json   (Point collections)
 *
 * Needs network access (ArcGIS services + Overpass). The land pack's
 * likely-private step is CPU-heavy for a region this size; expect a minute or
 * two.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  fetchLandPack,
  LAND_FEDERAL_LAYERS,
  LAND_FEDERAL_SERVICE_URL,
  LAND_NONFEDERAL_MANAGER_TYPES,
  LAND_NONFEDERAL_URL,
  PUB_ACCESS_VINTAGE,
} from '../src/packs/land.ts';
import { fetchMvumPack, MVUM_SERVICE_URL } from '../src/packs/mvum.ts';
import { fetchPoiPack } from '../src/packs/poi.ts';
import { BBOX_WSEN, BUNDLED_CELL_RECT } from './region.mjs';

const assetsDir = path.join(import.meta.dirname, '..', 'assets');
const wanted = process.argv.slice(2);
const want = (name) => wanted.length === 0 || wanted.includes(name);

function progress(label) {
  let last = -1;
  return (fraction) => {
    const pct = Math.floor(fraction * 100);
    if (pct !== last) {
      last = pct;
      process.stdout.write(`\r  ${label}: ${pct}%   `);
    }
  };
}

async function write(file, data, pretty = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const text = JSON.stringify(data, null, pretty ? 2 : 0);
  await writeFile(file, text);
  console.log(`  wrote ${path.relative(process.cwd(), file)} (${(text.length / 1e6).toFixed(2)} MB)`);
}

function countBy(features, key) {
  const counts = {};
  for (const f of features) {
    const k = f.properties?.[key];
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

console.log(`Bundled region: cells x ${BUNDLED_CELL_RECT.cxMin}..${BUNDLED_CELL_RECT.cxMax}, y ${BUNDLED_CELL_RECT.cyMin}..${BUNDLED_CELL_RECT.cyMax}; bbox ${BBOX_WSEN.join(', ')}`);

if (want('land')) {
  console.log('Land (PAD-US federal + non-federal public, outlines, likely private)...');
  const t = Date.now();
  const fc = await fetchLandPack(BBOX_WSEN, { onProgress: progress('land') });
  console.log(`\n  ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const kinds = countBy(fc.features, 'kind');
  await write(path.join(assetsDir, 'land', 'public-land.json'), fc);
  await write(
    path.join(assetsDir, 'land', 'public-land.meta.json'),
    {
      source: 'USGS PAD-US (federal via USDOT mirror; state/local via USGS PAD-US 4.1 service)',
      serviceUrl: LAND_FEDERAL_SERVICE_URL,
      agencies: LAND_FEDERAL_LAYERS.map((l) => l.name),
      nonFederal: { serviceUrl: LAND_NONFEDERAL_URL, managerTypes: [...LAND_NONFEDERAL_MANAGER_TYPES] },
      bbox: BBOX_WSEN,
      cellRect: BUNDLED_CELL_RECT,
      featureCount: kinds.public ?? 0,
      kinds,
      fetchedAt: new Date().toISOString(),
      pubAccessVintage: PUB_ACCESS_VINTAGE,
      license: 'Public domain (USGS)',
      note: 'Federal agencies (BLM/FWS/NPS/USACE/BOR/USFS) plus state/local/district/joint public land from PAD-US 4.1. Private and NGO conservation land excluded; tribal land not included. Features carry kind: public (polygon), outline (public outlines with clip-edge segments removed) or private (inferred: region minus public land, slivers dropped). See spec §6.5.',
    },
    true
  );
  console.log('  kinds:', kinds);
}

if (want('mvum')) {
  console.log('MVUM roads + trails...');
  const fc = await fetchMvumPack(BBOX_WSEN, { onProgress: progress('mvum') });
  console.log('');
  await write(path.join(assetsDir, 'mvum', 'mvum.json'), fc);
  await write(
    path.join(assetsDir, 'mvum', 'mvum.meta.json'),
    {
      source: 'USFS Enterprise Data Warehouse — Motor Vehicle Use Map (Roads + Trails)',
      serviceUrl: MVUM_SERVICE_URL,
      bbox: BBOX_WSEN,
      cellRect: BUNDLED_CELL_RECT,
      featureCount: fc.features.length,
      kinds: countBy(fc.features, 'kind'),
      vehicleClasses: countBy(fc.features, 'vehicleClass'),
      fetchedAt: new Date().toISOString(),
      license: 'Public domain (USFS)',
    },
    true
  );
}

if (want('poi')) {
  console.log('POI pins (OpenStreetMap via Overpass)...');
  const fc = await fetchPoiPack(BBOX_WSEN, { onProgress: progress('poi') });
  console.log('');
  const files = { boatLaunches: 'boat-launches.json', campsitesTrails: 'campsites-trails.json' };
  for (const [category, file] of Object.entries(files)) {
    const features = fc.features.filter((f) => f.properties.category === category);
    await write(path.join(assetsDir, 'poi', file), { type: 'FeatureCollection', features });
    console.log(`  ${category}: ${features.length} pins`);
  }
}

console.log('Done. Land/MVUM/POI data © USGS / USFS (public domain) and © OpenStreetMap contributors (ODbL).');
