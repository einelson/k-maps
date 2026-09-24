/**
 * On-device copy of the last wildfire fetch, so the layer still shows the "last known" state with no
 * signal. One JSON file at `<documents>/live/wildfire.json` holding `{ fetchedAt, collection }`.
 *
 * Uses the class-based expo-file-system API, like src/packs/packStorage.ts.
 */

import { Directory, File, Paths } from 'expo-file-system';

import type { PackFeatureCollection } from './types.ts';

export interface WildfireSnapshot {
  /** When the data was fetched from NIFC (epoch ms) — not when it was written. */
  fetchedAt: number;
  collection: PackFeatureCollection;
}

const LIVE_DIRECTORY = new Directory(Paths.document, 'live');
const snapshotFile = () => new File(LIVE_DIRECTORY, 'wildfire.json');

export function writeWildfireSnapshot(snapshot: WildfireSnapshot): void {
  if (!LIVE_DIRECTORY.exists) LIVE_DIRECTORY.create({ intermediates: true, idempotent: true });
  const file = snapshotFile();
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(snapshot));
}

/** The saved snapshot, or null when there is none or it is unreadable/corrupt. */
export async function readWildfireSnapshot(): Promise<WildfireSnapshot | null> {
  try {
    const file = snapshotFile();
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text());
    if (typeof parsed?.fetchedAt !== 'number' || parsed?.collection?.type !== 'FeatureCollection') return null;
    return parsed as WildfireSnapshot;
  } catch {
    return null;
  }
}

export function deleteWildfireSnapshot(): void {
  const file = snapshotFile();
  if (file.exists) file.delete();
}
