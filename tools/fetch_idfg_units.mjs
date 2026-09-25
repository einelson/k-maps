#!/usr/bin/env node
/**
 * Refreshes the BUNDLED Idaho hunting units (assets/idfg/): Idaho Fish and Game's Game Management Unit polygons, in
 * the same normalized shape every other state's downloadable pack uses (src/huntUnits/), so the map draws Idaho and
 * the downloaded states with one code path. Idaho ships with the app so it works offline out of the box; the other
 * states are packs (tools/build_hunt_units.mjs). Units are re-drawn rarely (regulations are yearly): re-run each season.
 *
 * Usage: node tools/fetch_idfg_units.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fetchState } from '../src/huntUnits/fetchState.ts';
import { HUNT_STATE_BY_CODE } from '../src/huntUnits/registry.ts';

const idaho = HUNT_STATE_BY_CODE.ID;
console.log('Fetching IDFG Game Management Units...');
const result = await fetchState(idaho);
const features = result.features.sort((a, b) => a.properties.unit.localeCompare(b.properties.unit, undefined, { numeric: true }));
console.log(`${result.sets[0].fetched} returned, ${features.length} kept`);

const outDir = path.join(import.meta.dirname, '..', 'assets', 'idfg');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'game-units.json'), JSON.stringify({ type: 'FeatureCollection', features }));
await writeFile(
  path.join(outDir, 'game-units.meta.json'),
  JSON.stringify(
    {
      state: 'ID',
      name: idaho.name,
      agency: idaho.agency,
      regsUrl: idaho.regsUrl,
      vintage: idaho.vintage,
      fetchedAt: result.fetchedAt,
      bbox: result.bbox,
      sets: result.sets.map((s) => ({ id: s.id, label: s.label, count: s.kept, ...(s.updated ? { updated: s.updated } : {}) })),
      source: 'Idaho Department of Fish and Game — Game Management Units',
      serviceUrl: idaho.sets[0].layer,
      featureCount: features.length,
      license: 'Idaho Fish and Game open GIS data (informational; no warranty)',
      note: 'IDFG calls this a best representation only: confirm unit boundaries in the current IDFG regulation booklet before hunting. Simplified with maxAllowableOffset=0.0003° for size; display only.',
    },
    null,
    2
  )
);
console.log(`Wrote ${features.length} units to assets/idfg/.`);
