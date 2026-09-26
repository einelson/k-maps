import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import JSZip from 'jszip';

import { DATABASE_NAME } from './db';
import { createFeature } from './featuresRepo';
import { createFolder } from './foldersRepo';
import { featuresToGeoJSON, parseGeoJSON } from './geojsonFormat';
import { featuresToGpx, parseGpx } from './gpx';
import type { ExportFormat, ParsedImportFeature } from './importTypes';
import { featuresToKml, parseKml } from './kml';
import { extractKmlFromKmz } from './kmz';
import { getTrackDataForFeatures, saveTrackData } from './trackDataRepo';
import type { Feature } from './types';
import type { TrackSamples } from '../features/trackStats';

const EXTENSION: Record<ExportFormat, string> = { geojson: 'geojson', gpx: 'gpx', kml: 'kml' };
const MIME_TYPE: Record<ExportFormat, string> = {
  geojson: 'application/geo+json',
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
};

function serialize(features: Feature[], format: ExportFormat, samples: Map<number, TrackSamples>): string {
  switch (format) {
    case 'geojson':
      return JSON.stringify(featuresToGeoJSON(features), null, 2);
    case 'gpx':
      return featuresToGpx(features, samples);
    case 'kml':
      return featuresToKml(features);
  }
}

/**
 * Writes to cache and opens the OS share sheet — same mechanism the app uses for backups. Pass `db` and a
 * GPX export carries each recorded track's time and elevation (`<time>`, `<ele>`), which other apps need
 * to show pace and a profile; without it, tracks export as bare lines.
 */
export async function exportFeatures(
  features: Feature[],
  format: ExportFormat,
  baseName: string,
  db?: SQLiteDatabase
): Promise<void> {
  if (features.length === 0) throw new Error('Nothing to export.');

  const lineIds = features.filter((f) => f.type === 'line').map((f) => f.id);
  const samples = format === 'gpx' && db ? await getTrackDataForFeatures(db, lineIds) : new Map<number, TrackSamples>();
  const content = serialize(features, format, samples);
  const file = new File(Paths.cache, `${baseName}.${EXTENSION[format]}`);
  if (file.exists) file.delete();
  file.write(content);

  await Sharing.shareAsync(file.uri, {
    mimeType: MIME_TYPE[format],
    dialogTitle: `Export ${baseName}`,
  });
}

/**
 * Content wins over the file name: files opened from another app often arrive with an opaque name (or none),
 * and people rename things. The extension only decides when the content gives no clue.
 */
function detectFormat(fileName: string, text: string): ExportFormat | null {
  const head = text.slice(0, 4096).trim();
  if (head.startsWith('{') || head.startsWith('[')) return 'geojson';
  if (/<gpx[\s>]/i.test(head)) return 'gpx';
  if (/<kml[\s>]/i.test(head)) return 'kml';

  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'geojson' || ext === 'json') return 'geojson';
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml' || ext === 'kmz') return 'kml';
  return null;
}

/** File text, unzipping a KMZ (by name, or by the zip signature when the name gives no hint). */
async function readImportText(file: File, fileName: string): Promise<string> {
  if (/\.kmz$/i.test(fileName)) {
    const kml = await extractKmlFromKmz(await file.bytes());
    if (kml != null) return kml;
  }
  const text = await file.text();
  if (text.startsWith('PK')) {
    const kml = await extractKmlFromKmz(await file.bytes());
    if (kml != null) return kml;
  }
  return text;
}

export interface ParsedImport {
  features: ParsedImportFeature[];
  format: ExportFormat;
}

/** Picked-file URI -> parsed features, without touching the database. Throws for unusable files. */
export async function parseImportFile(uri: string, fileName: string): Promise<ParsedImport> {
  const text = await readImportText(new File(uri), fileName);
  const format = detectFormat(fileName, text);
  if (!format) throw new Error(`Unrecognized file type: ${fileName}`);

  const features =
    format === 'gpx' ? parseGpx(text) : format === 'kml' ? parseKml(text) : parseGeoJSON(text);
  if (features.length === 0) throw new Error('No points, lines, or areas found in this file.');
  return { features, format };
}

