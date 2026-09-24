/**
 * importExport.ts keeps its parse/serialize helpers private, so the pure logic
 * (format detection, GeoJSON parsing, folder mapping, export file naming) is
 * exercised through the two public entry points with expo-file-system,
 * expo-sharing and the repos replaced by in-memory fakes. Nothing here touches
 * a real file system, database or share sheet; `createBackup` (zip of the real
 * DB + photos) is deliberately not covered because it needs a device.
 */
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { LINE, POINT, POLYGON, makeFeature } from '../testing/featureFixtures';
import { createFeature } from './featuresRepo';
import { createFolder } from './foldersRepo';
import { exportFeatures, importFile } from './importExport';

// jest.mock() calls are hoisted above the imports by babel-plugin-jest-hoist; the
// factories only touch `mockState` lazily (inside methods), so declaration order is safe.
const mockState = {
  filesByUri: {} as Record<string, string>,
  existing: new Set<string>(),
  written: [] as { uri: string; content: string }[],
  deleted: [] as string[],
};

jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((p) => (typeof p === 'string' ? p : p.uri))
        .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
        .join('/');
    }
    get exists() {
      return mockState.existing.has(this.uri);
    }
    delete() {
      mockState.deleted.push(this.uri);
      mockState.existing.delete(this.uri);
    }
    write(content: string) {
      mockState.written.push({ uri: this.uri, content });
    }
    async text() {
      return mockState.filesByUri[this.uri];
    }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } } };
});
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-sqlite', () => ({ defaultDatabaseDirectory: '/databases' }));
jest.mock('./db', () => ({ DATABASE_NAME: 'kmaps.db' }));
jest.mock('./featuresRepo', () => ({ createFeature: jest.fn() }));
jest.mock('./foldersRepo', () => ({ createFolder: jest.fn() }));

const shareAsync = Sharing.shareAsync as jest.Mock;
const createFolderMock = createFolder as jest.Mock;
const createFeatureMock = createFeature as jest.Mock;
const db = {} as SQLiteDatabase;

beforeEach(() => {
  mockState.filesByUri = {};
  mockState.existing = new Set();
  mockState.written = [];
  mockState.deleted = [];
  shareAsync.mockClear();
  createFolderMock.mockReset();
  createFeatureMock.mockReset();
  let nextFolderId = 100;
  createFolderMock.mockImplementation(async () => nextFolderId++);
  createFeatureMock.mockResolvedValue(1);
});

function pick(fileName: string, content: string): [SQLiteDatabase, string, string] {
  const uri = `file:///picked/${fileName}`;
  mockState.filesByUri[uri] = content;
  return [db, uri, fileName];
}

const featureCollection = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });
const geoFeature = (geometry: unknown, properties: Record<string, unknown> | null = {}) => ({
  type: 'Feature',
  properties,
  geometry,
});

describe('exportFeatures', () => {
  it('refuses to export nothing', async () => {
    await expect(exportFeatures([], 'geojson', 'empty')).rejects.toThrow('Nothing to export.');
    expect(mockState.written).toEqual([]);
    expect(shareAsync).not.toHaveBeenCalled();
  });

  it('writes GeoJSON (pretty-printed) to the cache and shares it with the GeoJSON mime type', async () => {
    await exportFeatures([makeFeature(POINT, { name: 'Camp' })], 'geojson', 'my-pins');
    expect(mockState.written).toHaveLength(1);
    expect(mockState.written[0].uri).toBe('file:///cache/my-pins.geojson');
    const parsed = JSON.parse(mockState.written[0].content);
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.features[0].properties.name).toBe('Camp');
    expect(mockState.written[0].content).toContain('\n  '); // indented
    expect(shareAsync).toHaveBeenCalledWith('file:///cache/my-pins.geojson', {
      mimeType: 'application/geo+json',
      dialogTitle: 'Export my-pins',
    });
  });

  it('writes GPX with the .gpx extension and GPX mime type', async () => {
    await exportFeatures([makeFeature(LINE, { name: 'Trail' })], 'gpx', 'track');
    expect(mockState.written[0].uri).toBe('file:///cache/track.gpx');
    expect(mockState.written[0].content).toContain('<gpx ');
    expect(shareAsync.mock.calls[0][1].mimeType).toBe('application/gpx+xml');
  });

  it('writes KML with the .kml extension and KML mime type', async () => {
    await exportFeatures([makeFeature(POLYGON, { name: 'Unit' })], 'kml', 'areas');
    expect(mockState.written[0].uri).toBe('file:///cache/areas.kml');
    expect(mockState.written[0].content).toContain('<kml ');
    expect(shareAsync.mock.calls[0][1].mimeType).toBe('application/vnd.google-earth.kml+xml');
  });

  it('deletes a stale export of the same name before rewriting it', async () => {
    mockState.existing.add('file:///cache/pins.gpx');
    await exportFeatures([makeFeature(POINT)], 'gpx', 'pins');
    expect(mockState.deleted).toEqual(['file:///cache/pins.gpx']);
    expect(mockState.written).toHaveLength(1);
  });

  it('does not try to delete when there is no previous export', async () => {
    await exportFeatures([makeFeature(POINT)], 'gpx', 'fresh');
    expect(mockState.deleted).toEqual([]);
  });
});

