import { XMLValidator } from 'fast-xml-parser';

import { LINE, POINT, POLYGON, makeFeature } from '../testing/featureFixtures';
import { featuresToKml, parseKml } from './kml';

const kmlDoc = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;

const point = (lon: number, lat: number) => `<Point><coordinates>${lon},${lat},0</coordinates></Point>`;

describe('featuresToKml', () => {
  it('produces a well-formed KML 2.2 document', () => {
    const xml = featuresToKml([
      makeFeature(POINT, { name: 'A & B <c>' }),
      makeFeature(LINE, { name: 'Trail' }),
      makeFeature(POLYGON, { name: 'Area' }),
    ]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(xml).toContain('<Document>');
  });

  it('exports an empty list as a valid empty document', () => {
    const xml = featuresToKml([]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(parseKml(xml)).toEqual([]);
  });

  it('writes coordinates as lon,lat,alt tuples (KML order, not lat/lon) with a 0 altitude', () => {
    const xml = featuresToKml([makeFeature({ type: 'Point', coordinates: [-116.5, 43.25] })]);
    expect(xml).toContain('<Point><coordinates>-116.5,43.25,0</coordinates></Point>');
  });

  it('separates line vertices with spaces', () => {
    const xml = featuresToKml([makeFeature({ type: 'LineString', coordinates: [[1, 2], [3, 4]] })]);
    expect(xml).toContain('<LineString><coordinates>1,2,0 3,4,0</coordinates></LineString>');
  });

  it('nests polygon rings as outerBoundaryIs/LinearRing', () => {
    const xml = featuresToKml([makeFeature(POLYGON)]);
    expect(xml).toContain('<Polygon><outerBoundaryIs><LinearRing><coordinates>');
    expect(xml).toContain('</coordinates></LinearRing></outerBoundaryIs></Polygon>');
  });

  it('escapes names and descriptions', () => {
    const xml = featuresToKml([makeFeature(POINT, { name: `A & B <c> "d"`, notes: `it's <b>` })]);
    expect(xml).toContain('<name>A &amp; B &lt;c&gt; &quot;d&quot;</name>');
    expect(xml).toContain('<description>it&apos;s &lt;b&gt;</description>');
  });

  it('omits name and description tags when absent', () => {
    const xml = featuresToKml([makeFeature(POINT)]);
    expect(xml).not.toContain('<name>');
    expect(xml).not.toContain('<description>');
  });

  it('exports a flat list of Placemarks (no <Folder> — folder membership is not exported)', () => {
    const xml = featuresToKml([makeFeature(POINT, { folder_id: 3 }), makeFeature(LINE, { folder_id: 4 })]);
    expect(xml.match(/<Placemark>/g)).toHaveLength(2);
    expect(xml).not.toContain('<Folder>');
  });

  it('skips Multi* geometries without throwing (not representable by the exporter)', () => {
    // Documents current behaviour: multi-part geometries are dropped on KML export.
    const xml = featuresToKml([
      makeFeature({ type: 'MultiPolygon', coordinates: [POLYGON.type === 'Polygon' ? POLYGON.coordinates : []] }),
      makeFeature({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] }),
      makeFeature({ type: 'MultiPoint', coordinates: [[0, 0]] }),
      makeFeature(POINT, { name: 'kept' }),
    ]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml.match(/<Placemark>/g)).toHaveLength(1);
    expect(parseKml(xml).map((f) => f.name)).toEqual(['kept']);
  });

  it('does not export colours (no <Style> is written)', () => {
    const xml = featuresToKml([makeFeature(POINT, { color: '#e11d48' })]);
    expect(xml).not.toContain('e11d48');
    expect(xml).not.toContain('<Style');
  });
});

describe('KML export -> import round trip', () => {
  it('preserves a point with name and notes', () => {
    const [parsed] = parseKml(featuresToKml([makeFeature(POINT, { name: 'Camp', notes: 'Near water' })]));
    expect(parsed).toEqual({ name: 'Camp', notes: 'Near water', geometry: POINT, folderPath: [] });
  });

  it('preserves a line exactly (lon/lat order, vertex order, altitude dropped)', () => {
    const [parsed] = parseKml(featuresToKml([makeFeature(LINE, { name: 'Ridge' })]));
    expect(parsed.geometry).toEqual(LINE);
    expect(parsed.name).toBe('Ridge');
  });

  it('preserves a polygon outer ring exactly', () => {
    const [parsed] = parseKml(featuresToKml([makeFeature(POLYGON, { name: 'Unit' })]));
    expect(parsed.geometry).toEqual(POLYGON);
  });

  it('drops polygon holes (only the outer ring is exported)', () => {
    const withHole = makeFeature({
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]],
      ],
    });
    const [parsed] = parseKml(featuresToKml([withHole]));
    expect(parsed.geometry.type).toBe('Polygon');
    expect((parsed.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(1);
  });

  it('round-trips special characters and multi-line notes', () => {
    const name = `A & B <c> "d" 'e'`;
    const notes = 'line one\nline two & <i>italics</i>';
    const [parsed] = parseKml(featuresToKml([makeFeature(POINT, { name, notes })]));
    expect(parsed.name).toBe(name);
    expect(parsed.notes).toBe(notes);
  });

  it('round-trips a mixed set in order', () => {
    const parsed = parseKml(
      featuresToKml([
        makeFeature(POINT, { name: 'p' }),
        makeFeature(LINE, { name: 'l' }),
        makeFeature(POLYGON, { name: 'a' }),
      ])
    );
    expect(parsed.map((f) => [f.name, f.geometry.type])).toEqual([
      ['p', 'Point'],
      ['l', 'LineString'],
      ['a', 'Polygon'],
    ]);
  });

  it('round-trips full-precision negative coordinates exactly', () => {
    const geometry = { type: 'Point' as const, coordinates: [-116.123456789012, -43.987654321098] };
    expect(parseKml(featuresToKml([makeFeature(geometry)]))[0].geometry).toEqual(geometry);
  });
});

