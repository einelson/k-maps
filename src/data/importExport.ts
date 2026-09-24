import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import JSZip from 'jszip';

import { DATABASE_NAME } from './db';
import { createFeature } from './featuresRepo';
import { createFolder } from './foldersRepo';
import { featuresToGeoJSON } from './geojsonFormat';
import { featuresToGpx, parseGpx } from './gpx';
import type { ExportFormat, ParsedImportFeature } from './importTypes';
import { featuresToKml, parseKml } from './kml';
import type { Feature } from './types';

const EXTENSION: Record<ExportFormat, string> = { geojson: 'geojson', gpx: 'gpx', kml: 'kml' };
const MIME_TYPE: Record<ExportFormat, string> = {
  geojson: 'application/geo+json',
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
};

function serialize(features: Feature[], format: ExportFormat): string {
  switch (format) {
    case 'geojson':
      return JSON.stringify(featuresToGeoJSON(features), null, 2);
    case 'gpx':
      return featuresToGpx(features);
    case 'kml':
      return featuresToKml(features);
  }
}

/** Writes to cache and opens the OS share sheet — same mechanism the app uses for backups. */
export async function exportFeatures(
  features: Feature[],
  format: ExportFormat,
  baseName: string
): Promise<void> {
  if (features.length === 0) throw new Error('Nothing to export.');

  const content = serialize(features, format);
  const file = new File(Paths.cache, `${baseName}.${EXTENSION[format]}`);
  if (file.exists) file.delete();
  file.write(content);

  await Sharing.shareAsync(file.uri, {
    mimeType: MIME_TYPE[format],
    dialogTitle: `Export ${baseName}`,
  });
}

function detectFormat(fileName: string): ExportFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'geojson' || ext === 'json') return 'geojson';
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml') return 'kml';
  return null;
}

function parseGeoJSONImport(content: string): ParsedImportFeature[] {
  const json = JSON.parse(content);
  const rawFeatures = json.type === 'FeatureCollection' ? json.features : [json];
  const results: ParsedImportFeature[] = [];
  for (const f of rawFeatures) {
    const type = f?.geometry?.type;
    if (type !== 'Point' && type !== 'LineString' && type !== 'Polygon') continue;
    results.push({
      name: f.properties?.name ?? null,
      notes: f.properties?.notes ?? f.properties?.description ?? null,
      geometry: f.geometry,
      folderPath: [],
    });
  }
  return results;
}

export interface ImportResult {
  count: number;
  folderName: string;
}

/**
 * Picked-file URI -> parsed features -> inserted rows. Maps GPX/KML folders
 * to app folders (§7.4): everything lands under one "Imported: <file>"
 * folder, with KML `<Folder>` nesting recreated underneath it (GPX has no
 * folder concept, so GPX imports are flat).
 */
export async function importFile(
  db: SQLiteDatabase,
  uri: string,
  fileName: string
): Promise<ImportResult> {
  const format = detectFormat(fileName);
  if (!format) throw new Error(`Unrecognized file type: ${fileName}`);

  const file = new File(uri);
  const content = await file.text();
  const parsed =
    format === 'gpx' ? parseGpx(content) : format === 'kml' ? parseKml(content) : parseGeoJSONImport(content);
  if (parsed.length === 0) throw new Error('No points, lines, or areas found in this file.');

  const baseFolderName = `Imported: ${fileName.replace(/\.[^.]+$/, '')}`;
  const baseFolderId = await createFolder(db, { name: baseFolderName });
  const folderIdCache = new Map<string, number>([['', baseFolderId]]);

  async function folderIdFor(path: string[]): Promise<number> {
    const key = path.join('/');
    const cached = folderIdCache.get(key);
    if (cached != null) return cached;
    const parentId = await folderIdFor(path.slice(0, -1));
    const id = await createFolder(db, { name: path[path.length - 1], parentId });
    folderIdCache.set(key, id);
    return id;
  }

  let count = 0;
  for (const feature of parsed) {
    const folderId = await folderIdFor(feature.folderPath);
    await createFeature(db, {
      folderId,
      name: feature.name,
      notes: feature.notes,
      geometry: feature.geometry,
      source: 'imported',
    });
    count++;
  }

  return { count, folderName: baseFolderName };
}

/**
 * Zips the SQLite DB plus every referenced photo and opens the share sheet
 * (§7.4 "full backup"). `SQLite.defaultDatabaseDirectory` and `File`'s
 * path handling are the same unverified-without-a-device territory as the
 * MBTiles path risk in src/downloads/mbtiles.ts (§12.4).
 */
export async function createBackup(db: SQLiteDatabase): Promise<void> {
  const zip = new JSZip();

  const dbFile = new File(SQLite.defaultDatabaseDirectory, DATABASE_NAME);
  zip.file(DATABASE_NAME, await dbFile.bytes());

  const photos = await db.getAllAsync<{ path: string }>('SELECT path FROM photos');
  for (const { path } of photos) {
    try {
      const photoFile = new File(path);
      if (photoFile.exists) {
        zip.file(`photos/${photoFile.name}`, await photoFile.bytes());
      }
    } catch {
      // Skip photos that can't be read rather than failing the whole backup.
    }
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = new File(Paths.cache, `kmaps-backup-${timestamp}.zip`);
  if (file.exists) file.delete();
  file.write(zipBytes);

  await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', dialogTitle: 'K-Maps backup' });
}