describe('importFile: format detection', () => {
  const gpx = '<gpx><wpt lat="1" lon="2"><name>a</name></wpt></gpx>';
  const kml = '<kml><Document><Placemark><name>a</name><Point><coordinates>2,1,0</coordinates></Point></Placemark></Document></kml>';
  const geojson = featureCollection([geoFeature({ type: 'Point', coordinates: [2, 1] })]);

  it.each([
    ['hike.gpx', gpx],
    ['HIKE.GPX', gpx],
    ['hike.kml', kml],
    ['hike.KML', kml],
    ['hike.geojson', geojson],
    ['hike.json', geojson],
    ['export.GeoJSON', geojson],
  ])('recognises %s', async (fileName, content) => {
    await expect(importFile(...pick(fileName, content))).resolves.toMatchObject({ count: 1 });
  });

  it.each(['notes.txt', 'archive.zip', 'noextension', 'hike.gpx.bak', 'map.kmz', ''])(
    'rejects unrecognised file name %j before reading anything',
    async (fileName) => {
      await expect(importFile(...pick(fileName, gpx))).rejects.toThrow(`Unrecognized file type: ${fileName}`);
      expect(createFolderMock).not.toHaveBeenCalled();
      expect(createFeatureMock).not.toHaveBeenCalled();
    }
  );

  it('parses by extension, not by content (a GPX body in a .kml file yields nothing)', async () => {
    await expect(importFile(...pick('actually-gpx.kml', gpx))).rejects.toThrow(
      'No points, lines, or areas found in this file.'
    );
  });
});

