/**
 * On-device files for the zoomed-out land overview (src/map/landOverview.ts): per 8 x 8 block of cells, one GeoJSON
 * file per level plus a small `meta` file saying which cells the block was built from.
 *
 *   <documents>/packs/land-overview/<bx>_<by>.meta.json            { stamp, builtAt }
 *   <documents>/packs/land-overview/<bx>_<by>.<builtAt>.coarse.json
 *   <documents>/packs/land-overview/<bx>_<by>.<builtAt>.fine.json
 *
 * The build time is in the file name, so a rebuilt block is a new URI — MapLibre reads a GeoJSON source's `data` once,
 * and an unchanged URI would keep showing the old file. Derived data: safe to delete any time, it is rebuilt on demand.
 * Uses the class-based expo-file-system API, like src/packs/packStorage.ts.
 */

import { Directory, File } from 'expo-file-system';

import { PACKS_DIRECTORY } from './packStorage.ts';

export type OverviewLevelName = 'coarse' | 'fine';

const OVERVIEW_DIRECTORY = new Directory(PACKS_DIRECTORY, 'land-overview');

export interface OverviewMeta {
  /** Fingerprint of the cells the block was built from (`overviewStamp`). */
  stamp: string;
  /** When it was built (epoch ms); part of the file names. */
  builtAt: number;
}

const metaFile = (bx: number, by: number) => new File(OVERVIEW_DIRECTORY, `${bx}_${by}.meta.json`);
const levelFile = (bx: number, by: number, builtAt: number, level: OverviewLevelName) =>
  new File(OVERVIEW_DIRECTORY, `${bx}_${by}.${builtAt}.${level}.json`);

/** `file://` URI of a block's level file, for a GeoJSONSource. */
export function overviewUri(bx: number, by: number, builtAt: number, level: OverviewLevelName): string {
  return levelFile(bx, by, builtAt, level).uri;
}

/** The block's saved meta, or null when there is none or it is unreadable. */
export async function readOverviewMeta(bx: number, by: number): Promise<OverviewMeta | null> {
  try {
    const file = metaFile(bx, by);
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text());
    if (typeof parsed?.stamp !== 'string' || typeof parsed?.builtAt !== 'number') return null;
    return { stamp: parsed.stamp, builtAt: parsed.builtAt };
  } catch {
    return null;
  }
}

/** True when both level files of a built block are on disk (something may have cleared them). */
export function overviewFilesExist(bx: number, by: number, builtAt: number): boolean {
  return levelFile(bx, by, builtAt, 'coarse').exists && levelFile(bx, by, builtAt, 'fine').exists;
}

const BLOCK_FILE_PATTERN = /^(\d+)_(\d+)\./;

/** Deletes files of a block other than the ones for `keepBuiltAt` (all of them when it is null). */
function deleteBlockFiles(bx: number, by: number, keepBuiltAt: number | null) {
  if (!OVERVIEW_DIRECTORY.exists) return;
  const keep =
    keepBuiltAt === null
      ? []
      : [`${bx}_${by}.meta.json`, `${bx}_${by}.${keepBuiltAt}.coarse.json`, `${bx}_${by}.${keepBuiltAt}.fine.json`];
  for (const entry of OVERVIEW_DIRECTORY.list()) {
    if (!(entry instanceof File) || !entry.name.startsWith(`${bx}_${by}.`) || keep.includes(entry.name)) continue;
    entry.delete();
  }
}

/** Writes a block's level files, then its meta (so a half-written block never looks finished), then removes the old build. */
export function writeOverviewBlock(
  bx: number,
  by: number,
  meta: OverviewMeta,
  json: Record<OverviewLevelName, string>
): void {
  if (!OVERVIEW_DIRECTORY.exists) OVERVIEW_DIRECTORY.create({ intermediates: true, idempotent: true });
  for (const level of ['coarse', 'fine'] as const) {
    const file = levelFile(bx, by, meta.builtAt, level);
    file.create({ overwrite: true, intermediates: true });
    file.write(json[level]);
  }
  const meta_ = metaFile(bx, by);
  meta_.create({ overwrite: true, intermediates: true });
  meta_.write(JSON.stringify(meta));
  deleteBlockFiles(bx, by, meta.builtAt);
}

/** Removes the overview files of every block not in `keep` (`"<bx>_<by>"`) — blocks whose cells were all deleted. */
export function pruneOverview(keep: ReadonlySet<string>): void {
  if (!OVERVIEW_DIRECTORY.exists) return;
  for (const entry of OVERVIEW_DIRECTORY.list()) {
    if (!(entry instanceof File)) continue;
    const match = BLOCK_FILE_PATTERN.exec(entry.name);
    if (match && !keep.has(`${match[1]}_${match[2]}`)) entry.delete();
  }
}
