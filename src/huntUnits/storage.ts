/**
 * App-side (expo-file-system) storage for downloaded hunting units: one GeoJSON file per state at
 * `<documents>/huntunits/<ST>.json`. The file URI is handed straight to a MapLibre GeoJSONSource, which loads
 * `file://` URIs natively, so the JS thread never parses it and it works with no connection at all.
 */

import { Directory, File, Paths } from 'expo-file-system';

export const HUNT_UNITS_DIRECTORY = new Directory(Paths.document, 'huntunits');

/** A state code becomes part of a file path, so refuse anything but two capital letters. */
function stateFile(state: string): File {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error(`Bad state code: ${state}`);
  return new File(HUNT_UNITS_DIRECTORY, `${state}.json`);
}

/** `file://` URI of a state's units (whether or not it has been written yet). */
export function huntUnitsUri(state: string): string {
  return stateFile(state).uri;
}

export function huntUnitsExist(state: string): boolean {
  return stateFile(state).exists;
}

/** Writes (or replaces) a state's units, returning the file size in bytes. */
export function writeHuntUnits(state: string, json: string): number {
  if (!HUNT_UNITS_DIRECTORY.exists) HUNT_UNITS_DIRECTORY.create({ intermediates: true, idempotent: true });
  const file = stateFile(state);
  file.create({ overwrite: true, intermediates: true });
  file.write(json);
  return file.size;
}

/** Removes a state's units (no-op if absent). */
export function deleteHuntUnits(state: string): void {
  const file = stateFile(state);
  if (file.exists) file.delete();
}
