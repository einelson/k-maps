#!/usr/bin/env node
/**
 * Builds the hosted HUNTING-UNIT packs: for each state in src/huntUnits/registry.ts it downloads the unit layers from
 * the state wildlife agency's own ArcGIS service, normalizes them to one shape (src/huntUnits/), and zips the result
 * as `hunt-<st>.zip` (one `units.json`), recorded in the shared manifest for the app's Downloads -> Hunting units.
 *
 *   node tools/build_hunt_units.mjs [XX ...]     # default: every state in the registry
 *        [--check]           fetch and report only: counts per set, sample titles, link check; writes nothing
 *        [--refresh]         ignore the fetch cache (packs/build/cache/hunt/) and download again
 *        [--concurrency N]   states fetched at once (default 3)
 *        [--publish]         upload the zips + manifest to the rolling `data` GitHub release (needs `gh`)
 *
 * A state that fails keeps its previous pack in the manifest; the run exits non-zero, and `--publish` refuses to
 * upload anything from a run with failures (rerun with just the failed codes).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';

import { fetchState } from '../src/huntUnits/fetchState.ts';
import { boundsOf } from '../src/huntUnits/normalize.ts';
import { HUNT_STATE_BY_CODE, HUNT_STATES } from '../src/huntUnits/registry.ts';
import { HUNT_UNITS_ENTRY_NAME } from '../src/packs/regionPacks.ts';
import { buildDir, publishBuild, readManifest, writeManifest } from './packManifest.mjs';

const cacheDir = path.join(buildDir, 'cache', 'hunt');

function parseArgs(argv) {
  const options = { check: false, refresh: false, publish: false, concurrency: 3 };
  const codes = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--refresh') options.refresh = true;
    else if (arg === '--publish') options.publish = true;
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else codes.push(arg.toUpperCase());
  }
  return { codes, options };
}

const { codes, options } = parseArgs(process.argv.slice(2));
const unknown = codes.filter((c) => !HUNT_STATE_BY_CODE[c]);
if (unknown.length > 0 || !(options.concurrency >= 1)) {
  console.error(`Unknown state(s): ${unknown.join(', ') || '(none)'}. Known: ${HUNT_STATES.map((s) => s.code).join(' ')}`);
  process.exit(1);
}
if (options.check && options.publish) {
  console.error('--check writes nothing, so it cannot --publish.');
  process.exit(1);
}
const states = HUNT_STATES.filter((s) => !codes.length || codes.includes(s.code));

async function pool(items, concurrency, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    })
  );
}

/** Is the agency's regulations page reachable? Warn only — some agency sites refuse scripted requests. */
async function checkLink(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 K-Maps build tools' }, signal: AbortSignal.timeout(25_000) });
    return response.ok ? null : `HTTP ${response.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function fetchOrCached(state) {
  const cacheFile = path.join(cacheDir, `${state.code}.json`);
  if (!options.refresh) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      // The box is derived, so recompute it: a cache built before a bounds fix shouldn't carry the old answer.
      return { ...cached, bbox: boundsOf(cached.features), cached: true };
    } catch {
      // not cached yet
    }
  }
  const result = await fetchState(state);
  if (!options.check) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result));
  }
  return { ...result, cached: false };
}

async function zipState(state, result) {
  const zip = new JSZip();
  zip.file(HUNT_UNITS_ENTRY_NAME, JSON.stringify({ type: 'FeatureCollection', features: result.features }));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  const file = `hunt-${state.code.toLowerCase()}.zip`;
  await writeFile(path.join(buildDir, file), bytes);
  return {
    state: state.code,
    name: state.name,
    agency: state.agency,
    regsUrl: state.regsUrl,
    vintage: state.vintage,
    file,
    bytes: bytes.length,
    version: new Date().toISOString(),
    fetchedAt: result.fetchedAt,
    bbox: result.bbox,
    unitCount: result.features.length,
    sets: result.sets.map((s) => ({ id: s.id, label: s.label, count: s.kept, ...(s.updated ? { updated: s.updated } : {}) })),
  };
}

const failures = [];
const entries = [];
await mkdir(buildDir, { recursive: true });
console.log(`${states.length} state${states.length === 1 ? '' : 's'}${options.check ? ' (check only)' : ''}: ${states.map((s) => s.code).join(' ')}`);

await pool(states, options.concurrency, async (state) => {
  try {
    const result = await fetchOrCached(state);
    const summary = result.sets.map((s) => `${s.id} ${s.kept}${s.fetched !== s.kept ? `/${s.fetched}` : ''}`).join(', ');
    const sample = result.features.slice(0, 3).map((f) => f.properties.title).join(' | ');
    const linkProblem = options.check ? await checkLink(state.regsUrl) : null;
    const dates = [...new Set(result.sets.map((s) => s.updated ?? 'date not published'))].sort().join(', ');
    console.log(`  ${state.code} ${state.name}: ${result.features.length} units (${summary})${result.cached ? ' [cached]' : ''} — source edited: ${dates}`);
    if (options.check) console.log(`      e.g. ${sample}${linkProblem ? `\n      ! regulations link: ${linkProblem} (${state.regsUrl})` : ''}`);
    if (!options.check) {
      const entry = await zipState(state, result);
      entries.push(entry);
      console.log(`      wrote packs/build/${entry.file} (${(entry.bytes / 1e6).toFixed(2)} MB)`);
    }
  } catch (err) {
    failures.push(state.code);
    console.error(`  ${state.code} ${state.name}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }
});

if (!options.check && entries.length > 0) {
  const manifest = await readManifest();
  for (const entry of entries) {
    manifest.huntUnits = manifest.huntUnits.filter((e) => e.state !== entry.state).concat(entry);
  }
  manifest.huntUnits.sort((a, b) => a.state.localeCompare(b.state));
  await writeManifest(manifest);
  const total = entries.reduce((sum, e) => sum + e.bytes, 0);
  console.log(`Updated packs/build/manifest.json (${entries.length} hunting-unit pack${entries.length === 1 ? '' : 's'}, ${(total / 1e6).toFixed(1)} MB).`);
}

if (failures.length > 0) {
  console.error(`${failures.length} failed: ${failures.sort().join(' ')} — rerun with those codes.`);
  process.exit(1);
}
if (options.publish) await publishBuild();
console.log('Done. Boundaries © the state wildlife agencies named in each pack; display only — confirm in the official regulations.');
