/**
 * The published manifest (packs/build/manifest.json -> the `data` GitHub release), shared by the region-pack and
 * hunt-unit build scripts so each merges into it instead of overwriting the other's entries.
 *
 * If there is no local copy the release's own manifest is the starting point — otherwise rebuilding one state on a
 * fresh checkout and publishing would silently drop everything else from the release.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { REGION_PACK_FORMAT, REGION_PACK_MANIFEST_URL, REGION_PACK_MIN_FORMAT } from '../src/packs/regionPacks.ts';

export const RELEASE_TAG = 'data';
export const buildDir = path.join(import.meta.dirname, '..', 'packs', 'build');
export const manifestPath = path.join(buildDir, 'manifest.json');

const emptyManifest = () => ({ format: REGION_PACK_FORMAT, regions: [], huntUnits: [] });

function usable(json) {
  return (
    json && json.format >= REGION_PACK_MIN_FORMAT && json.format <= REGION_PACK_FORMAT && Array.isArray(json.regions)
  );
}

/** The local manifest, else the published one, else empty. Always has `regions` and `huntUnits` arrays. */
export async function readManifest() {
  let manifest = null;
  try {
    const local = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (usable(local)) manifest = local;
  } catch {
    // no local manifest yet
  }
  if (!manifest) {
    try {
      const response = await fetch(REGION_PACK_MANIFEST_URL, { headers: { 'User-Agent': 'K-Maps build tools' } });
      if (response.ok) {
        const remote = await response.json();
        if (usable(remote)) {
          manifest = remote;
          console.log('  (no local manifest — starting from the published one)');
        }
      }
    } catch {
      // offline or nothing published yet
    }
  }
  manifest ??= emptyManifest();
  manifest.format = REGION_PACK_FORMAT; // an older manifest is carried forward in the current layout
  manifest.huntUnits ??= [];
  return manifest;
}

/** Writes the manifest, keeping each `[cx, cy]` cell pair and `[w, s, e, n]` box on one line. */
export async function writeManifest(manifest) {
  await mkdir(buildDir, { recursive: true });
  const text = JSON.stringify(manifest, null, 2)
    .replace(/\[\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2]')
    .replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2, $3, $4]');
  await writeFile(manifestPath, text + '\n');
}

function gh(args) {
  const result = spawnSync('gh', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed`);
}

/** Uploads every zip in packs/build plus the manifest to the rolling `data` release, creating it on first use. */
export async function publishBuild() {
  const files = (await readdir(buildDir)).filter((f) => f.endsWith('.zip') || f === 'manifest.json');
  const releaseExists = spawnSync('gh', ['release', 'view', RELEASE_TAG], { stdio: 'ignore' }).status === 0;
  if (!releaseExists) {
    // A prerelease so it never becomes the repo's "latest" release; the app reads it by its fixed tag.
    gh([
      'release',
      'create',
      RELEASE_TAG,
      '--prerelease',
      '--title',
      'K-Maps region data',
      '--notes',
      'Prebuilt region data packs the app downloads (see tools/build_region_pack.mjs and tools/build_hunt_units.mjs). ' +
        'Land data: USGS PAD-US (public domain). MVUM and trails: USFS (public domain). ' +
        'Hunting units: each state wildlife agency (see the manifest for the source of each state).',
    ]);
  }
  gh(['release', 'upload', RELEASE_TAG, ...files.map((f) => path.join(buildDir, f)), '--clobber']);
  console.log(`Published ${files.length} files to release "${RELEASE_TAG}".`);
}

/** Uploads just these files (names inside packs/build) to the rolling `data` release — the manifest last, so it never lists a pack that isn't there yet. */
export async function publishFiles(names) {
  const releaseExists = spawnSync('gh', ['release', 'view', RELEASE_TAG], { stdio: 'ignore' }).status === 0;
  if (!releaseExists) await publishBuild();
  const ordered = [...names.filter((f) => f !== 'manifest.json'), ...names.filter((f) => f === 'manifest.json')];
  // gh handles many files per call; batch so one bad connection doesn't restart hundreds of uploads.
  for (let i = 0; i < ordered.length; i += 10) {
    gh(['release', 'upload', RELEASE_TAG, ...ordered.slice(i, i + 10).map((f) => path.join(buildDir, f)), '--clobber']);
  }
  console.log(`Published ${ordered.length} files to release "${RELEASE_TAG}".`);
}
