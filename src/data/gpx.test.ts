import { XMLValidator } from 'fast-xml-parser';

import { LINE, POINT, POLYGON, makeFeature } from '../testing/featureFixtures';
import { featuresToGpx, parseGpx } from './gpx';

const gpxDoc = (body: string) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

describe('featuresToGpx', () => {
  it('produces a well-formed GPX 1.1 document', () => {
    const xml = featuresToGpx([
      makeFeature(POINT, { name: 'A & B <c>', notes: `"quoted" 'apos'` }),
      makeFeature(LINE, { name: 'Trail' }),
      makeFeature(POLYGON, { name: 'Area' }),
    ]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<gpx version="1.1" creator="K-Maps" xmlns="http://www.topografix.com/GPX/1/1">');
    expect(xml.trimEnd().endsWith('</gpx>')).toBe(true);
  });

  it('exports an empty list as an empty (but valid) document that parses to nothing', () => {
    const xml = featuresToGpx([]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(parseGpx(xml)).toEqual([]);
  });

  it('writes points as <wpt lat lon> with lat before lon and lon/lat swapped from GeoJSON order', () => {
    const xml = featuresToGpx([makeFeature({ type: 'Point', coordinates: [-116.5, 43.25] })]);
    expect(xml).toContain('<wpt lat="43.25" lon="-116.5">');
  });

  it('escapes special characters in names and notes', () => {
    const xml = featuresToGpx([makeFeature(POINT, { name: 'A & B <c> "d"', notes: `x'y` })]);
    expect(xml).toContain('<name>A &amp; B &lt;c&gt; &quot;d&quot;</name>');
    expect(xml).toContain('<desc>x&apos;y</desc>');
  });

  it('omits <name>/<desc> when the feature has none', () => {
    const xml = featuresToGpx([makeFeature(POINT)]);
    expect(xml).not.toContain('<name>');
    expect(xml).not.toContain('<desc>');
  });

  it('writes lines as a <trk> with a single <trkseg>', () => {
    const xml = featuresToGpx([makeFeature(LINE, { name: 'Trail' })]);
    expect(xml.match(/<trk>/g)).toHaveLength(1);
    expect(xml.match(/<trkseg>/g)).toHaveLength(1);
    expect(xml.match(/<trkpt /g)).toHaveLength(3);
  });

  it('writes polygons as a closed track of the outer ring only (GPX has no area primitive)', () => {
    const withHole = makeFeature({
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]],
      ],
    });
    const xml = featuresToGpx([withHole]);
    expect(xml.match(/<trkpt /g)).toHaveLength(5);
    expect(xml).not.toContain('lat="3" lon="3"'); // hole vertices are dropped
  });

  it('silently skips geometries GPX cannot carry (Multi*), without throwing', () => {
    // Documents current behaviour: multi-part geometries are dropped on GPX export.
    const xml = featuresToGpx([
      makeFeature({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }),
      makeFeature({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] }),
      makeFeature(POINT, { name: 'kept' }),
    ]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(parseGpx(xml).map((f) => f.name)).toEqual(['kept']);
  });

  it('does not export colours (GPX 1.1 core has no colour field)', () => {
    const xml = featuresToGpx([makeFeature(POINT, { name: 'Red', color: '#e11d48' })]);
    expect(xml).not.toContain('e11d48');
  });
});

