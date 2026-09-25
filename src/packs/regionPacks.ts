/**
 * Region packs: prebuilt, hosted copies of the per-cell vector packs (land / MVUM / trails) for a whole
 * region, built on a laptop by tools/build_region_pack.mjs and downloaded once from the app instead of
 * fetching hundreds of cells from the public services one by one.
 *
 * A pack is one zip per (region, layer) holding `<cx>_<cy>.json` at the root — the exact per-cell files
 * src/packs/packStorage.ts writes — so installing one is just unzipping into the same directory and
 * recording coverage. `manifest.json` (hosted next to the zips) lists what exists.
 *
 * Pure (no native modules): shared by the app and the build tool, which loads it with node's type stripping.
 */

import type { PackLayerId } from './types.ts';

/** Bumped when the zip/manifest layout changes incompatibly; older apps then refuse the manifest instead of misreading it. */
export const REGION_PACK_FORMAT = 1;

/** A rolling GitHub release: the build tool replaces its assets in place, so this URL never changes. */
export const REGION_PACK_MANIFEST_URL =
  'https://github.com/einelson/k-maps/releases/download/data/manifest.json';

/** Layers that ship as region packs. OSM and POI stay per-cell downloads (Overpass data is too big to prebuild). */
export const REGION_PACK_LAYERS: readonly PackLayerId[] = ['land', 'mvum', 'trails'];

export interface RegionPackFile {
  layer: PackLayerId;
  /** File name next to the manifest. */
  file: string;
  /** Size of the zip, for the download estimate. */
  bytes: number;
  /** ISO timestamp of the build; a different value than the installed one means an update exists. */
  version: string;
}

export interface RegionEntry {
  id: string;
  name: string;
  /** Every z10 cell the region's packs cover, as `[cx, cy]`. */
  cells: [number, number][];
  packs: RegionPackFile[];
}

/** One state's hunting-unit pack: a single zip holding `units.json` (a GeoJSON FeatureCollection, src/huntUnits/types.ts). */
export interface HuntUnitPackEntry {
  /** Two-letter postal code. */
  state: string;
  name: string;
  agency: string;
  /** The agency's regulations page: the authority the boundaries defer to. */
  regsUrl: string;
  /** Free text: which season / year the agency says the boundaries are for; empty when it states none. */
  vintage: string;
  file: string;
  bytes: number;
  /** ISO timestamp of the build; a different value than the installed one means an update exists. */
  version: string;
  /** When the units were downloaded from the agency's service (ISO timestamp), if recorded. */
  fetchedAt?: string;
  /** `[west, south, east, north]` of everything in the pack. */
  bbox: [number, number, number, number];
  unitCount: number;
  /** The unit sets inside (species / layers); the first is shown by default. `updated` is the source layer's last-edited date (YYYY-MM-DD) when its service says. */
  sets: { id: string; label: string; count: number; updated?: string }[];
}

export interface RegionPackManifest {
  format: number;
  regions: RegionEntry[];
  /** Hunting-unit packs; absent from manifests published before they existed. */
  huntUnits: HuntUnitPackEntry[];
}

/** The one file inside a hunting-unit zip. */
export const HUNT_UNITS_ENTRY_NAME = 'units.json';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCellIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** A bare file name: it is joined onto the manifest's folder, so no path separators or `..`. */
const isPlainFileName = (value: string) => value.length > 0 && !/[\\/]/.test(value) && value !== '..';

function parsePackFile(value: unknown, where: string): RegionPackFile {
  if (!isRecord(value)) throw new Error(`${where}: not an object`);
  const { layer, file, bytes, version } = value;
  if (typeof layer !== 'string' || !REGION_PACK_LAYERS.includes(layer as PackLayerId)) {
    throw new Error(`${where}: unknown layer ${JSON.stringify(layer)}`);
  }
  if (typeof file !== 'string' || !isPlainFileName(file)) throw new Error(`${where}: bad file name`);
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) throw new Error(`${where}: bad size`);
  if (typeof version !== 'string' || version.length === 0) throw new Error(`${where}: missing version`);
  return { layer: layer as PackLayerId, file, bytes, version };
}

