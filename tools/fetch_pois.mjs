#!/usr/bin/env node
/**
 * Pulls starter POI pins (boat launches, campsites/trailheads) from OSM via
 * the Overpass API for one bounding box and writes them as bundled GeoJSON
 * assets. This is a one-off/occasional refresh script, not something the app
 * runs at runtime — re-run it by hand to update the bundled data.
 *
 * Usage: node tools/fetch_pois.mjs [west south east north]
 * Default bbox: see tools/region.mjs.
 */

import { bboxOverpass, BBOX_WSEN } from './region.mjs';

const wsen = process.argv.slice(2).length === 4 ? process.argv.slice(2).map(Number) : BBOX_WSEN;
const bbox = bboxOverpass(wsen);

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const QUERIES = {
  'boat-launches': `[out:json][timeout:25];node["leisure"="slipway"](${bbox});out body;`,
  'campsites-trails': `[out:json][timeout:25];(
    node["tourism"="camp_site"](${bbox});
    node["highway"="trailhead"](${bbox});
    node["tourism"="information"]["information"="trailhead"](${bbox});
  );out body;`,
};

async function fetchOverpass(query) {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
      'User-Agent': 'k-maps-dev/1.0 (https://github.com/einelson/k-maps)',
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass API ${res.status}: ${await res.text()}`);
  return res.json();
}

function toFeatureCollection(overpassJson, category) {
  const features = overpassJson.elements
    .filter((el) => el.type === 'node')
    .map((el) => ({
      type: 'Feature',
      properties: {
        category,
        name: el.tags?.name ?? null,
        osm_id: el.id,
        tags: el.tags ?? {},
      },
      geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
    }));
  return { type: 'FeatureCollection', features };
}

const { writeFile, mkdir } = await import('node:fs/promises');
const path = await import('node:path');
const outDir = path.join(import.meta.dirname, '..', 'assets', 'poi');
await mkdir(outDir, { recursive: true });

for (const [id, query] of Object.entries(QUERIES)) {
  console.log(`Fetching ${id} for bbox ${bbox}...`);
  const json = await fetchOverpass(query);
  const fc = toFeatureCollection(json, id);
  const outPath = path.join(outDir, `${id}.json`);
  await writeFile(outPath, JSON.stringify(fc, null, 2));
  console.log(`Wrote ${fc.features.length} features to ${path.relative(process.cwd(), outPath)}`);
}

console.log('Attribution reminder: this data is © OpenStreetMap contributors (ODbL) — keep the attribution visible on the map surface (spec §11).');