describe('importFile: result and folder mapping', () => {
  it('creates one "Imported: <name>" base folder (extension stripped) and reports it', async () => {
    const result = await importFile(
      ...pick('hike.gpx', '<gpx><wpt lat="1" lon="2"><name>a</name></wpt></gpx>')
    );
    expect(result).toEqual({ count: 1, folderName: 'Imported: hike' });
    expect(createFolderMock).toHaveBeenCalledTimes(1);
    expect(createFolderMock).toHaveBeenCalledWith(db, { name: 'Imported: hike' });
  });

  it('only strips the last extension from the folder name', async () => {
    const result = await importFile(
      ...pick('my.trip.v2.gpx', '<gpx><wpt lat="1" lon="2"/></gpx>')
    );
    expect(result.folderName).toBe('Imported: my.trip.v2');
  });

  it('inserts every feature as source "imported" into the base folder', async () => {
    createFolderMock.mockResolvedValueOnce(42);
    await importFile(
      ...pick(
        'mixed.gpx',
        `<gpx><wpt lat="1" lon="2"><name>W</name><desc>note</desc></wpt>
          <trk><name>T</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk></gpx>`
      )
    );
    expect(createFeatureMock).toHaveBeenCalledTimes(2);
    expect(createFeatureMock.mock.calls[0][1]).toEqual({
      folderId: 42,
      name: 'W',
      notes: 'note',
      geometry: { type: 'Point', coordinates: [2, 1] },
      source: 'imported',
    });
    expect(createFeatureMock.mock.calls[1][1]).toMatchObject({
      folderId: 42,
      name: 'T',
      geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
      source: 'imported',
    });
  });

  it('recreates KML folder nesting under the base folder with correct parents', async () => {
    createFolderMock
      .mockResolvedValueOnce(10) // base
      .mockResolvedValueOnce(11) // Trip
      .mockResolvedValueOnce(12); // Day 1
    await importFile(
      ...pick(
        'trip.kml',
        `<kml><Document><Folder><name>Trip</name><Folder><name>Day 1</name>
          <Placemark><name>deep</name><Point><coordinates>1,2,0</coordinates></Point></Placemark>
        </Folder></Folder></Document></kml>`
      )
    );
    expect(createFolderMock.mock.calls.map((c) => c[1])).toEqual([
      { name: 'Imported: trip' },
      { name: 'Trip', parentId: 10 },
      { name: 'Day 1', parentId: 11 },
    ]);
    expect(createFeatureMock.mock.calls[0][1].folderId).toBe(12);
  });

  it('creates a missing ancestor folder when only a nested folder has placemarks', async () => {
    await importFile(
      ...pick(
        'nested.kml',
        `<kml><Document><Folder><name>A</name><Folder><name>B</name>
          <Placemark><Point><coordinates>1,2,0</coordinates></Point></Placemark></Folder></Folder></Document></kml>`
      )
    );
    expect(createFolderMock.mock.calls.map((c) => c[1].name)).toEqual(['Imported: nested', 'A', 'B']);
  });

  it('reuses a folder for every placemark in it, and puts root placemarks in the base folder', async () => {
    createFolderMock.mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    await importFile(
      ...pick(
        'reuse.kml',
        `<kml><Document>
          <Placemark><name>root</name><Point><coordinates>0,0,0</coordinates></Point></Placemark>
          <Folder><name>A</name>
            <Placemark><name>a1</name><Point><coordinates>1,1,0</coordinates></Point></Placemark>
            <Placemark><name>a2</name><Point><coordinates>2,2,0</coordinates></Point></Placemark>
          </Folder></Document></kml>`
      )
    );
    expect(createFolderMock).toHaveBeenCalledTimes(2); // base + A, not base + A + A
    const folderByName = Object.fromEntries(createFeatureMock.mock.calls.map((c) => [c[1].name, c[1].folderId]));
    expect(folderByName).toEqual({ root: 10, a1: 11, a2: 11 });
  });

  it('keeps sibling folders with the same name under different parents distinct', async () => {
    await importFile(
      ...pick(
        'dupes.kml',
        `<kml><Document>
          <Folder><name>A</name><Folder><name>Camps</name><Placemark><name>x</name><Point><coordinates>1,1,0</coordinates></Point></Placemark></Folder></Folder>
          <Folder><name>B</name><Folder><name>Camps</name><Placemark><name>y</name><Point><coordinates>2,2,0</coordinates></Point></Placemark></Folder></Folder>
        </Document></kml>`
      )
    );
    const names = createFolderMock.mock.calls.map((c) => c[1].name);
    expect(names).toEqual(['Imported: dupes', 'A', 'Camps', 'B', 'Camps']);
    const [x, y] = createFeatureMock.mock.calls.map((c) => c[1].folderId);
    expect(x).not.toBe(y);
  });

  it('GPX imports are flat (no folder beyond the base folder)', async () => {
    await importFile(
      ...pick('flat.gpx', '<gpx><wpt lat="1" lon="2"/><wpt lat="3" lon="4"/></gpx>')
    );
    expect(createFolderMock).toHaveBeenCalledTimes(1);
  });

  it('throws when nothing importable is found, before creating any folder', async () => {
    await expect(importFile(...pick('empty.gpx', '<gpx></gpx>'))).rejects.toThrow(
      'No points, lines, or areas found in this file.'
    );
    expect(createFolderMock).not.toHaveBeenCalled();
    expect(createFeatureMock).not.toHaveBeenCalled();
  });

  it('propagates a database failure instead of reporting a partial import as success', async () => {
    createFeatureMock.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      importFile(...pick('fail.gpx', '<gpx><wpt lat="1" lon="2"/></gpx>'))
    ).rejects.toThrow('disk full');
  });

  it('counts every inserted feature', async () => {
    const wpts = Array.from({ length: 25 }, (_, i) => `<wpt lat="${i}" lon="${i}"/>`).join('');
    const result = await importFile(...pick('many.gpx', `<gpx>${wpts}</gpx>`));
    expect(result.count).toBe(25);
    expect(createFeatureMock).toHaveBeenCalledTimes(25);
  });
});

