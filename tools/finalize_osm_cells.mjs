#!/usr/bin/env node
/**
 * Turns the raw per-state OSM cells (tools/osm_cells.py, packs/build/cache/osm-raw/<state>/{osm,poi}) into the cells
 * the region packs are zipped from (packs/build/cache/cells/{osm,poi}):
 *
 *   - a cell on a state line is in both states' extracts: the two copies are merged, keeping one feature per OSM id
 *     (the fuller one, when an extract cut a way short at its edge);
 *   - the US-only limits are applied with the same code the app runs (src/packs/usFilter.ts): no data for a cell
 *     with no US land, and in a coast / border cell nothing outside the US;
 *   - the merge bookkeeping `_id` is dropped, and every cell of every state gets a file (empty where OSM has nothing).
 *
 *   node tools/finalize_osm_cells.mjs [state ...]     # default: every state that has a DONE marker in osm-raw
 */
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { cellEntryName, parseCellEntryName } from '../src/packs/regionPacks.ts';
import { createUsCoverage } from '../src/packs/usCoverage.ts';
import { emptyCollection, restrictToUs, usRestriction } from '../src/packs/usFilter.ts';
import { cellBounds } from '../src/downloads/cells.ts';
import { buildDir } from './packManifest.mjs';
import { REGIONS } from './regionCells.mjs';

const repoRoot = path.join(import.meta.dirname, '..');
const rawDir = path.join(buildDir, 'cache', 'osm-raw');
const outDir = path.join(buildDir, 'cache', 'cells');
const LAYERS = ['osm', 'poi'];

const us = createUsCoverage(JSON.parse(await readFile(path.join(repoRoot, 'assets', 'us', 'us-cells.json'), 'utf8')));
const stateCells = JSON.parse(await readFile(path.join(repoRoot, 'assets', 'us', 'us-state-cells.json'), 'utf8'));

const requested = process.argv.slice(2);
const regionIds = requested.length ? requested : Object.keys(REGIONS);
const done = [];
for (const id of Object.keys(REGIONS)) {
  try {
    await stat(path.join(rawDir, id, 'DONE'));
    done.push(id);
  } catch {
    // not extracted yet
  }
}
const missing = regionIds.filter((id) => !done.includes(id));
if (missing.length) console.log(`Not extracted yet (skipped): ${missing.join(', ')}`);
const wanted = regionIds.filter((id) => done.includes(id));

// Every cell any wanted state needs, and which extracted states might hold data for it.
const cellsNeeded = new Map();
for (const id of wanted) {
  for (const [cx, cy] of stateCells[REGIONS[id].state]) cellsNeeded.set(`${cx}_${cy}`, [cx, cy]);
}

const vertexCount = (feature) => {
  const g = feature.geometry;
  if (g.type === 'Point') return 1;
  if (g.type === 'LineString') return g.coordinates.length;
  return g.coordinates.reduce((sum, line) => sum + line.length, 0);
};

/** One feature per OSM id (per category for pins), the fuller copy winning. */
function merge(files) {
  const byId = new Map();
  for (const file of files) {
    for (const feature of file.features) {
      const key = `${feature.properties._id}:${feature.properties.category ?? ''}`;
      const have = byId.get(key);
      if (!have || vertexCount(feature) > vertexCount(have)) byId.set(key, feature);
    }
  }
  return [...byId.values()];
}

const stripId = (feature) => {
  const { _id, ...properties } = feature.properties;
  return { ...feature, properties };
};

for (const layer of LAYERS) {
  const dir = path.join(outDir, layer);
  await mkdir(dir, { recursive: true });
  const holders = new Map(); // cell key -> raw files that exist for it
  for (const id of done) {
    let names = [];
    try {
      names = await readdir(path.join(rawDir, id, layer));
    } catch {
      continue;
    }
    for (const name of names) {
      const cell = parseCellEntryName(name);
      if (!cell) continue;
      const key = `${cell.cx}_${cell.cy}`;
      if (!cellsNeeded.has(key)) continue;
      if (!holders.has(key)) holders.set(key, []);
      holders.get(key).push(path.join(rawDir, id, layer, name));
    }
  }

  let written = 0;
  let features = 0;
  let bytes = 0;
  for (const [key, [cx, cy]] of cellsNeeded) {
    const restriction = usRestriction(cellBounds(cx, cy), us);
    let collection = emptyCollection();
    const files = holders.get(key);
    if (files && !restriction.skip) {
      const raw = await Promise.all(files.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
      let list = merge(raw);
      if (restriction.contains) list = restrictToUs(list, restriction.contains);
      collection = { type: 'FeatureCollection', features: list.map(stripId) };
    }
    const text = JSON.stringify(collection);
    const target = path.join(dir, cellEntryName(cx, cy));
    await writeFile(`${target}.tmp`, text);
    await rename(`${target}.tmp`, target);
    written++;
    features += collection.features.length;
    bytes += text.length;
  }
  console.log(`${layer}: ${written} cells, ${features} features, ${(bytes / 1e6).toFixed(0)} MB`);
}
