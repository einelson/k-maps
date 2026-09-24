import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Photo } from './types';

/** Photos live in `<document>/photos/`; the zip backup (§7.4) zips whatever `photos.path` points at. */
function photosDirectory(): Directory {
  return new Directory(Paths.document, 'photos');
}

/** Extension of a picked/captured file's URI (query/fragment ignored), lowercased; `jpg` when there isn't a sane one. */
export function photoExtension(sourceUri: string): string {
  const withoutQuery = sourceUri.split(/[?#]/)[0] ?? '';
  const lastSegment = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(lastSegment);
  return match ? match[1].toLowerCase() : 'jpg';
}

/** `<featureId>-<timestamp>-<random>.<ext>` — unique even for several photos added in the same millisecond. */
export function makePhotoFileName(featureId: number, sourceUri: string): string {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${featureId}-${Date.now()}-${rand}.${photoExtension(sourceUri)}`;
}

/** Deleting a file that's already gone (or that we can't reach) must never fail the caller. */
function removeFileQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Missing/unreadable file: nothing left to clean up.
  }
}

export async function listPhotos(db: SQLiteDatabase, featureId: number): Promise<Photo[]> {
  return db.getAllAsync<Photo>(
    'SELECT * FROM photos WHERE feature_id = ? ORDER BY id',
    featureId
  );
}

/** Photo count per feature id (features without photos are absent from the map). */
export async function countPhotosByFeature(db: SQLiteDatabase): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ feature_id: number; count: number }>(
    'SELECT feature_id, COUNT(*) AS count FROM photos GROUP BY feature_id'
  );
  return new Map(rows.map((r) => [r.feature_id, r.count]));
}

/**
 * Copies a picked/captured image (usually an ImagePicker cache file) into the
 * app's permanent photos folder and records it against the feature. If the
 * copy fails nothing is inserted; if the insert fails the copy is removed.
 */
export async function addPhoto(
  db: SQLiteDatabase,
  featureId: number,
  sourceUri: string
): Promise<Photo> {
  const directory = photosDirectory();
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });

  const destination = new File(directory, makePhotoFileName(featureId, sourceUri));
  await new File(sourceUri).copy(destination);

  const path = destination.uri;
  try {
    const result = await db.runAsync(
      'INSERT INTO photos (feature_id, path) VALUES (?, ?)',
      featureId,
      path
    );
    return { id: result.lastInsertRowId, feature_id: featureId, path };
  } catch (e) {
    removeFileQuietly(path);
    throw e;
  }
}

export async function deletePhoto(db: SQLiteDatabase, photo: Photo): Promise<void> {
  await db.runAsync('DELETE FROM photos WHERE id = ?', photo.id);
  removeFileQuietly(photo.path);
}

// Stay well under SQLite's bound-variable limit (999 on older builds).
const ID_CHUNK = 500;

/**
 * Removes every photo row and file belonging to the given features. Called by
 * `deleteFeature`/`bulkDelete` before the feature rows go (foreign keys may be
 * off, so the schema's ON DELETE CASCADE can't be relied on).
 */
export async function deletePhotosForFeatures(
  db: SQLiteDatabase,
  featureIds: number[]
): Promise<void> {
  for (let i = 0; i < featureIds.length; i += ID_CHUNK) {
    const chunk = featureIds.slice(i, i + ID_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const photos = await db.getAllAsync<Photo>(
      `SELECT * FROM photos WHERE feature_id IN (${placeholders})`,
      ...chunk
    );
    if (photos.length === 0) continue;
    // Rows first: a leftover file is harmless, a row pointing at a missing file is not.
    await db.runAsync(`DELETE FROM photos WHERE feature_id IN (${placeholders})`, ...chunk);
    for (const photo of photos) removeFileQuietly(photo.path);
  }
}
