/**
 * importExport.ts keeps its parse/serialize helpers private, so the pure logic
 * (format detection, GeoJSON parsing, folder mapping, export file naming) is
 * exercised through the two public entry points with expo-file-system,
 * expo-sharing and the repos replaced by in-memory fakes. Nothing here touches
 * a real file system, database or share sheet; `createBackup` (zip of the real
 * DB + photos) is deliberately not covered because it needs a device.
 */
import JSZip from 'jszip';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { LINE, POINT, POLYGON, makeFeature } from '../testing/featureFixtures';
import { createFeature } from './featuresRepo';
import { createFolder } from './foldersRepo';
import { getTrackDataForFeatures, saveTrackData } from './trackDataRepo';
import { countClosedLines, exportFeatures, importFile, insertParsedImport, parseImportFile } from './importExport';

// jest.mock() calls are hoisted above the imports by babel-plugin-jest-hoist; the
// factories only touch `mockState` lazily (inside methods), so declaration order is safe.
const mockState = {
  filesByUri: {} as Record<string, string>,
  bytesByUri: {} as Record<string, Uint8Array>,
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
    async bytes() {
      return mockState.bytesByUri[this.uri] ?? new TextEncoder().encode(mockState.filesByUri[this.uri]);
    }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } } };
});
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-sqlite', () => ({ defaultDatabaseDirectory: '/databases' }));
jest.mock('./db', () => ({ DATABASE_NAME: 'kmaps.db' }));
jest.mock('./featuresRepo', () => ({ createFeature: jest.fn() }));
jest.mock('./foldersRepo', () => ({ createFolder: jest.fn() }));
jest.mock('./trackDataRepo', () => ({ saveTrackData: jest.fn(), getTrackDataForFeatures: jest.fn() }));

const shareAsync = Sharing.shareAsync as jest.Mock;
const createFolderMock = createFolder as jest.Mock;
const createFeatureMock = createFeature as jest.Mock;
const saveTrackDataMock = saveTrackData as jest.Mock;
const getTrackDataMock = getTrackDataForFeatures as jest.Mock;
const withTransactionAsync = jest.fn(async (task: () => Promise<void>) => task());
const db = { withTransactionAsync } as unknown as SQLiteDatabase;

beforeEach(() => {
  mockState.filesByUri = {};
  mockState.bytesByUri = {};
  withTransactionAsync.mockClear();
  mockState.existing = new Set();
  mockState.written = [];
  mockState.deleted = [];
  shareAsync.mockClear();
  createFolderMock.mockReset();
  createFeatureMock.mockReset();
  let nextFolderId = 100;
  createFolderMock.mockImplementation(async () => nextFolderId++);
  createFeatureMock.mockResolvedValue(1);
  saveTrackDataMock.mockReset().mockResolvedValue(undefined);
  getTrackDataMock.mockReset().mockResolvedValue(new Map());
});

function pick(fileName: string, content: string): [SQLiteDatabase, string, string] {
  const uri = `file:///picked/${fileName}`;
  mockState.filesByUri[uri] = content;
  return [db, uri, fileName];
}

async function pickKmz(fileName: string, entries: Record<string, string>): Promise<[SQLiteDatabase, string, string]> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const uri = `file:///picked/${fileName}`;
  mockState.bytesByUri[uri] = bytes;
  mockState.filesByUri[uri] = Buffer.from(bytes).toString('latin1'); // what File.text() makes of a zip: starts "PK"
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

  it.each(['notes.txt', 'archive.zip', 'noextension', 'hike.gpx.bak', 'map.pdf'])(
    'rejects unrecognised file %j when its content is not GPX, KML or GeoJSON either',
    async (fileName) => {
      await expect(importFile(...pick(fileName, 'just some text'))).rejects.toThrow(
        `Unrecognized file type: ${fileName}`
      );
      expect(createFolderMock).not.toHaveBeenCalled();
      expect(createFeatureMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['notes.txt', gpx],
    ['noextension', kml],
    ['hike.gpx.bak', geojson],
    ['document%3A1234', gpx], // an opaque name from a content:// URI
  ])('sniffs the content of %j instead of trusting its name', async (fileName, content) => {
    await expect(importFile(...pick(fileName, content))).resolves.toMatchObject({ count: 1 });
  });

  it('lets content beat a wrong extension (a GPX body in a .kml file is read as GPX)', async () => {
    await expect(importFile(...pick('actually-gpx.kml', gpx))).resolves.toMatchObject({ count: 1 });
    expect(createFeatureMock.mock.calls[0][1].geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
  });

  it('sniffs past a UTF-8 BOM, an XML prolog and leading whitespace', async () => {
    const withProlog = `\uFEFF  \n<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by x -->\n${gpx}`;
    await expect(importFile(...pick('bom.dat', withProlog))).resolves.toMatchObject({ count: 1 });
  });

  it('falls back to the extension when the content gives no clue, then reports nothing found', async () => {
    await expect(importFile(...pick('empty.gpx', ''))).rejects.toThrow(
      'No points, lines, or areas found in this file.'
    );
  });
});

