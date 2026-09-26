#!/usr/bin/env node
/**
 * Builds the "where is the US?" data the app and the pack builders share, from the Census Bureau's cartographic
 * boundary file (1:500,000, shoreline-clipped, public domain) via TIGERweb: the 50 states plus DC.
 *
 *   node tools/build_us_outline.mjs           # fetch (or reuse packs/build/cache/us-states-500k.json) and build
 *   node tools/build_us_outline.mjs --refresh # refetch the boundaries first
 *
 * Writes:
 *   assets/us/us-cells.json         bundled with the app (src/packs/usCoverage.ts reads it): which z10 cells are wholly
 *                                   inside the US, and for cells that are only partly inside — coast, Canada, Mexico —
 *                                   the US part. The land pack uses it so "likely private" is never drawn on the ocean
 *                                   or on Canada, and the app never fetches a cell that holds no US land.
 *   tools/data/us-state-cells.json  the z10 cells each state touches, for tools/regionCells.mjs (pack builds)
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { cellBounds, cellsInBounds } from '../src/downloads/cells.ts';
import { clipPolygonGeometry } from '../src/packs/clip.ts';
import { encodeMultiPolygon } from '../src/packs/usCoverage.ts';
import { buildDir } from './packManifest.mjs';

const repoRoot = path.join(import.meta.dirname, '..');
const CACHE_FILE = path.join(buildDir, 'cache', 'us-states-500k.json');
const CELLS_OUT = path.join(repoRoot, 'assets', 'us', 'us-cells.json');
const STATE_CELLS_OUT = path.join(repoRoot, 'tools', 'data', 'us-state-cells.json');

const SERVICE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/State_County/MapServer/7/query';
/** The 50 states and DC; the territories are not part of this app's coverage. */
const TERRITORIES = new Set(['AS', 'GU', 'MP', 'PR', 'VI']);
/** A cell counts as wholly inside when the US covers all but this share of it (float noise at a shared edge). */
const INSIDE_SHARE = 1 - 1e-7;
/** Smaller than this (square degrees) is a touch, not an overlap. */
const MIN_AREA = 1e-10;

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function loadStates(refresh) {
  if (!refresh && (await exists(CACHE_FILE))) return JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'GEOID,STUSAB',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '5',
    f: 'geojson',
  });
  const response = await fetch(`${SERVICE}?${params}`, { headers: { 'User-Agent': 'K-Maps build tools' } });
  if (!response.ok) throw new Error(`TIGERweb answered HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json.features) || json.features.some((f) => !f.geometry)) {
    throw new Error('TIGERweb returned states without geometry');
  }
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(json));
  return json;
}

const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
};
/** Area of a polygon (outer ring minus holes) in square degrees. */
const polygonArea = (rings) =>
  Math.abs(ringArea(rings[0])) - rings.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0);

const ringBox = (ring) => {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
};
const overlaps = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

const refresh = process.argv.includes('--refresh');
const collection = await loadStates(refresh);
const states = collection.features.filter((f) => !TERRITORIES.has(f.properties.STUSAB));
console.log(`${states.length} states (incl. DC) from the Census 1:500,000 boundaries`);

// Every polygon part of every state, with its outer ring's box.
const parts = [];
for (const feature of states) {
  const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const rings of polys) parts.push({ state: feature.properties.STUSAB, rings, box: ringBox(rings[0]) });
}

// Candidate cells: the ones each part's box touches.
const candidates = new Map();
for (const part of parts) {
  for (const { cx, cy } of cellsInBounds(part.box)) candidates.set(`${cx}_${cy}`, [cx, cy]);
}
console.log(`${parts.length} polygon parts, ${candidates.size} candidate cells`);

const inside = new Map(); // cy -> [cx...]
const edges = {};
const stateCells = Object.fromEntries(states.map((f) => [f.properties.STUSAB, new Set()]));
let processed = 0;
const started = Date.now();
for (const [key, [cx, cy]] of candidates) {
  const bounds = cellBounds(cx, cy);
  const cellArea = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
  const pieces = [];
  let covered = 0;
  for (const part of parts) {
    if (!overlaps(part.box, bounds)) continue;
    const clipped = clipPolygonGeometry({ type: 'Polygon', coordinates: part.rings }, bounds);
    if (!clipped) continue;
    const polys = clipped.type === 'Polygon' ? [clipped.coordinates] : clipped.coordinates;
    let area = 0;
    for (const rings of polys) area += polygonArea(rings);
    if (area < MIN_AREA) continue;
    covered += area;
    stateCells[part.state].add(key);
    for (const rings of polys) pieces.push(rings);
  }
  if (covered >= cellArea * INSIDE_SHARE) {
    if (!inside.has(cy)) inside.set(cy, []);
    inside.get(cy).push(cx);
  } else if (pieces.length > 0) {
    const encoded = encodeMultiPolygon(pieces, bounds);
    if (encoded.length > 0) edges[key] = encoded;
  }
  if (++processed % 2000 === 0)
    console.log(`  ${processed}/${candidates.size} cells (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}

// Rows of wholly-inside cells as [start, end, start, end, ...] runs, one row per cell y.
const rows = {};
for (const cy of [...inside.keys()].sort((a, b) => a - b)) {
  const cxs = inside.get(cy).sort((a, b) => a - b);
  const runs = [];
  for (const cx of cxs) {
    if (runs.length && runs[runs.length - 1] === cx - 1) runs[runs.length - 1] = cx;
    else runs.push(cx, cx);
  }
  rows[cy] = runs;
}

const data = {
  version: 1,
  source: 'U.S. Census Bureau cartographic boundaries 1:500,000 (2023 ACS vintage), 50 states + DC; public domain',
  rows,
  edges,
};
await mkdir(path.dirname(CELLS_OUT), { recursive: true });
await writeFile(CELLS_OUT, JSON.stringify(data));

const perState = Object.fromEntries(
  Object.entries(stateCells)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, set]) => [
      code,
      [...set].map((k) => k.split('_').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    ])
);
await mkdir(path.dirname(STATE_CELLS_OUT), { recursive: true });
await writeFile(
  STATE_CELLS_OUT,
  JSON.stringify(perState).replace(/\],"/g, '],\n"').replace(/\[\[/g, '[\n[').replace(/\]\]/g, ']\n]')
);

const insideCount = [...inside.values()].reduce((s, a) => s + a.length, 0);
const outsideAfter = candidates.size - insideCount - Object.keys(edges).length;
const size = (await stat(CELLS_OUT)).size;
console.log(
  `${insideCount} cells wholly inside, ${Object.keys(edges).length} on a coast or border, ${outsideAfter} candidates outside; ` +
    `assets/us/us-cells.json ${(size / 1e6).toFixed(2)} MB`
);
console.log(
  `Cells per state: ${Object.entries(perState)
    .map(([c, cells]) => `${c} ${cells.length}`)
    .join(', ')}`
);
