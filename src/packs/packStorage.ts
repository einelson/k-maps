/**
 * App-side (expo-file-system) storage for downloaded packs: one JSON file per
 * cell per layer at `<documents>/packs/<layer>/<cx>_<cy>.json`. The file URI
 * is handed straight to a MapLibre GeoJSONSource as `data`, which loads
 * `file://` URIs natively — so the JS thread never has to parse the pack.
 *
 * Uses the class-based expo-file-system API (Directory / File / Paths), like
 * src/downloads/mbtiles.ts and src/data/importExport.ts.
 */

import { Directory, File, Paths } from 'expo-file-system';

import type { FeatureCollection } from 'geojson';

import type { PackLayerId } from './types.ts';

export const PACKS_DIRECTORY = new Directory(Paths.document, 'packs');

function layerDirectory(layer: PackLayerId): Directory {
  return new Directory(PACKS_DIRECTORY, layer);
}

function cellFile(layer: PackLayerId, cx: number, cy: number): File {
  return new File(PACKS_DIRECTORY, layer, `${cx}_${cy}.json`);
}

/** `file://` URI of a pack cell (whether or not it has been written yet). */
export function packCellUri(layer: PackLayerId, cx: number, cy: number): string {
  return cellFile(layer, cx, cy).uri;
}

/** A cell's saved JSON text, or null when the file is missing or unreadable. */
export async function readPackCellText(layer: PackLayerId, cx: number, cy: number): Promise<string | null> {
  try {
    const file = cellFile(layer, cx, cy);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

/** Writes (or replaces) a cell's pack, creating directories as needed. Returns the file size in bytes. */
export function writePackCell(
  layer: PackLayerId,
  cx: number,
  cy: number,
  fc: FeatureCollection
): number {
  return writePackCellText(layer, cx, cy, JSON.stringify(fc));
}

/** Like `writePackCell` for JSON that is already serialized (a region pack's cell files). */
export function writePackCellText(layer: PackLayerId, cx: number, cy: number, json: string): number {
  const directory = layerDirectory(layer);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const file = cellFile(layer, cx, cy);
  file.create({ overwrite: true, intermediates: true });
  file.write(json);
  return file.size;
}

/** Removes every downloaded cell of a layer. */
export function deletePackLayer(layer: PackLayerId): void {
  const directory = layerDirectory(layer);
  if (directory.exists) directory.delete();
}

/** Removes one cell's pack file (no-op if absent). */
export function deletePackCell(layer: PackLayerId, cx: number, cy: number): void {
  const file = cellFile(layer, cx, cy);
  if (file.exists) file.delete();
}

const CELL_FILE_PATTERN = /^(\d+)_(\d+)\.json$/;

/** Cells with a file on disk for this layer (from the directory listing; coverage rows say which are complete). */
export function listPackCells(layer: PackLayerId): { cx: number; cy: number }[] {
  const directory = layerDirectory(layer);
  if (!directory.exists) return [];
  const cells: { cx: number; cy: number }[] = [];
  for (const entry of directory.list()) {
    if (!(entry instanceof File)) continue;
    const match = CELL_FILE_PATTERN.exec(entry.name);
    if (match) cells.push({ cx: Number(match[1]), cy: Number(match[2]) });
  }
  return cells;
}

/** Total bytes of a layer's pack files on disk. */
export function packLayerBytes(layer: PackLayerId): number {
  const directory = layerDirectory(layer);
  if (!directory.exists) return 0;
  let total = 0;
  for (const entry of directory.list()) {
    if (entry instanceof File) total += entry.size;
  }
  return total;
}