describe('importFile: KMZ', () => {
  const kml = (name: string) =>
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${name}</name><Point><coordinates>2,1,0</coordinates></Point></Placemark></Document></kml>`;

  it('imports the doc.kml inside a .kmz and ignores the images beside it', async () => {
    const result = await importFile(
      ...(await pickKmz('trip.kmz', { 'doc.kml': kml('Camp'), 'files/icon.png': 'not really a png' }))
    );
    expect(result).toEqual({ count: 1, folderName: 'Imported: trip' });
    expect(createFeatureMock.mock.calls[0][1].name).toBe('Camp');
  });

  it('prefers doc.kml, then the shallowest .kml, when a KMZ holds several', async () => {
    await importFile(...(await pickKmz('a.kmz', { 'deep/extra/other.kml': kml('deep'), 'doc.kml': kml('main') })));
    expect(createFeatureMock.mock.calls[0][1].name).toBe('main');

    createFeatureMock.mockClear();
    await importFile(...(await pickKmz('b.kmz', { 'deep/extra/other.kml': kml('deep'), 'layer.kml': kml('shallow') })));
    expect(createFeatureMock.mock.calls[0][1].name).toBe('shallow');
  });

  it('recognises a zip by its signature when the name gives no hint', async () => {
    await expect(importFile(...(await pickKmz('document%3A99', { 'doc.kml': kml('shared') })))).resolves.toMatchObject({
      count: 1,
    });
  });

  it('is case-insensitive about the .KMZ extension and the KML inside', async () => {
    await expect(importFile(...(await pickKmz('TRIP.KMZ', { 'DOC.KML': kml('Loud') })))).resolves.toMatchObject({
      count: 1,
    });
  });

  it('explains a KMZ with no KML inside', async () => {
    await expect(importFile(...(await pickKmz('empty.kmz', { 'readme.txt': 'hi' })))).rejects.toThrow(
      'This KMZ file has no KML inside it.'
    );
    expect(createFolderMock).not.toHaveBeenCalled();
  });

  it('still reads a .kmz that is really plain KML text', async () => {
    await expect(importFile(...pick('mislabelled.kmz', kml('plain')))).resolves.toMatchObject({ count: 1 });
  });

  it('rejects a .kmz with garbage content (the extension still marks it as KML, which finds nothing)', async () => {
    await expect(importFile(...pick('bad.kmz', 'not a zip and not xml'))).rejects.toThrow(
      'No points, lines, or areas found in this file.'
    );
  });

  it('keeps KMZ folder structure and colors like a plain KML', async () => {
    const doc = `<kml><Document><Style id="s"><IconStyle><color>ff5ec522</color></IconStyle></Style>
      <Folder><name>Layer</name><Placemark><name>p</name><styleUrl>#s</styleUrl><Point><coordinates>2,1,0</coordinates></Point></Placemark></Folder></Document></kml>`;
    await importFile(...(await pickKmz('styled.kmz', { 'doc.kml': doc })));
    expect(createFolderMock.mock.calls.map((c) => c[1].name)).toEqual(['Imported: styled', 'Layer']);
    expect(createFeatureMock.mock.calls[0][1].color).toBe('#22c55e');
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
      color: null,
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

  it('does the whole import inside one transaction', async () => {
    await importFile(...pick('tx.gpx', '<gpx><wpt lat="1" lon="2"/><wpt lat="3" lon="4"/></gpx>'));
    expect(withTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it('does not open a transaction for a file it cannot parse', async () => {
    await expect(importFile(...pick('none.gpx', '<gpx></gpx>'))).rejects.toThrow();
    expect(withTransactionAsync).not.toHaveBeenCalled();
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

  it('explodes Multi* geometries and GeometryCollections into single-part features sharing the properties', async () => {
    const result = await importFile(
      ...pick(
        'multi.geojson',
        featureCollection([
          geoFeature({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }, { name: 'mp' }),
          geoFeature({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }, { name: 'ml' }),
          geoFeature(
            { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
            { name: 'mpoly' }
          ),
          geoFeature(
            { type: 'GeometryCollection', geometries: [POINT, { type: 'MultiPoint', coordinates: [[7, 7]] }] },
            { name: 'gc' }
          ),
        ])
      )
    );
    expect(result.count).toBe(2 + 2 + 2 + 2);
    const inputs = createFeatureMock.mock.calls.map((c) => c[1]);
    expect(inputs.map((i) => [i.name, i.geometry.type])).toEqual([
      ['mp', 'Point'], ['mp', 'Point'],
      ['ml', 'LineString'], ['ml', 'LineString'],
      ['mpoly', 'Polygon'], ['mpoly', 'Polygon'],
      ['gc', 'Point'], ['gc', 'Point'],
    ]);
    expect(inputs[4].geometry.coordinates).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  });

  it('accepts a bare geometry (no Feature wrapper)', async () => {
    const result = await importFile(...pick('bare.geojson', JSON.stringify(POINT)));
    expect(result.count).toBe(1);
    expect(createFeatureMock.mock.calls[0][1].geometry).toEqual(POINT);
  });

  it('reads colors from color, stroke, marker-color or fill, snapped to the palette', async () => {
    await importFile(
      ...pick(
        'color.geojson',
        featureCollection([
          geoFeature(POINT, { name: 'own', color: '#e11d48' }),
          geoFeature(POINT, { name: 'caltopo line', stroke: '#0000ff' }),
          geoFeature(POINT, { name: 'simplestyle pin', 'marker-color': '#00ff00' }),
          geoFeature(POINT, { name: 'fill only', fill: '#f80' }),
          geoFeature(POINT, { name: 'off-palette', color: '#ff0000' }),
          geoFeature(POINT, { name: 'not hex', color: 'red' }),
          geoFeature(POINT, { name: 'none' }),
        ])
      )
    );
    const colors = createFeatureMock.mock.calls.map((c) => [c[1].name, c[1].color]);
    expect(colors).toEqual([
      ['own', '#e11d48'],
      ['caltopo line', '#6366f1'],
      ['simplestyle pin', '#22c55e'],
      ['fill only', '#f97316'],
      ['off-palette', '#e11d48'],
      ['not hex', null],
      ['none', null],
    ]);
  });

  it("falls back to CalTopo's `title` for the name and numbers for text", async () => {
    await importFile(
      ...pick('title.geojson', featureCollection([geoFeature(POINT, { title: 'Ridge camp', name: '', comment: 7 })]))
    );
    expect(createFeatureMock.mock.calls[0][1]).toMatchObject({ name: 'Ridge camp', notes: '7' });
  });

  it('rejects invalid JSON with a plain-language error', async () => {
    await expect(importFile(...pick('bad.geojson', '{"type": "FeatureCollection", '))).rejects.toThrow(
      'This file is not valid GeoJSON.'
    );
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

describe('closed GPX tracks as areas', () => {
  const closedTrack = `<trk><name>Unit 12</name><trkseg>
    <trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/><trkpt lat="1" lon="1"/><trkpt lat="0" lon="0"/></trkseg></trk>`;
  const openTrack = `<trk><name>Trail</name><trkseg>
    <trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/><trkpt lat="1" lon="1"/><trkpt lat="1" lon="2"/></trkseg></trk>`;
  const gpx = (...bodies: string[]) => `<gpx>${bodies.join('')}</gpx>`;
  const importedGeometries = () => createFeatureMock.mock.calls.map((c) => c[1].geometry);

  it('counts only GPX lines whose last point returns to the first', async () => {
    expect(countClosedLines(await parseImportFile(...pick('a.gpx', gpx(closedTrack, openTrack, closedTrack)).slice(1) as [string, string]))).toBe(2);
  });

  it('counts a route as well as a track, but not a pin', async () => {
    const route = `<rte><rtept lat="0" lon="0"/><rtept lat="0" lon="1"/><rtept lat="1" lon="1"/><rtept lat="0" lon="0"/></rte>`;
    const pin = `<wpt lat="0" lon="0"/>`;
    expect(countClosedLines(await parseImportFile(...pick('a.gpx', gpx(route, pin)).slice(1) as [string, string]))).toBe(1);
  });

  it('needs at least four points (a there-and-back two-point line is not an area)', async () => {
    const thereAndBack = `<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/><trkpt lat="0" lon="0"/></trkseg></trk>`;
    expect(countClosedLines(await parseImportFile(...pick('a.gpx', gpx(thereAndBack)).slice(1) as [string, string]))).toBe(0);
  });

  it('does not count a loop whose ends are a GPS-noise apart', async () => {
    const nearlyClosed = `<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/><trkpt lat="1" lon="1"/><trkpt lat="0.00001" lon="0"/></trkseg></trk>`;
    expect(countClosedLines(await parseImportFile(...pick('a.gpx', gpx(nearlyClosed)).slice(1) as [string, string]))).toBe(0);
  });

  it('never counts KML or GeoJSON lines: those formats have real polygons', async () => {
    const kmlLoop = `<kml><Document><Placemark><LineString><coordinates>0,0 1,0 1,1 0,0</coordinates></LineString></Placemark></Document></kml>`;
    expect(countClosedLines(await parseImportFile(...pick('a.kml', kmlLoop).slice(1) as [string, string]))).toBe(0);
  });

  it('imports closed tracks as lines by default', async () => {
    await importFile(...pick('a.gpx', gpx(closedTrack)));
    expect(importedGeometries()[0].type).toBe('LineString');
  });

  it('turns closed tracks into polygons (same ring) when asked, leaving open tracks and pins alone', async () => {
    await importFile(...pick('a.gpx', gpx(closedTrack, openTrack, '<wpt lat="5" lon="5"/>')), {
      closedLinesAsAreas: true,
    });
    // GPX parsing yields waypoints first, then tracks.
    expect(importedGeometries()).toEqual([
      { type: 'Point', coordinates: [5, 5] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      expect.objectContaining({ type: 'LineString' }),
    ]);
  });

  it('does not touch a closed line in a KML file even when asked', async () => {
    const kmlLoop = `<kml><Document><Placemark><LineString><coordinates>0,0 1,0 1,1 0,0</coordinates></LineString></Placemark></Document></kml>`;
    await importFile(...pick('a.kml', kmlLoop), { closedLinesAsAreas: true });
    expect(importedGeometries()[0].type).toBe('LineString');
  });

  it('insertParsedImport works from an already-parsed file (the flow that asks before importing)', async () => {
    const parsed = await parseImportFile(...pick('later.gpx', gpx(closedTrack)).slice(1) as [string, string]);
    const result = await insertParsedImport(db, parsed, 'later.gpx', { closedLinesAsAreas: true });
    expect(result).toEqual({ count: 1, folderName: 'Imported: later' });
    expect(importedGeometries()[0].type).toBe('Polygon');
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

describe('track samples through import and export', () => {
  const timedTrack = `<gpx><trk><name>Hike</name><trkseg>
    <trkpt lat="1" lon="2"><ele>100</ele><time>2026-09-24T17:00:00Z</time></trkpt>
    <trkpt lat="3" lon="4"><ele>110</ele><time>2026-09-24T17:01:00Z</time></trkpt></trkseg></trk></gpx>`;

  it('saves a GPX track\'s time and elevation under the new feature id', async () => {
    createFeatureMock.mockResolvedValueOnce(77);
    await importFile(...pick('hike.gpx', timedTrack));
    expect(saveTrackDataMock).toHaveBeenCalledTimes(1);
    expect(saveTrackDataMock).toHaveBeenCalledWith(db, 77, {
      times: [Date.UTC(2026, 8, 24, 17, 0, 0), Date.UTC(2026, 8, 24, 17, 1, 0)],
      elevations: [100, 110],
    });
  });

  it('saves nothing for pins, plain lines or files without samples', async () => {
    await importFile(...pick('plain.gpx', '<gpx><wpt lat="1" lon="2"/><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>'));
    expect(saveTrackDataMock).not.toHaveBeenCalled();
  });

  it('does not save samples for a closed track imported as an area', async () => {
    const closed = `<gpx><trk><trkseg>
      <trkpt lat="0" lon="0"><ele>1</ele></trkpt><trkpt lat="0" lon="1"><ele>2</ele></trkpt>
      <trkpt lat="1" lon="1"><ele>3</ele></trkpt><trkpt lat="0" lon="0"><ele>1</ele></trkpt></trkseg></trk></gpx>`;
    await importFile(...pick('area.gpx', closed), { closedLinesAsAreas: true });
    expect(createFeatureMock.mock.calls[0][1].geometry.type).toBe('Polygon');
    expect(saveTrackDataMock).not.toHaveBeenCalled();
    await importFile(...pick('area.gpx', closed));
    expect(saveTrackDataMock).toHaveBeenCalledTimes(1); // as a line it keeps them
  });

  it('a GPX export with a db looks up samples for the line features only', async () => {
    getTrackDataMock.mockResolvedValue(new Map([[5, { times: [0, 1000, 2000], elevations: [1, 2, 3] }]]));
    await exportFeatures([makeFeature(LINE, { id: 5, type: 'line' }), makeFeature(POINT, { id: 6 })], 'gpx', 'mixed', db);
    expect(getTrackDataMock).toHaveBeenCalledWith(db, [5]);
    expect(mockState.written[0].content).toContain('<ele>1</ele><time>1970-01-01T00:00:00.000Z</time>');
  });

  it('does not look up samples for KML or GeoJSON, or when no db is given', async () => {
    await exportFeatures([makeFeature(LINE, { id: 5, type: 'line' })], 'kml', 'a', db);
    await exportFeatures([makeFeature(LINE, { id: 5, type: 'line' })], 'geojson', 'b', db);
    await exportFeatures([makeFeature(LINE, { id: 5, type: 'line' })], 'gpx', 'c');
    expect(getTrackDataMock).not.toHaveBeenCalled();
  });
});