describe('parseKml: folders', () => {
  it('reports no folder path for placemarks directly under <Document>', () => {
    const [f] = parseKml(kmlDoc(`<Placemark><name>root</name>${point(1, 2)}</Placemark>`));
    expect(f.folderPath).toEqual([]);
  });

  it('records the folder name for placemarks inside a <Folder>', () => {
    const [f] = parseKml(
      kmlDoc(`<Folder><name>Camps</name><Placemark><name>c1</name>${point(1, 2)}</Placemark></Folder>`)
    );
    expect(f.folderPath).toEqual(['Camps']);
  });

  it('records nested folders outermost first', () => {
    const [f] = parseKml(
      kmlDoc(`<Folder><name>Trip</name><Folder><name>Day 1</name><Folder><name>Camps</name>
        <Placemark><name>deep</name>${point(1, 2)}</Placemark></Folder></Folder></Folder>`)
    );
    expect(f.folderPath).toEqual(['Trip', 'Day 1', 'Camps']);
  });

  it('handles sibling folders and mixed root/folder placemarks', () => {
    const parsed = parseKml(
      kmlDoc(`
        <Placemark><name>root</name>${point(0, 0)}</Placemark>
        <Folder><name>A</name><Placemark><name>a1</name>${point(1, 1)}</Placemark>
                              <Placemark><name>a2</name>${point(2, 2)}</Placemark></Folder>
        <Folder><name>B</name><Placemark><name>b1</name>${point(3, 3)}</Placemark></Folder>`)
    );
    const byName = Object.fromEntries(parsed.map((f) => [f.name, f.folderPath]));
    expect(byName).toEqual({ root: [], a1: ['A'], a2: ['A'], b1: ['B'] });
  });

  it('treats an unnamed folder as transparent (its placemarks stay at the parent path)', () => {
    const [f] = parseKml(
      kmlDoc(`<Folder><name>Outer</name><Folder><Placemark><name>x</name>${point(1, 2)}</Placemark></Folder></Folder>`)
    );
    expect(f.folderPath).toEqual(['Outer']);
  });

  it('imports placemarks from folders that contain nothing else', () => {
    expect(parseKml(kmlDoc(`<Folder><name>Empty</name></Folder>`))).toEqual([]);
  });

  it('accepts a <kml> root without a <Document>', () => {
    const parsed = parseKml(`<kml><Placemark><name>bare</name>${point(1, 2)}</Placemark></kml>`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('bare');
  });

  it('accepts a <kml> root with a Folder but no <Document>', () => {
    const [f] = parseKml(`<kml><Folder><name>F</name><Placemark>${point(1, 2)}</Placemark></Folder></kml>`);
    expect(f.folderPath).toEqual(['F']);
  });
});

describe('parseKml: geometry parsing', () => {
  it('reads points, lines and polygons', () => {
    const parsed = parseKml(
      kmlDoc(`
        <Placemark><name>p</name>${point(-116.2, 43.6)}</Placemark>
        <Placemark><name>l</name><LineString><coordinates>1,2,0 3,4,0 5,6,0</coordinates></LineString></Placemark>
        <Placemark><name>a</name><Polygon><outerBoundaryIs><LinearRing>
          <coordinates>0,0,0 1,0,0 1,1,0 0,0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`)
    );
    expect(parsed.map((f) => f.geometry)).toEqual([
      { type: 'Point', coordinates: [-116.2, 43.6] },
      { type: 'LineString', coordinates: [[1, 2], [3, 4], [5, 6]] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    ]);
  });

  it('accepts coordinates without altitude', () => {
    const [f] = parseKml(kmlDoc(`<Placemark><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>`));
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[1, 2], [3, 4]] });
  });

  it('accepts coordinates split over lines and padded with whitespace (typical Google Earth output)', () => {
    const [f] = parseKml(
      kmlDoc(`<Placemark><LineString><coordinates>
            -116.1,43.1,0
            -116.2,43.2,0
      </coordinates></LineString></Placemark>`)
    );
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[-116.1, 43.1], [-116.2, 43.2]] });
  });

  it('ignores <Style>, <StyleMap>, <ExtendedData> and <TimeStamp> siblings', () => {
    const parsed = parseKml(
      kmlDoc(`<Style id="s"><IconStyle><color>ff0000ff</color></IconStyle></Style>
        <Placemark><name>styled</name><styleUrl>#s</styleUrl>
          <ExtendedData><Data name="k"><value>v</value></Data></ExtendedData>
          <TimeStamp><when>2024-01-01</when></TimeStamp>${point(1, 2)}</Placemark>`)
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('styled');
  });

  it('keeps a CDATA description as raw text (typical of Google My Maps exports)', () => {
    const [f] = parseKml(
      kmlDoc(`<Placemark><description><![CDATA[<b>Bold</b> & <a href="x">link</a>]]></description>${point(1, 2)}</Placemark>`)
    );
    expect(f.notes).toBe('<b>Bold</b> & <a href="x">link</a>');
  });

  it('decodes the five predefined XML entities in names', () => {
    const [f] = parseKml(
      kmlDoc(`<Placemark><name>A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;</name>${point(1, 2)}</Placemark>`)
    );
    expect(f.name).toBe(`A & B <c> "d" 'e'`);
  });

  it('skips placemarks without a supported geometry (name-only, empty coordinates)', () => {
    const parsed = parseKml(
      kmlDoc(`
        <Placemark><name>no geometry</name></Placemark>
        <Placemark><name>empty coords</name><Point><coordinates></coordinates></Point></Placemark>
        <Placemark><name>ok</name>${point(1, 2)}</Placemark>`)
    );
    expect(parsed.map((f) => f.name)).toEqual(['ok']);
  });

  it('rejects lines with fewer than 2 points and rings with fewer than 4', () => {
    const parsed = parseKml(
      kmlDoc(`
        <Placemark><name>short line</name><LineString><coordinates>1,2,0</coordinates></LineString></Placemark>
        <Placemark><name>short ring</name><Polygon><outerBoundaryIs><LinearRing>
          <coordinates>0,0,0 1,0,0 0,0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`)
    );
    expect(parsed).toEqual([]);
  });

  it('drops NaN coordinate tuples but keeps the valid ones', () => {
    const [f] = parseKml(
      kmlDoc(`<Placemark><LineString><coordinates>1,2,0 abc,def,0 3,4,0</coordinates></LineString></Placemark>`)
    );
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[1, 2], [3, 4]] });
  });

  it('ignores polygon inner boundaries (holes are not imported)', () => {
    const [f] = parseKml(
      kmlDoc(`<Placemark><Polygon>
        <outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,0</coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>1,1 2,1 2,2 1,1</coordinates></LinearRing></innerBoundaryIs>
      </Polygon></Placemark>`)
    );
    expect((f.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(1);
  });

  it('does not import <MultiGeometry> placemarks (unsupported: they are skipped, not flattened)', () => {
    // Documents current behaviour. If MultiGeometry support is added, replace with real expectations.
    const parsed = parseKml(
      kmlDoc(`<Placemark><name>multi</name><MultiGeometry>${point(1, 2)}
        <LineString><coordinates>1,2 3,4</coordinates></LineString></MultiGeometry></Placemark>`)
    );
    expect(parsed).toEqual([]);
  });

  it('a placemark with both Point and LineString prefers the Point', () => {
    const [f] = parseKml(
      kmlDoc(`<Placemark>${point(9, 8)}<LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>`)
    );
    expect(f.geometry.type).toBe('Point');
  });
});

