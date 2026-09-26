#!/usr/bin/env node
/**
 * Builds hosted REGION PACKS: for a state (tools/regionCells.mjs) it runs the very same per-cell fetchers the app
 * runs on-device (src/packs/*.ts, loaded via node's type stripping) over every z10 cell, then zips each layer's cell
 * files into `<region>-<layer>.zip` and records them in `manifest.json` — the files the app's Downloads ->
 * Ready-made section installs (src/downloads/regionPackInstaller.ts).
 *
 *   node tools/build_region_pack.mjs <state...|all> [land] [mvum] [trails] [poi] [osm]
 *        [--concurrency N]   cells fetched at once per process (default 3; be gentle with the public services)
 *        [--limit N]         only the first N cells of each state — a quick trial run, never publish the result
 *        [--part I/N]        fetch only every Nth cell starting at I (0-based) and write no zip: several processes each
 *                            take a part of a big state, then one plain run zips it from the cache
 *        [--publish]         upload the zips + manifest to the rolling `data` GitHub release (needs `gh`)
 *
 * `land`, `mvum` and `trails` are fetched from the public services (default). `poi` and `osm` are not fetched here: they
 * come from a state's OpenStreetMap extract — tools/build_osm_states.sh, then tools/finalize_osm_cells.mjs — and are
 * zipped from that cache when named. A layer bigger than about 50 MB zipped is split into ~40 MB parts
 * (`<state>-<layer>-1.zip`, ...), each listing its cells in the manifest, because the app unzips a file in memory.
 *
 * States are named as in tools/regionCells.mjs (`idaho`, `new-york`, ...). Every fetch is given the map of where the
 * US is (assets/us/us-cells.json), so a border or coast cell holds no data — and no "likely private" shading —
 * outside the US.
 *
 * Fetched cells are cached per layer in packs/build/cache/cells/<layer>/ (git-ignored), shared by every state: a cell
 * on a state line is fetched once, and an interrupted or partly failed run picks up where it stopped. Delete the
 * cache to refetch fresh data (and delete cache/cells/land if assets/us/us-cells.json changes). Cache files are
 * written atomically and the manifest is updated under a lock, so several processes can build different states at
 * once — that is how the whole country is built (tools/build_all_states.sh).
 *
 * Expect roughly 5-10 s per land cell (the likely-private step is CPU-heavy) and about 1 s for MVUM/trails.
 */
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import JSZip from 'jszip';

import { cellBounds } from '../src/downloads/cells.ts';
import { fetchLandPack } from '../src/packs/land.ts';
import { fetchMvumPack } from '../src/packs/mvum.ts';
import { fetchTrailsPack } from '../src/packs/trails.ts';
import { cellEntryName } from '../src/packs/regionPacks.ts';
import { createUsCoverage } from '../src/packs/usCoverage.ts';
import { buildDir, publishFiles, readManifest, writeManifest } from './packManifest.mjs';
import { REGIONS, regionCells } from './regionCells.mjs';

const FETCHERS = { land: fetchLandPack, mvum: fetchMvumPack, trails: fetchTrailsPack };
/** Layers built from the OSM extract cache instead of the public services. */
const CACHE_ONLY = ['poi', 'osm'];
const DEFAULT_LAYERS = Object.keys(FETCHERS);
/** Zips bigger than this (in total, for a layer) are split; each part aims for PART_TARGET_BYTES. */
const SPLIT_ABOVE_BYTES = Number(process.env.KMAPS_SPLIT_ABOVE_BYTES ?? 50_000_000);
const PART_TARGET_BYTES = Number(process.env.KMAPS_PART_TARGET_BYTES ?? 40_000_000); // both overridable to test splitting on a small state
const repoRoot = path.join(import.meta.dirname, '..');
const cellsCache = path.join(buildDir, 'cache', 'cells');
const lockFile = path.join(buildDir, '.manifest.lock');

