#!/usr/bin/env node
/**
 * Debug a data pack without the app: runs the SAME pure modules the app runs
 * on-device (src/packs/*.ts, loaded via node's type stripping) for a bounding
 * box and writes the resulting GeoJSON FeatureCollection.
 *
 * Usage: node tools/fetch_pack.mjs <land|mvum|trails|poi|osm> <west> <south> <east> <north> [out.json]
 *
 * Example (Boise foothills cell z10 181/373):
 *   node tools/fetch_pack.mjs osm -116.3671875 43.58039 -116.015625 43.834527 /tmp/osm.json
 */
import { writeFile } from 'node:fs/promises';

import { fetchLandPack } from '../src/packs/land.ts';
import { fetchMvumPack } from '../src/packs/mvum.ts';
import { fetchOsmRoadsPack } from '../src/packs/osm.ts';
import { fetchPoiPack } from '../src/packs/poi.ts';
import { fetchTrailsPack } from '../src/packs/trails.ts';

const FETCHERS = {
  land: fetchLandPack,
  mvum: fetchMvumPack,
  trails: fetchTrailsPack,
  poi: fetchPoiPack,
  osm: fetchOsmRoadsPack,
};

const [layer, ...rest] = process.argv.slice(2);
const bounds = rest.slice(0, 4).map(Number);
const outPath = rest[4];

if (!FETCHERS[layer] || bounds.length !== 4 || bounds.some(Number.isNaN)) {
  console.error('Usage: node tools/fetch_pack.mjs <land|mvum|trails|poi|osm> <west> <south> <east> <north> [out.json]');
  process.exit(1);
}

const started = Date.now();
let lastPct = -1;
const fc = await FETCHERS[layer](bounds, {
  onProgress: (f) => {
    const pct = Math.floor(f * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      process.stderr.write(`\r${layer}: ${pct}%   `);
    }
  },
});
process.stderr.write('\n');

const json = JSON.stringify(fc);
const kinds = {};
for (const f of fc.features) {
  const key = f.properties?.kind ?? f.properties?.cls ?? f.properties?.category ?? f.geometry.type;
  kinds[key] = (kinds[key] ?? 0) + 1;
}
console.log(
  `${layer}: ${fc.features.length} features in ${((Date.now() - started) / 1000).toFixed(1)} s, ` +
    `${(json.length / 1e6).toFixed(2)} MB`,
  kinds
);
if (outPath) {
  await writeFile(outPath, json);
  console.log(`Wrote ${outPath}`);
}