function parseRegion(value: unknown, index: number): RegionEntry {
  const where = `regions[${index}]`;
  if (!isRecord(value)) throw new Error(`${where}: not an object`);
  const { id, name, cells, packs } = value;
  if (typeof id !== 'string' || id.length === 0) throw new Error(`${where}: missing id`);
  if (typeof name !== 'string' || name.length === 0) throw new Error(`${where}: missing name`);
  if (!Array.isArray(cells)) throw new Error(`${where}: cells must be a list`);
  if (!Array.isArray(packs)) throw new Error(`${where}: packs must be a list`);
  return {
    id,
    name,
    cells: cells.map((cell, i) => {
      if (!Array.isArray(cell) || cell.length !== 2 || !isCellIndex(cell[0]) || !isCellIndex(cell[1])) {
        throw new Error(`${where}.cells[${i}]: expected [cx, cy]`);
      }
      return [cell[0], cell[1]];
    }),
    packs: packs.map((pack, i) => parsePackFile(pack, `${where}.packs[${i}]`)),
  };
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parseHuntUnitPack(value: unknown, index: number): HuntUnitPackEntry {
  const where = `huntUnits[${index}]`;
  if (!isRecord(value)) throw new Error(`${where}: not an object`);
  const { state, name, agency, regsUrl, vintage, file, bytes, version, fetchedAt, bbox, unitCount, sets } = value;
  if (typeof state !== 'string' || !/^[A-Z]{2}$/.test(state)) throw new Error(`${where}: bad state code`);
  if (typeof name !== 'string' || !name) throw new Error(`${where}: missing name`);
  if (typeof agency !== 'string' || !agency) throw new Error(`${where}: missing agency`);
  if (typeof regsUrl !== 'string' || !/^https?:\/\//.test(regsUrl)) throw new Error(`${where}: bad regulations link`);
  if (typeof vintage !== 'string') throw new Error(`${where}: missing vintage`);
  if (typeof file !== 'string' || !isPlainFileName(file)) throw new Error(`${where}: bad file name`);
  if (!isFiniteNumber(bytes) || bytes < 0) throw new Error(`${where}: bad size`);
  if (typeof version !== 'string' || !version) throw new Error(`${where}: missing version`);
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(isFiniteNumber) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    throw new Error(`${where}: bad bounding box`);
  }
  if (!isFiniteNumber(unitCount) || unitCount < 0) throw new Error(`${where}: bad unit count`);
  if (!Array.isArray(sets) || sets.length === 0) throw new Error(`${where}: needs at least one set`);
  return {
    state,
    name,
    agency,
    regsUrl,
    vintage,
    file,
    bytes,
    version,
    ...(typeof fetchedAt === 'string' && fetchedAt ? { fetchedAt } : {}),
    bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
    unitCount,
    sets: sets.map((set, i) => {
      if (!isRecord(set) || typeof set.id !== 'string' || typeof set.label !== 'string' || !isFiniteNumber(set.count)) {
        throw new Error(`${where}.sets[${i}]: expected {id, label, count}`);
      }
      const updated = typeof set.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(set.updated) ? set.updated : undefined;
      return { id: set.id, label: set.label, count: set.count, ...(updated ? { updated } : {}) };
    }),
  };
}

/** Validates a downloaded manifest. Throws a readable error for anything this app version can't safely use. */
export function parseRegionManifest(json: unknown): RegionPackManifest {
  if (!isRecord(json)) throw new Error('The region pack list is not valid JSON');
  const { format, regions, huntUnits } = json;
  if (typeof format !== 'number') throw new Error('The region pack list has no format version');
  if (format > REGION_PACK_FORMAT) {
    throw new Error('The region pack list is newer than this version of the app — update the app to use it');
  }
  if (format < REGION_PACK_FORMAT) throw new Error('The region pack list is out of date');
  if (!Array.isArray(regions)) throw new Error('The region pack list has no regions');
  if (huntUnits !== undefined && !Array.isArray(huntUnits)) throw new Error('The region pack list has a bad hunting-unit list');
  return { format, regions: regions.map(parseRegion), huntUnits: (huntUnits ?? []).map(parseHuntUnitPack) };
}

/** Where a pack's zip lives: next to the manifest it was listed in. */
export function regionPackUrl(manifestUrl: string, file: string): string {
  if (!isPlainFileName(file)) throw new Error(`Bad pack file name: ${file}`);
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1) + file;
}

/** The zip entry / on-disk file name for a cell. */
export function cellEntryName(cx: number, cy: number): string {
  return `${cx}_${cy}.json`;
}

const CELL_ENTRY_PATTERN = /^(\d+)_(\d+)\.json$/;

/** Inverse of `cellEntryName`; null for anything else in the zip (folders, stray files). */
export function parseCellEntryName(name: string): { cx: number; cy: number } | null {
  const match = CELL_ENTRY_PATTERN.exec(name);
  return match ? { cx: Number(match[1]), cy: Number(match[2]) } : null;
}
