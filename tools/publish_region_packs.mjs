#!/usr/bin/env node
/**
 * Uploads the region packs built in packs/build/ to the rolling `data` GitHub release (needs `gh`): every
 * `<state>-<layer>[-N].zip` that is new or a different size than the copy already published, then `manifest.json` last,
 * so the app never reads a manifest that lists a zip that isn't there yet. Hunting-unit zips are left alone
 * (tools/build_hunt_units.mjs publishes those).
 *
 *   node tools/publish_region_packs.mjs            # upload what changed
 *   node tools/publish_region_packs.mjs --dry-run  # just say what would be uploaded
 */
import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { buildDir, publishFiles, RELEASE_TAG } from './packManifest.mjs';
import { REGIONS } from './regionCells.mjs';

const dryRun = process.argv.includes('--dry-run');
const stateIds = Object.keys(REGIONS);
const isRegionZip = (name) => stateIds.some((id) => new RegExp(`^${id}-(land|mvum|trails|poi|osm)(-\\d+)?\\.zip$`).test(name));

const published = new Map();
const view = spawnSync('gh', ['release', 'view', RELEASE_TAG, '--json', 'assets'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (view.status === 0) {
  for (const asset of JSON.parse(view.stdout).assets) published.set(asset.name, asset.size);
}

const local = (await readdir(buildDir)).filter(isRegionZip).sort();
const changed = [];
let bytes = 0;
for (const name of local) {
  const size = (await stat(path.join(buildDir, name))).size;
  if (published.get(name) !== size) {
    changed.push(name);
    bytes += size;
  }
}
console.log(`${local.length} region zips built, ${changed.length} new or changed (${(bytes / 1e6).toFixed(0)} MB)${dryRun ? ' — dry run' : ''}`);
if (dryRun) process.exit(0);
await publishFiles([...changed, 'manifest.json']);