// About 10 cm: a tool that closes a ring writes the first point again exactly, so this only has to absorb
// float formatting, and stays far below GPS noise so a walked loop that ends near where it began doesn't count.
const CLOSED_TOLERANCE_DEG = 1e-6;

function isClosedLine(geometry: ParsedImportFeature['geometry']): boolean {
  if (geometry.type !== 'LineString' || geometry.coordinates.length < 4) return false;
  const first = geometry.coordinates[0];
  const last = geometry.coordinates[geometry.coordinates.length - 1];
  return (
    Math.abs(first[0] - last[0]) <= CLOSED_TOLERANCE_DEG && Math.abs(first[1] - last[1]) <= CLOSED_TOLERANCE_DEG
  );
}

/**
 * GPX has no area type, so apps export areas as closed tracks (onX does this: "Lines and Area Shapes exported
 * as GPX convert to Tracks"). This counts the GPX lines that look like that; other formats have real polygons.
 */
export function countClosedLines(parsed: ParsedImport): number {
  if (parsed.format !== 'gpx') return 0;
  return parsed.features.filter((f) => isClosedLine(f.geometry)).length;
}

export interface ImportOptions {
  /** Import closed GPX tracks as areas instead of lines. Has no effect on KML or GeoJSON. */
  closedLinesAsAreas?: boolean;
}

export interface ImportResult {
  count: number;
  folderName: string;
}

/**
 * Parsed features -> inserted rows, in one transaction so a failure leaves nothing behind (and a
 * thousand-pin file isn't a thousand separate commits). Maps GPX/KML folders to app folders (§7.4):
 * everything lands under one "Imported: <file>" folder, with KML `<Folder>` nesting recreated underneath
 * it (GPX has no folder concept, so GPX imports are flat).
 */
export async function insertParsedImport(
  db: SQLiteDatabase,
  parsed: ParsedImport,
  fileName: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const baseFolderName = `Imported: ${fileName.replace(/\.[^.]+$/, '')}`;
  let count = 0;

  await db.withTransactionAsync(async () => {
    const baseFolderId = await createFolder(db, { name: baseFolderName });
    const folderIdCache = new Map<string, number>([[JSON.stringify([]), baseFolderId]]);

    async function folderIdFor(path: string[]): Promise<number> {
      const key = JSON.stringify(path); // not path.join('/'): folder "A/B" must not collide with A > B
      const cached = folderIdCache.get(key);
      if (cached != null) return cached;
      const parentId = await folderIdFor(path.slice(0, -1));
      const id = await createFolder(db, { name: path[path.length - 1], parentId });
      folderIdCache.set(key, id);
      return id;
    }

    for (const feature of parsed.features) {
      const asArea = options.closedLinesAsAreas && parsed.format === 'gpx' && isClosedLine(feature.geometry);
      const featureId = await createFeature(db, {
        folderId: await folderIdFor(feature.folderPath),
        name: feature.name,
        notes: feature.notes,
        color: feature.color ?? null,
        geometry:
          asArea && feature.geometry.type === 'LineString'
            ? { type: 'Polygon', coordinates: [feature.geometry.coordinates] }
            : feature.geometry,
        source: 'imported',
        // A way of getting around belongs to a line; a track turned into an area has none.
        ...(feature.transport && !asArea ? { transport: feature.transport } : {}),
      });
      // Per-point time/elevation only fits a line; a track turned into an area has nothing to attach it to.
      if (feature.track && !asArea) await saveTrackData(db, featureId, feature.track);
      count++;
    }
  });

  return { count, folderName: baseFolderName };
}

/** Picked-file URI -> parsed -> inserted, for callers with no reason to ask the user anything in between. */
export async function importFile(
  db: SQLiteDatabase,
  uri: string,
  fileName: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  return insertParsedImport(db, await parseImportFile(uri, fileName), fileName, options);
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
