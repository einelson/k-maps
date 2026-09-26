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
      color: null,
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

  it('does not export colour, so it is null on re-import, and reports null for missing names', () => {
    const [parsed] = parseGpx(featuresToGpx([makeFeature(POINT, { color: '#e11d48' })]));
    expect(parsed.color).toBeNull();
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
        color: null,
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

  it('keeps track geometry 2D even when points have elevation (elevation goes to the track samples)', () => {
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

describe('parseGpx: notes from <cmt>', () => {
  it('uses <cmt> when there is no <desc>', () => {
    const [f] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><cmt>Garmin comment</cmt></wpt>'));
    expect(f.notes).toBe('Garmin comment');
  });

  it('joins <desc> and a different <cmt>, but not identical text twice', () => {
    const [both] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><desc>Desc</desc><cmt>Cmt</cmt></wpt>'));
    expect(both.notes).toBe('Desc\n\nCmt');
    const [same] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><desc>Same</desc><cmt>Same</cmt></wpt>'));
    expect(same.notes).toBe('Same');
  });

  it('treats blank <desc>/<cmt> as no notes', () => {
    const [f] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><desc>  </desc><cmt/></wpt>'));
    expect(f.notes).toBeNull();
  });

  it('reads a name that carries an attribute', () => {
    const [f] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><name lang="en">Camp</name></wpt>'));
    expect(f.name).toBe('Camp');
  });
});

describe('parseGpx: extension colors', () => {
  it("reads Garmin's gpxx:DisplayColor on a track", () => {
    const [f] = parseGpx(
      gpxDoc(`<trk><name>T</name><extensions><gpxx:TrackExtension xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3">
        <gpxx:DisplayColor>DarkGreen</gpxx:DisplayColor></gpxx:TrackExtension></extensions>
        <trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>`)
    );
    expect(f.color).toBe('#22c55e');
  });

  it("reads OsmAnd/Organic-Maps-style <color> hex on a waypoint, alpha first", () => {
    const [f] = parseGpx(gpxDoc('<wpt lat="1" lon="2"><extensions><color>#ffff0000</color></extensions></wpt>'));
    expect(f.color).toBe('#e11d48');
  });

  it('finds a namespaced color one level down on a route', () => {
    const [f] = parseGpx(
      gpxDoc(`<rte><extensions><osmand:appearance><osmand:color>#0000ff</osmand:color></osmand:appearance></extensions>
        <rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte>`)
    );
    expect(f.color).toBe('#6366f1');
  });

  it('gives null for unknown color names, white, and extensions without a color', () => {
    const parsed = parseGpx(
      gpxDoc(`<wpt lat="1" lon="2"><extensions><color>chartreuse</color></extensions></wpt>
        <wpt lat="1" lon="2"><extensions><color>#ffffff</color></extensions></wpt>
        <wpt lat="1" lon="2"><extensions><speed>3</speed></extensions></wpt>`)
    );
    expect(parsed.map((f) => f.color)).toEqual([null, null, null]);
  });
});

describe('track samples: export', () => {
  const two = { ...LINE, coordinates: [[-116.2, 43.6], [-116.1, 43.7]] } as typeof LINE;
  const feature = (id: number) => makeFeature(two, { id, name: 'Hike', type: 'line', source: 'track' });

  it('writes <ele> and an ISO <time> for each point of a track that has samples', () => {
    const xml = featuresToGpx(
      [feature(7)],
      new Map([[7, { times: [Date.UTC(2026, 8, 24, 17, 2, 3), Date.UTC(2026, 8, 24, 17, 2, 33, 500)], elevations: [1500.5, 1512] }]])
    );
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('<trkpt lat="43.6" lon="-116.2"><ele>1500.5</ele><time>2026-09-24T17:02:03.000Z</time></trkpt>');
    expect(xml).toContain('<trkpt lat="43.7" lon="-116.1"><ele>1512</ele><time>2026-09-24T17:02:33.500Z</time></trkpt>');
  });

  it('writes only what exists: times without elevations, elevations with gaps', () => {
    const timesOnly = featuresToGpx([feature(1)], new Map([[1, { times: [0, 1000], elevations: null }]]));
    expect(timesOnly).toContain('<time>1970-01-01T00:00:00.000Z</time>');
    expect(timesOnly).not.toContain('<ele>');

    const gaps = featuresToGpx([feature(2)], new Map([[2, { times: null, elevations: [10, null] }]]));
    expect(gaps).toContain('<trkpt lat="43.6" lon="-116.2"><ele>10</ele></trkpt>');
    expect(gaps).toContain('<trkpt lat="43.7" lon="-116.1"/>');
    expect(gaps).not.toContain('<time>');
  });

  it('leaves a track bare when it has no samples, or samples for a different number of points', () => {
    const none = featuresToGpx([feature(1)]);
    expect(none).toContain('<trkpt lat="43.6" lon="-116.2"/>');
    const wrong = featuresToGpx([feature(3)], new Map([[3, { times: [0, 1, 2], elevations: [1, 2, 3] }]]));
    expect(wrong).not.toContain('<ele>');
    expect(wrong).not.toContain('<time>');
  });

  it('uses whichever half still lines up when only one does', () => {
    const xml = featuresToGpx([feature(4)], new Map([[4, { times: [0, 1000, 2000], elevations: [5, 6] }]]));
    expect(xml).toContain('<ele>5</ele>');
    expect(xml).not.toContain('<time>');
  });

  it('never attaches samples to a polygon or a waypoint', () => {
    const polygon = makeFeature(POLYGON, { id: 5, type: 'polygon' });
    const pin = makeFeature(POINT, { id: 6 });
    const samples = { times: [0, 1, 2, 3, 4], elevations: [1, 2, 3, 4, 5] };
    const xml = featuresToGpx([polygon, pin], new Map([[5, samples], [6, samples]]));
    expect(xml).not.toContain('<ele>');
    expect(xml).not.toContain('<time>');
  });

  it('round-trips through parseGpx exactly', () => {
    const samples = { times: [Date.UTC(2026, 0, 1, 12), Date.UTC(2026, 0, 1, 12, 0, 30)], elevations: [1500.5, null] };
    const [parsed] = parseGpx(featuresToGpx([feature(9)], new Map([[9, samples]])));
    expect(parsed.track).toEqual(samples);
    expect(parsed.geometry).toEqual(two);
  });
});

describe('track samples: import', () => {
  const trk = (points: string) => gpxDoc(`<trk><name>T</name><trkseg>${points}</trkseg></trk>`);

  it('reads time and elevation for every point of a track', () => {
    const [f] = parseGpx(
      trk(`<trkpt lat="1" lon="2"><ele>100.5</ele><time>2026-09-24T17:00:00Z</time></trkpt>
        <trkpt lat="3" lon="4"><ele>110</ele><time>2026-09-24T17:01:00Z</time></trkpt>`)
    );
    expect(f.track).toEqual({
      times: [Date.UTC(2026, 8, 24, 17, 0, 0), Date.UTC(2026, 8, 24, 17, 1, 0)],
      elevations: [100.5, 110],
    });
  });

  it('accepts fractional seconds and time-zone offsets', () => {
    const [f] = parseGpx(
      trk(`<trkpt lat="1" lon="2"><time>2026-09-24T17:00:00.250Z</time></trkpt>
        <trkpt lat="3" lon="4"><time>2026-09-24T11:01:00-06:00</time></trkpt>`)
    );
    expect(f.track!.times).toEqual([Date.UTC(2026, 8, 24, 17, 0, 0, 250), Date.UTC(2026, 8, 24, 17, 1, 0)]);
  });

  it('keeps elevations only when some point has no time (a partly stamped track has no duration)', () => {
    const [f] = parseGpx(
      trk(`<trkpt lat="1" lon="2"><ele>1</ele><time>2026-09-24T17:00:00Z</time></trkpt>
        <trkpt lat="3" lon="4"><ele>2</ele></trkpt>`)
    );
    expect(f.track).toEqual({ times: null, elevations: [1, 2] });
  });

  it('keeps times only when no point has an elevation', () => {
    const [f] = parseGpx(
      trk(`<trkpt lat="1" lon="2"><time>2026-09-24T17:00:00Z</time></trkpt><trkpt lat="3" lon="4"><time>2026-09-24T17:00:10Z</time></trkpt>`)
    );
    expect(f.track).toEqual({ times: [Date.UTC(2026, 8, 24, 17, 0, 0), Date.UTC(2026, 8, 24, 17, 0, 10)], elevations: null });
  });

  it('leaves gaps in elevations as null and treats junk as a gap', () => {
    const [f] = parseGpx(
      trk(`<trkpt lat="1" lon="2"><ele>5</ele></trkpt><trkpt lat="3" lon="4"/><trkpt lat="5" lon="6"><ele>abc</ele></trkpt><trkpt lat="7" lon="8"><ele> </ele></trkpt>`)
    );
    expect(f.track!.elevations).toEqual([5, null, null, null]);
  });

  it('ignores an unparseable time as missing', () => {
    const [f] = parseGpx(trk(`<trkpt lat="1" lon="2"><ele>1</ele><time>yesterday</time></trkpt><trkpt lat="3" lon="4"><ele>2</ele></trkpt>`));
    expect(f.track!.times).toBeNull();
  });

  it('drops a point with bad coordinates from the samples too, so the rest stay lined up', () => {
    const [f] = parseGpx(
      trk(`<trkpt lat="1" lon="2"><ele>10</ele></trkpt><trkpt lat="x" lon="4"><ele>999</ele></trkpt><trkpt lat="5" lon="6"><ele>30</ele></trkpt>`)
    );
    expect((f.geometry as { coordinates: number[][] }).coordinates).toEqual([[2, 1], [6, 5]]);
    expect(f.track!.elevations).toEqual([10, 30]);
  });

  it('gives no track samples when there is neither time nor elevation', () => {
    const [f] = parseGpx(trk(`<trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/>`));
    expect(f).not.toHaveProperty('track');
  });

  it('gives each segment of a multi-segment track its own samples', () => {
    const parsed = parseGpx(
      gpxDoc(`<trk><trkseg><trkpt lat="1" lon="2"><ele>1</ele></trkpt><trkpt lat="3" lon="4"><ele>2</ele></trkpt></trkseg>
        <trkseg><trkpt lat="5" lon="6"><ele>7</ele></trkpt><trkpt lat="7" lon="8"><ele>8</ele></trkpt></trkseg></trk>`)
    );
    expect(parsed.map((f) => f.track!.elevations)).toEqual([[1, 2], [7, 8]]);
  });

  it('does not attach samples to routes or waypoints', () => {
    const parsed = parseGpx(
      gpxDoc(`<wpt lat="1" lon="2"><ele>50</ele><time>2026-09-24T17:00:00Z</time></wpt>
        <rte><rtept lat="1" lon="2"><ele>1</ele></rtept><rtept lat="3" lon="4"><ele>2</ele></rtept></rte>`)
    );
    expect(parsed).toHaveLength(2);
    for (const f of parsed) expect(f).not.toHaveProperty('track');
  });
});

describe('transport (<type>)', () => {
  const trackFeature = (transport: string | null) =>
    makeFeature(LINE, { id: 3, name: 'Ride', type: 'line', source: 'track', transport });

  it('writes the mode as the track\'s <type>, after <desc> and before <trkseg> as GPX 1.1 orders them', () => {
    const xml = featuresToGpx([{ ...trackFeature('horse'), notes: 'Long day' }]);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('<name>Ride</name><desc>Long day</desc><type>horseback riding</type><trkseg>');
  });

  it('writes no <type> when the track has no mode, or for points', () => {
    expect(featuresToGpx([trackFeature(null)])).not.toContain('<type>');
    expect(featuresToGpx([makeFeature(POINT, { transport: 'foot' })])).not.toContain('<type>');
  });

  it('ignores a stored mode it does not recognise instead of writing it', () => {
    expect(featuresToGpx([trackFeature('jetpack')])).not.toContain('<type>');
  });

  it('round-trips every mode through export and import', () => {
    for (const id of ['foot', 'horse', 'bike', 'atv', 'vehicle', 'boat', 'other'] as const) {
      const [parsed] = parseGpx(featuresToGpx([trackFeature(id)]));
      expect(parsed.transport).toBe(id);
    }
  });

  it('reads <type> from third-party tracks and routes, leaving it off when it is not a known way of getting around', () => {
    const parsed = parseGpx(
      gpxDoc(
        `<trk><name>A</name><type>Hiking</type><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>` +
          `<trk><name>B</name><type>1</type><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>` +
          `<rte><name>C</name><type>cycling</type><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte>`
      )
    );
    expect(parsed.map((f) => f.transport)).toEqual(['foot', undefined, 'bike']);
    expect(parsed[1]).not.toHaveProperty('transport');
  });
});