describe('importFile: GeoJSON parsing', () => {
  it('imports points, lines and polygons from a FeatureCollection, keeping geometry as-is', async () => {
    const polygonWithHole = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]],
      ],
    };
    const result = await importFile(
      ...pick(
        'all.geojson',
        featureCollection([
          geoFeature(POINT, { name: 'p' }),
          geoFeature(LINE, { name: 'l' }),
          geoFeature(polygonWithHole, { name: 'a' }),
        ])
      )
    );
    expect(result.count).toBe(3);
    expect(createFeatureMock.mock.calls.map((c) => c[1].geometry)).toEqual([POINT, LINE, polygonWithHole]);
  });

  it('reads name and notes from properties, falling back to `description` for notes', async () => {
    await importFile(
      ...pick(
        'props.geojson',
        featureCollection([
          geoFeature(POINT, { name: 'A', notes: 'n1', description: 'ignored' }),
          geoFeature(POINT, { name: 'B', description: 'from description' }),
          geoFeature(POINT, {}),
          geoFeature(POINT, null),
        ])
      )
    );
    const inputs = createFeatureMock.mock.calls.map((c) => c[1]);
    expect(inputs.map((i) => [i.name, i.notes])).toEqual([
      ['A', 'n1'],
      ['B', 'from description'],
      [null, null],
      [null, null],
    ]);
  });

  it('accepts a single Feature (not wrapped in a FeatureCollection)', async () => {
    const result = await importFile(
      ...pick('one.geojson', JSON.stringify(geoFeature(POINT, { name: 'solo' })))
    );
    expect(result.count).toBe(1);
    expect(createFeatureMock.mock.calls[0][1].name).toBe('solo');
  });

  it('skips features with null, missing or unsupported geometry but imports the rest', async () => {
    const result = await importFile(
      ...pick(
        'partial.geojson',
        featureCollection([
          geoFeature(null, { name: 'null geometry' }),
          { type: 'Feature', properties: { name: 'no geometry key' } },
          null,
          geoFeature({ type: 'GeometryCollection', geometries: [] }, { name: 'collection' }),
          geoFeature(POINT, { name: 'kept' }),
        ])
      )
    );
    expect(result.count).toBe(1);
    expect(createFeatureMock.mock.calls[0][1].name).toBe('kept');
  });

  it('currently drops Multi* geometries entirely (documented limitation)', async () => {
    // GeoJSON import only accepts Point/LineString/Polygon; MultiPoint,
    // MultiLineString and MultiPolygon features are ignored, so a file made
    // only of them fails with "No points, lines, or areas found". If Multi*
    // support is added (e.g. exploding into single-part features), update this.
    await expect(
      importFile(
        ...pick(
          'multi.geojson',
          featureCollection([
            geoFeature({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }),
            geoFeature({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] }),
            geoFeature({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }),
          ])
        )
      )
    ).rejects.toThrow('No points, lines, or areas found in this file.');
  });

  it('does not import colours from GeoJSON properties (export writes them, import ignores them)', async () => {
    await importFile(
      ...pick('color.geojson', featureCollection([geoFeature(POINT, { name: 'red', color: '#e11d48' })]))
    );
    expect(createFeatureMock.mock.calls[0][1]).not.toHaveProperty('color');
  });

  it('rejects invalid JSON with a SyntaxError', async () => {
    await expect(importFile(...pick('bad.geojson', '{"type": "FeatureCollection", '))).rejects.toThrow(SyntaxError);
    expect(createFolderMock).not.toHaveBeenCalled();
  });

  it('rejects an empty file', async () => {
    await expect(importFile(...pick('empty.geojson', ''))).rejects.toThrow();
  });

  it('rejects JSON that is not GeoJSON at all', async () => {
    await expect(importFile(...pick('scalar.json', '42'))).rejects.toThrow(
      'No points, lines, or areas found in this file.'
    );
    await expect(importFile(...pick('list.json', '[1,2,3]'))).rejects.toThrow(
      'No points, lines, or areas found in this file.'
    );
    await expect(importFile(...pick('empty-fc.json', featureCollection([])))).rejects.toThrow(
      'No points, lines, or areas found in this file.'
    );
  });
});

describe('importFile: known issues', () => {
  // BUG (src/data/importExport.ts:105-113, folderIdFor): folders are cached by
  // `path.join('/')`, so the single-level folder "Trails/Day 1" and the nested
  // path Trails > Day 1 map to the same cache key and the second placemark
  // lands in the first one's folder. Slash-containing folder names are common
  // in hand-named KML folders. Proposed fix: key the cache with
  // `JSON.stringify(path)` (or join with a separator that cannot occur, e.g. '\u0000').
  it('does not merge a folder named "A/B" with the nested folders A > B', async () => {
    await importFile(
      ...pick(
        'collide.kml',
        `<kml><Document>
          <Folder><name>Trails/Day 1</name><Placemark><name>p1</name><Point><coordinates>1,1,0</coordinates></Point></Placemark></Folder>
          <Folder><name>Trails</name><Folder><name>Day 1</name><Placemark><name>p2</name><Point><coordinates>2,2,0</coordinates></Point></Placemark></Folder></Folder>
        </Document></kml>`
      )
    );
    const [p1, p2] = createFeatureMock.mock.calls.map((c) => c[1].folderId);
    expect(p1).not.toBe(p2);
  });
});