function parseArgs(argv) {
  const options = { concurrency: 3, limit: Infinity, publish: false, part: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--publish') options.publish = true;
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--part') {
      const [index, count] = argv[++i].split('/').map(Number);
      if (!(count >= 1) || !(index >= 0 && index < count)) throw new Error('--part takes I/N with 0 <= I < N');
      options.part = { index, count };
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  const regionIds = [];
  const layers = [];
  for (const word of positional) {
    if (word === 'all') regionIds.push(...Object.keys(REGIONS));
    else if (REGIONS[word]) regionIds.push(word);
    else if (FETCHERS[word] || CACHE_ONLY.includes(word)) layers.push(word);
    else
      throw new Error(
        `Don't know "${word}" — a state (${Object.keys(REGIONS).join(', ')}), a layer (${[...DEFAULT_LAYERS, ...CACHE_ONLY].join(', ')}) or "all"`
      );
  }
  return { regionIds, layers, options };
}

const { regionIds, layers: layerArgs, options } = parseArgs(process.argv.slice(2));
const layers = layerArgs.length ? layerArgs : DEFAULT_LAYERS;
if (regionIds.length === 0 || !(options.concurrency >= 1)) {
  console.error(
    'Usage: node tools/build_region_pack.mjs <state...|all> [land] [mvum] [trails] [poi] [osm] [--concurrency N] [--limit N] [--part I/N] [--publish]'
  );
  process.exit(1);
}

const us = createUsCoverage(JSON.parse(await readFile(path.join(repoRoot, 'assets', 'us', 'us-cells.json'), 'utf8')));

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

/** Fetches (or reuses from the cache) every cell of one layer for one state; returns the failures. */
async function fetchLayerCells(region, layer, cells) {
  const cacheDir = path.join(cellsCache, layer);
  await mkdir(cacheDir, { recursive: true });
  const failures = [];
  let done = 0;
  let fetched = 0;
  const started = Date.now();
  await pool(cells, options.concurrency, async ([cx, cy]) => {
    const file = path.join(cacheDir, cellEntryName(cx, cy));
    if (!(await exists(file))) {
      try {
        const fc = await FETCHERS[layer](cellBounds(cx, cy), { us });
        // Written whole and renamed into place, so another process never reads half a file.
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(fc));
        await rename(temp, file);
        fetched++;
      } catch (err) {
        failures.push({ cx, cy, message: err instanceof Error ? err.message : String(err) });
        console.error(`  [${region.id} ${layer}] ${cx},${cy} failed: ${failures.at(-1).message}`);
      }
    }
    done++;
    if (done % 25 === 0 || done === cells.length) {
      const elapsed = (Date.now() - started) / 1000;
      console.log(
        `  [${region.id} ${layer}] ${done}/${cells.length} cells, ${fetched} fetched (${elapsed.toFixed(0)} s)`
      );
    }
  });
  return failures;
}

/** Cells missing from a cache-only layer (OSM / POI): they come from tools/finalize_osm_cells.mjs, not a fetch. */
async function missingCacheOnly(layer, cells) {
  const missing = [];
  for (const [cx, cy] of cells) {
    if (!(await exists(path.join(cellsCache, layer, cellEntryName(cx, cy)))))
      missing.push({ cx, cy, message: 'not in the OSM cache' });
  }
  return missing;
}

/** Splits cells into consecutive groups of about `target` compressed bytes (cell files are compressed on their own to size them). */
function splitBySize(entries, target) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    if (current.length > 0 && size + entry.compressed > target) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += entry.compressed;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Removes the zips an earlier build of this state and layer left (one file, or numbered parts). */
async function removeOldZips(region, layer) {
  const pattern = new RegExp(`^${region.id}-${layer}(-\\d+)?\\.zip$`);
  for (const name of await readdir(buildDir)) if (pattern.test(name)) await unlink(path.join(buildDir, name));
}

/** Zips one layer of one state — one file, or numbered parts when it is big. Returns its manifest entries. */
async function zipLayer(region, layer, cells) {
  const cacheDir = path.join(cellsCache, layer);
  const entries = [];
  for (const [cx, cy] of cells) {
    const data = await readFile(path.join(cacheDir, cellEntryName(cx, cy)));
    entries.push({ cx, cy, data, compressed: deflateSync(data, { level: 6 }).length });
  }
  const total = entries.reduce((sum, e) => sum + e.compressed, 0);
  const groups = total > SPLIT_ABOVE_BYTES ? splitBySize(entries, PART_TARGET_BYTES) : [entries];
  const version = new Date().toISOString(); // every part of a layer shares it: the app treats them as one download
  await removeOldZips(region, layer);
  const packs = [];
  for (let i = 0; i < groups.length; i++) {
    const zip = new JSZip();
    for (const { cx, cy, data } of groups[i]) zip.file(cellEntryName(cx, cy), data);
    const file = groups.length === 1 ? `${region.id}-${layer}.zip` : `${region.id}-${layer}-${i + 1}.zip`;
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    await writeFile(path.join(buildDir, file), bytes);
    packs.push({
      layer,
      file,
      bytes: bytes.length,
      version,
      ...(groups.length > 1 ? { cells: groups[i].map(({ cx, cy }) => [cx, cy]) } : {}),
    });
  }
  return packs;
}

