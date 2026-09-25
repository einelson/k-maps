#!/usr/bin/env node
/**
 * Builds hosted REGION PACKS: for a region (tools/regionCells.mjs) it runs the very same per-cell fetchers
 * the app runs on-device (src/packs/*.ts, loaded via node's type stripping) over every z10 cell, then zips
 * each layer's cell files into `<region>-<layer>.zip` and records them in `manifest.json` — the files the
 * app's Downloads -> Region packs section installs (src/downloads/regionPackInstaller.ts).
 *
 *   node tools/build_region_pack.mjs <region> [land] [mvum] [trails]   # default: all three layers
 *        [--concurrency N]   cells fetched at once (default 3; be gentle with the public services)
 *        [--limit N]         only the first N cells — a quick trial run, never publish the result
 *        [--publish]         upload the zips + manifest to the rolling `data` GitHub release (needs `gh`)
 *
 * Output goes to packs/build/ (git-ignored). Fetched cells are cached in packs/build/cache/, so an
 * interrupted or partly failed run picks up where it stopped; delete the cache to refetch fresh data.
 * Expect roughly 10 s per cell for land (the likely-private step is CPU-heavy) and about 1 s for MVUM/trails.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';

import { cellBounds } from '../src/downloads/cells.ts';
import { fetchLandPack } from '../src/packs/land.ts';
import { fetchMvumPack } from '../src/packs/mvum.ts';
import { fetchTrailsPack } from '../src/packs/trails.ts';
import { cellEntryName, REGION_PACK_LAYERS } from '../src/packs/regionPacks.ts';
import { buildDir, publishBuild, readManifest, writeManifest } from './packManifest.mjs';
import { REGIONS, regionCells } from './regionCells.mjs';

const FETCHERS = { land: fetchLandPack, mvum: fetchMvumPack, trails: fetchTrailsPack };

function parseArgs(argv) {
  const options = { concurrency: 3, limit: Infinity, publish: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--publish') options.publish = true;
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  const [regionId, ...layers] = positional;
  return { regionId, layers, options };
}

const { regionId, layers: layerArgs, options } = parseArgs(process.argv.slice(2));
const region = REGIONS[regionId];
const layers = layerArgs.length ? layerArgs : [...REGION_PACK_LAYERS];
if (!region || layers.some((l) => !FETCHERS[l]) || !(options.concurrency >= 1)) {
  console.error(
    `Usage: node tools/build_region_pack.mjs <${Object.keys(REGIONS).join('|')}> [${Object.keys(FETCHERS).join('] [')}] ` +
      '[--concurrency N] [--limit N] [--publish]'
  );
  process.exit(1);
}

/** Runs `worker` over `items`, `concurrency` at a time. */
async function pool(items, concurrency, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Fetches (or reuses from the cache) every cell of one layer; returns the failures. */
async function fetchLayerCells(layer, cells) {
  const cacheDir = path.join(buildDir, 'cache', region.id, layer);
  await mkdir(cacheDir, { recursive: true });
  const failures = [];
  let done = 0;
  const started = Date.now();
  await pool(cells, options.concurrency, async ([cx, cy]) => {
    const file = path.join(cacheDir, cellEntryName(cx, cy));
    if (!(await exists(file))) {
      try {
        const fc = await FETCHERS[layer](cellBounds(cx, cy), {});
        await writeFile(file, JSON.stringify(fc));
      } catch (err) {
        failures.push({ cx, cy, message: err instanceof Error ? err.message : String(err) });
        console.error(`  [${layer}] ${cx},${cy} failed: ${failures.at(-1).message}`);
      }
    }
    done++;
    if (done % 10 === 0 || done === cells.length) {
      const elapsed = (Date.now() - started) / 1000;
      console.log(`  [${layer}] ${done}/${cells.length} cells (${elapsed.toFixed(0)} s)`);
    }
  });
  return failures;
}

async function zipLayer(layer, cells) {
  const cacheDir = path.join(buildDir, 'cache', region.id, layer);
  const zip = new JSZip();
  for (const [cx, cy] of cells) {
    zip.file(cellEntryName(cx, cy), await readFile(path.join(cacheDir, cellEntryName(cx, cy))));
  }
  const file = `${region.id}-${layer}.zip`;
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  await writeFile(path.join(buildDir, file), bytes);
  return { layer, file, bytes: bytes.length, version: new Date().toISOString() };
}

/** Merges this run into the manifest: builds of other regions / layers / hunting units already there are kept. */
async function updateManifest(cells, packFiles) {
  const manifest = await readManifest();
  let entry = manifest.regions.find((r) => r.id === region.id);
  if (!entry) {
    entry = { id: region.id, name: region.name, cells, packs: [] };
    manifest.regions.push(entry);
  }
  entry.name = region.name;
  entry.cells = cells;
  for (const pack of packFiles) {
    entry.packs = entry.packs.filter((p) => p.layer !== pack.layer).concat(pack);
  }
  entry.packs.sort((a, b) => a.layer.localeCompare(b.layer));
  await writeManifest(manifest);
  return manifest;
}

await mkdir(buildDir, { recursive: true });
const allCells = await regionCells(region);
const cells = allCells.slice(0, options.limit);
console.log(`${region.name}: ${allCells.length} cells${cells.length < allCells.length ? ` (building the first ${cells.length})` : ''}; layers: ${layers.join(', ')}`);
if (cells.length < allCells.length && options.publish) {
  console.error('Refusing to --publish a partial (--limit) build.');
  process.exit(1);
}

const packFiles = [];
let failed = false;
for (const layer of layers) {
  console.log(`${layer}...`);
  const failures = await fetchLayerCells(layer, cells);
  if (failures.length > 0) {
    failed = true;
    console.error(`  ${failures.length} ${layer} cells failed — rerun to retry just those (the rest are cached). No ${layer} zip written.`);
    continue;
  }
  const pack = await zipLayer(layer, cells);
  packFiles.push(pack);
  console.log(`  wrote packs/build/${pack.file} (${(pack.bytes / 1e6).toFixed(1)} MB)`);
}

if (packFiles.length > 0) {
  await updateManifest(cells, packFiles); // `cells` is a subset only on a --limit trial run, which never publishes
  console.log(`Updated packs/build/manifest.json (${packFiles.length} pack${packFiles.length === 1 ? '' : 's'}).`);
}
if (failed) process.exit(1);
if (options.publish) await publishBuild();
console.log('Done. Land / MVUM / trails data © USGS / USFS (public domain).');