describe('parseKml: malformed input', () => {
  it('returns [] for empty, whitespace and non-XML input', () => {
    expect(parseKml('')).toEqual([]);
    expect(parseKml('   ')).toEqual([]);
    expect(parseKml('definitely not xml')).toEqual([]);
    expect(parseKml('{"type":"FeatureCollection"}')).toEqual([]);
  });

  it('returns [] when there is no <kml> root (e.g. a GPX file picked by mistake)', () => {
    expect(parseKml('<gpx><wpt lat="1" lon="2"/></gpx>')).toEqual([]);
  });

  it('returns [] for empty <kml/> and <Document/>', () => {
    expect(parseKml('<kml/>')).toEqual([]);
    expect(parseKml('<kml><Document/></kml>')).toEqual([]);
    expect(parseKml('<kml></kml>')).toEqual([]);
  });

  it('does not crash on a truncated document and recovers earlier placemarks', () => {
    const truncated = kmlDoc(`<Placemark><name>ok</name>${point(1, 2)}</Placemark><Placemark><name>cut`);
    expect(() => parseKml(truncated)).not.toThrow();
    expect(parseKml(truncated)[0].name).toBe('ok');
  });

  it('does not crash on an empty <Placemark/>', () => {
    expect(() => parseKml(kmlDoc('<Placemark/>'))).not.toThrow();
    expect(parseKml(kmlDoc('<Placemark/>'))).toEqual([]);
  });
});