/** Holds a lock file while `fn` runs, so processes building other states don't overwrite each other's manifest edits. */
async function withManifestLock(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lockFile, 'wx');
      await handle.close();
      break;
    } catch (err) {
      if (err.code !== 'EEXIST' || attempt > 600) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lockFile).catch(() => {});
  }
}

/** Merges this state's packs into the manifest: other states / layers / hunting units already there are kept. */
async function updateManifest(region, cells, packFiles) {
  await withManifestLock(async () => {
    const manifest = await readManifest();
    let entry = manifest.regions.find((r) => r.id === region.id);
    if (!entry) {
      entry = { id: region.id, name: region.name, cells, packs: [] };
      manifest.regions.push(entry);
    }
    entry.name = region.name;
    entry.cells = cells;
    // A rebuilt layer replaces every file of it (a layer that was split before may not be now, and vice versa).
    const rebuilt = new Set(packFiles.map((p) => p.layer));
    entry.packs = entry.packs.filter((p) => !rebuilt.has(p.layer)).concat(packFiles);
    entry.packs.sort(
      (a, b) => a.layer.localeCompare(b.layer) || a.file.localeCompare(b.file, undefined, { numeric: true })
    );
    manifest.regions.sort((a, b) => a.name.localeCompare(b.name));
    await writeManifest(manifest);
  });
}

await mkdir(buildDir, { recursive: true });
let failed = false;
const builtFiles = [];
for (const regionId of regionIds) {
  const region = REGIONS[regionId];
  const allCells = await regionCells(region);
  const cells = allCells.slice(0, options.limit);
  if (options.part && options.publish) {
    console.error('Refusing to --publish from a --part run (it writes no zips).');
    process.exit(1);
  }
  const myCells = options.part ? cells.filter((_, i) => i % options.part.count === options.part.index) : cells;
  console.log(
    `${region.name}: ${allCells.length} cells${cells.length < allCells.length ? ` (building the first ${cells.length})` : ''}; layers: ${layers.join(', ')}`
  );
  if (cells.length < allCells.length && options.publish) {
    console.error('Refusing to --publish a partial (--limit) build.');
    process.exit(1);
  }

  const packFiles = [];
  for (const layer of layers) {
    const failures = CACHE_ONLY.includes(layer)
      ? await missingCacheOnly(layer, myCells)
      : await fetchLayerCells(region, layer, myCells);
    if (options.part) {
      if (failures.length > 0) failed = true;
      continue; // a part run only fills the cache; a plain run zips it
    }
    if (failures.length > 0) {
      failed = true;
      console.error(
        `  ${region.name}: ${failures.length} ${layer} cells ${CACHE_ONLY.includes(layer) ? 'are missing — run tools/build_osm_states.sh and tools/finalize_osm_cells.mjs' : 'failed — rerun to retry just those (the rest are cached)'}. No ${layer} zip written.`
      );
      continue;
    }
    const packs = await zipLayer(region, layer, cells);
    packFiles.push(...packs);
    for (const pack of packs) {
      builtFiles.push(pack.file);
      console.log(
        `  wrote packs/build/${pack.file} (${(pack.bytes / 1e6).toFixed(1)} MB${pack.cells ? `, ${pack.cells.length} cells` : ''})`
      );
    }
  }
  if (packFiles.length > 0) await updateManifest(region, cells, packFiles); // `cells` is a subset only on a --limit trial run, which never publishes
}

if (!options.part) {
  console.log(`Updated packs/build/manifest.json (${builtFiles.length} pack${builtFiles.length === 1 ? '' : 's'}).`);
}
if (failed) process.exit(1);
if (options.publish) await publishFiles([...builtFiles, 'manifest.json']);
console.log('Done. Land / MVUM / trails data © USGS / USFS (public domain).');