describe('GPX export -> import round trip', () => {
  it('preserves waypoint name, notes and coordinates', () => {
    const [parsed] = parseGpx(
      featuresToGpx([makeFeature(POINT, { name: 'Camp', notes: 'Flat spot near the creek' })])
    );
    expect(parsed).toEqual({
      name: 'Camp',
      notes: 'Flat spot near the creek',
      geometry: POINT,
      folderPath: [],
    });
  });

  it('preserves track name, notes and every vertex in order', () => {
    const [parsed] = parseGpx(featuresToGpx([makeFeature(LINE, { name: 'Ridge', notes: '5 mi' })]));
    expect(parsed.name).toBe('Ridge');
    expect(parsed.notes).toBe('5 mi');
    expect(parsed.geometry).toEqual(LINE);
  });

  it('turns a polygon into a closed LineString of its outer ring (documented GPX limitation)', () => {
    const [parsed] = parseGpx(featuresToGpx([makeFeature(POLYGON, { name: 'Unit 12' })]));
    expect(parsed.name).toBe('Unit 12');
    expect(parsed.geometry.type).toBe('LineString');
    const coords = (parsed.geometry as { coordinates: number[][] }).coordinates;
    expect(coords).toEqual((POLYGON as { coordinates: number[][][] }).coordinates[0]);
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  it('round-trips special characters in names and notes', () => {
    const name = `A & B <c> "d" 'e'`;
    const notes = 'first line\nsecond line & <b>bold</b>';
    const [parsed] = parseGpx(featuresToGpx([makeFeature(POINT, { name, notes })]));
    expect(parsed.name).toBe(name);
    expect(parsed.notes).toBe(notes);
  });

  it('round-trips unicode', () => {
    const [parsed] = parseGpx(featuresToGpx([makeFeature(POINT, { name: 'Café ⛺ 山' })]));
    expect(parsed.name).toBe('Café ⛺ 山');
  });

  it('round-trips full-precision and negative coordinates exactly', () => {
    const geometry = { type: 'Point' as const, coordinates: [-116.123456789012, -43.987654321098] };
    const [parsed] = parseGpx(featuresToGpx([makeFeature(geometry)]));
    expect(parsed.geometry).toEqual(geometry);
  });

  it('returns waypoints before tracks, keeping each group in input order', () => {
    const parsed = parseGpx(
      featuresToGpx([
        makeFeature(LINE, { name: 'track1' }),
        makeFeature(POINT, { name: 'wpt1' }),
        makeFeature(LINE, { name: 'track2' }),
        makeFeature(POINT, { name: 'wpt2' }),
      ])
    );
    expect(parsed.map((f) => f.name)).toEqual(['wpt1', 'wpt2', 'track1', 'track2']);
  });

  it('loses colour on the round trip and reports null for missing names', () => {
    const [parsed] = parseGpx(featuresToGpx([makeFeature(POINT, { color: '#e11d48' })]));
    expect(parsed).not.toHaveProperty('color');
    expect(parsed.name).toBeNull();
    expect(parsed.notes).toBeNull();
  });
});

describe('parseGpx: importing third-party files', () => {
  it('reads a single waypoint (parser yields an object, not an array)', () => {
    const parsed = parseGpx(gpxDoc('<wpt lat="43.6" lon="-116.2"><name>Solo</name></wpt>'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].geometry).toEqual({ type: 'Point', coordinates: [-116.2, 43.6] });
  });

  it('reads multiple waypoints', () => {
    const parsed = parseGpx(
      gpxDoc(`
        <wpt lat="1" lon="2"><name>a</name></wpt>
        <wpt lat="3" lon="4"><name>b</name></wpt>
        <wpt lat="5" lon="6"><name>c</name></wpt>`)
    );
    expect(parsed.map((f) => f.name)).toEqual(['a', 'b', 'c']);
  });

  it('ignores extra waypoint children (ele, time, sym, extensions) and keeps lon/lat', () => {
    const parsed = parseGpx(
      gpxDoc(`<wpt lat="43.6" lon="-116.2"><ele>820.5</ele><time>2024-01-01T00:00:00Z</time><name>P</name>
        <sym>Flag</sym><extensions><foo>bar</foo></extensions></wpt>`)
    );
    expect(parsed[0].geometry).toEqual({ type: 'Point', coordinates: [-116.2, 43.6] });
    expect(parsed[0].name).toBe('P');
  });

  it('imports routes (<rte>/<rtept>) as LineStrings', () => {
    const parsed = parseGpx(
      gpxDoc(`<rte><name>Route 1</name><desc>via the pass</desc>
        <rtept lat="1" lon="2"/><rtept lat="3" lon="4"/><rtept lat="5" lon="6"/></rte>`)
    );
    expect(parsed).toEqual([
      {
        name: 'Route 1',
        notes: 'via the pass',
        geometry: { type: 'LineString', coordinates: [[2, 1], [4, 3], [6, 5]] },
        folderPath: [],
      },
    ]);
  });

  it('imports every <trkseg> of a track as its own LineString sharing the track name', () => {
    const parsed = parseGpx(
      gpxDoc(`<trk><name>Multi</name>
        <trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg>
        <trkseg><trkpt lat="3" lon="3"/><trkpt lat="4" lon="4"/></trkseg></trk>`)
    );
    expect(parsed).toHaveLength(2);
    expect(parsed.map((f) => f.name)).toEqual(['Multi', 'Multi']);
    expect(parsed[0].geometry).toEqual({ type: 'LineString', coordinates: [[1, 1], [2, 2]] });
    expect(parsed[1].geometry).toEqual({ type: 'LineString', coordinates: [[3, 3], [4, 4]] });
  });

  it('imports waypoints, routes and tracks from one file (waypoints, then tracks, then routes)', () => {
    const parsed = parseGpx(
      gpxDoc(`
        <rte><name>R</name><rtept lat="1" lon="1"/><rtept lat="2" lon="2"/></rte>
        <trk><name>T</name><trkseg><trkpt lat="3" lon="3"/><trkpt lat="4" lon="4"/></trkseg></trk>
        <wpt lat="5" lon="5"><name>W</name></wpt>`)
    );
    expect(parsed.map((f) => f.geometry.type)).toEqual(['Point', 'LineString', 'LineString']);
    expect(parsed.map((f) => f.name)).toEqual(['W', 'T', 'R']);
  });

  it('drops track segments and routes with fewer than 2 valid points', () => {
    const parsed = parseGpx(
      gpxDoc(`
        <trk><name>one point</name><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>
        <trk><name>empty</name><trkseg></trkseg></trk>
        <rte><name>short</name><rtept lat="1" lon="1"/></rte>
        <trk><name>ok</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>`)
    );
    expect(parsed.map((f) => f.name)).toEqual(['ok']);
  });

  it('skips points with missing or non-numeric coordinates instead of failing the file', () => {
    const parsed = parseGpx(
      gpxDoc(`
        <wpt lat="abc" lon="2"><name>bad lat</name></wpt>
        <wpt lon="2"><name>no lat</name></wpt>
        <wpt lat="1"><name>no lon</name></wpt>
        <wpt lat="1" lon="2"><name>good</name></wpt>
        <trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="x" lon="y"/><trkpt lat="2" lon="2"/></trkseg></trk>`)
    );
    expect(parsed.map((f) => f.geometry.type)).toEqual(['Point', 'LineString']);
    expect(parsed[0].name).toBe('good');
    expect((parsed[1].geometry as { coordinates: number[][] }).coordinates).toEqual([[1, 1], [2, 2]]);
  });

  it('keeps names and descriptions when the tags have surrounding whitespace/newlines (trimmed)', () => {
    const parsed = parseGpx(
      gpxDoc(`<wpt lat="1" lon="2"><name>
        Padded
      </name><desc>  note  </desc></wpt>`)
    );
    expect(parsed[0].name).toBe('Padded');
    expect(parsed[0].notes).toBe('note');
  });

  it('decodes the five predefined XML entities', () => {
    const parsed = parseGpx(
      gpxDoc(`<wpt lat="1" lon="2"><name>A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;</name></wpt>`)
    );
    expect(parsed[0].name).toBe(`A & B <c> "d" 'e'`);
  });

  it('accepts CDATA in descriptions', () => {
    const parsed = parseGpx(
      gpxDoc(`<wpt lat="1" lon="2"><desc><![CDATA[<b>bold</b> & more]]></desc></wpt>`)
    );
    expect(parsed[0].notes).toBe('<b>bold</b> & more');
  });

  it('accepts a <gpx> root without an xmlns declaration', () => {
    const parsed = parseGpx(
      `<gpx><wpt lat="1" lon="2"><name>plain</name></wpt></gpx>`
    );
    expect(parsed).toHaveLength(1);
  });

  it('parses a 3D coordinate track into 2D positions (elevation is not imported)', () => {
    const parsed = parseGpx(
      gpxDoc(`<trk><trkseg><trkpt lat="1" lon="2"><ele>100</ele></trkpt><trkpt lat="3" lon="4"><ele>200</ele></trkpt></trkseg></trk>`)
    );
    expect((parsed[0].geometry as { coordinates: number[][] }).coordinates).toEqual([[2, 1], [4, 3]]);
  });
});

describe('parseGpx: malformed input', () => {
  it('returns [] for empty and whitespace-only input', () => {
    expect(parseGpx('')).toEqual([]);
    expect(parseGpx('   \n  ')).toEqual([]);
  });

  it('returns [] for non-XML text', () => {
    expect(parseGpx('this is not xml')).toEqual([]);
    expect(parseGpx('{"type":"FeatureCollection","features":[]}')).toEqual([]);
  });

  it('returns [] when there is no <gpx> root (e.g. a KML file picked by mistake)', () => {
    expect(parseGpx('<kml><Document><Placemark/></Document></kml>')).toEqual([]);
  });

  it('returns [] for an empty <gpx/> element', () => {
    expect(parseGpx('<gpx/>')).toEqual([]);
    expect(parseGpx('<gpx></gpx>')).toEqual([]);
    expect(parseGpx('<gpx version="1.1"></gpx>')).toEqual([]);
  });

  it('does not crash on a truncated document and recovers what it can', () => {
    const truncated = gpxDoc('<wpt lat="1" lon="2"><name>ok</name></wpt><wpt lat="3" lon="4"><name>cut');
    expect(() => parseGpx(truncated)).not.toThrow();
    expect(parseGpx(truncated)[0].name).toBe('ok');
  });

  it('does not crash on unrelated elements or empty waypoint elements', () => {
    expect(() => parseGpx(gpxDoc('<metadata><name>file</name></metadata><wpt/>'))).not.toThrow();
    expect(parseGpx(gpxDoc('<metadata><name>file</name></metadata><wpt/>'))).toEqual([]);
  });

  it('does not treat a <metadata><name> as a feature name', () => {
    const parsed = parseGpx(gpxDoc('<metadata><name>File title</name></metadata><wpt lat="1" lon="2"/>'));
    expect(parsed[0].name).toBeNull();
  });
});

describe('parseGpx: known issues', () => {
  // BUG (src/data/gpx.ts:46 parser options; :58-59, :70-71, :82-83 guards): new XMLParser({...}) is created
  // with fast-xml-parser's default parseTagValue: true, so a <name> or <desc>
  // that looks like a number ("7", "007", "1.5", "2024") is parsed to a JS
  // *number*; the `typeof wpt.name === 'string'` guards then reject it and the
  // name is silently imported as null. Numbered waypoints ("001", "42") are
  // very common in GPS exports. "007" also loses its leading zeros.
  // Proposed fix: add `parseTagValue: false` to the XMLParser options (all
  // text stays a string; lat/lon are attributes and are already strings).
  it('keeps purely numeric waypoint names and descriptions as text', () => {
    const [wpt] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><name>007</name><desc>2024</desc></wpt>'));
    expect(wpt.name).toBe('007');
    expect(wpt.notes).toBe('2024');
  });

  it('keeps purely numeric track and route names', () => {
    const parsed = parseGpx(
      gpxDoc(`<trk><name>12</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>
              <rte><name>3.5</name><rtept lat="1" lon="1"/><rtept lat="2" lon="2"/></rte>`)
    );
    expect(parsed.map((f) => f.name)).toEqual(['12', '3.5']);
  });

  // Low severity: numeric character references (&#10; &#xD; &#233;) are valid
  // XML but the default parser leaves them undecoded, so a description
  // exported by another tool with "&#10;" line breaks imports as literal text.
  // Proposed fix: enable entity decoding (`htmlEntities: true`) in the XMLParser options.
  it('decodes numeric character references', () => {
    const [wpt] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><desc>a&#10;b &#233;</desc></wpt>'));
    expect(wpt.notes).toBe('a\nb é');
  });
});