describe('parseKml: known issues', () => {
  // BUG (src/data/kml.ts:54 parser options; :66 folder names, :74-75 placemark name/description):
  // the XMLParser uses fast-xml-parser's default parseTagValue: true, so a
  // <name> or <description> that looks numeric ("12", "007", "2024") becomes a
  // JS number and fails the `typeof x === 'string'` guards. Placemark names
  // silently import as null and — worse — a *folder* named e.g. "2024" is
  // treated as unnamed, so its contents are flattened into the parent folder.
  // Proposed fix: `new XMLParser({ ignoreAttributes: true, parseTagValue: false })`.
  it('keeps purely numeric placemark names and descriptions as text', () => {
    const [f] = parseKml(kmlDoc(`<Placemark><name>007</name><description>2024</description>${point(1, 2)}</Placemark>`));
    expect(f.name).toBe('007');
    expect(f.notes).toBe('2024');
  });

  it('keeps a numerically named folder as a folder level', () => {
    const [f] = parseKml(kmlDoc(`<Folder><name>2024</name><Placemark><name>x</name>${point(1, 2)}</Placemark></Folder>`));
    expect(f.folderPath).toEqual(['2024']);
  });

  // BUG (src/data/kml.ts:98-106, parseKmlCoordinates), two symptoms:
  //  (a) The same parseTagValue default turns a coordinates string that is a
  //      lone number ("-116.2") into a JS number, so `raw.trim()` throws
  //      "TypeError: raw.trim is not a function" and the whole import aborts
  //      with an unhelpful message instead of skipping the placemark.
  //  (b) A tuple with only one number ("-116.2 43.5" — lon and lat separated
  //      by a space instead of a comma) leaves lat as `undefined`, which
  //      Number.isNaN() does not flag, so the point is imported as
  //      [-116.2, undefined] (JSON: [-116.2, null]) and later breaks bbox/turf.
  // Proposed fix: parseTagValue: false (fixes a) and filter with
  // `Number.isFinite(lon) && Number.isFinite(lat)` (fixes b).
  it('does not throw on a coordinates element holding a single number', () => {
    const parsed = parseKml(kmlDoc(`<Placemark><name>bad</name><Point><coordinates>-116.2</coordinates></Point></Placemark>`));
    expect(parsed).toEqual([]);
  });

  it('rejects a coordinate tuple that has no latitude', () => {
    const parsed = parseKml(kmlDoc(`<Placemark><name>bad</name><Point><coordinates>-116.2 43.5</coordinates></Point></Placemark>`));
    expect(parsed).toEqual([]);
  });

  // Low severity: same decoding gap as GPX — numeric character references are not decoded.
  it('decodes numeric character references', () => {
    const [f] = parseKml(kmlDoc(`<Placemark><description>a&#10;b &#233;</description>${point(1, 2)}</Placemark>`));
    expect(f.notes).toBe('a\nb é');
  });
});
