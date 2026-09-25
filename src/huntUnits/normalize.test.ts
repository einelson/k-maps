import type { Feature, Polygon } from 'geojson';

import { boundsOf, dissolveBy, hrefOf, httpUrl, joinTitle, normalizeSet, text, titleCase } from './normalize.ts';
import type { HuntSetConfig } from './types.ts';

const square = (x: number, y: number, size = 1): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
});
const feature = (geometry: any, properties: Record<string, any> | null = {}): Feature<any, any> => ({ type: 'Feature', geometry, properties });

const SET: HuntSetConfig = {
  id: 'deer',
  label: 'Deer Units',
  noun: 'Deer Unit',
  layer: 'https://example.test/rest/services/x/FeatureServer/0',
  map: (a) => (a.u ? { unit: String(a.u) } : null),
  example: { attributes: { u: 1 }, unit: '1', title: 'Deer Unit 1' },
};

describe('text helpers', () => {
  it('text trims and empties null/undefined', () => {
    expect(text('  a ')).toBe('a');
    expect(text(null)).toBe('');
    expect(text(undefined)).toBe('');
    expect(text(0)).toBe('0');
  });

  it('titleCase fixes shouting agency names without breaking numerals', () => {
    expect(titleCase('FLATHEAD INDIAN RESERVATION')).toBe('Flathead Indian Reservation');
    expect(titleCase('CHETCO')).toBe('Chetco');
    expect(titleCase('SNAKE RIVER-BOISE')).toBe('Snake River-Boise');
    expect(titleCase('BLOCK II')).toBe('Block II');
    expect(titleCase('')).toBe('');
  });

  it('httpUrl accepts only real links, not the prose some columns hold', () => {
    expect(httpUrl('https://a.b/c')).toBe('https://a.b/c');
    expect(httpUrl('  http://a.b ')).toBe('http://a.b');
    expect(httpUrl('Hunting not allowed in this area')).toBeNull();
    expect(httpUrl('javascript:alert(1)')).toBeNull();
    expect(httpUrl(null)).toBeNull();
  });

  it('hrefOf pulls the link out of an HTML anchor', () => {
    expect(hrefOf(`<a href="https://x.test/1" target="_top">Unit 1</a>`)).toBe('https://x.test/1');
    expect(hrefOf(`<a HREF='https://x.test/2'>x</a>`)).toBe('https://x.test/2');
    expect(hrefOf('no link')).toBeNull();
    expect(hrefOf(`<a href="mailto:a@b.c">x</a>`)).toBeNull();
  });

  it('joinTitle skips empty parts', () => {
    expect(joinTitle('Unit 27', 'Chetco')).toBe('Unit 27 – Chetco');
    expect(joinTitle('Unit 27', '', null, undefined)).toBe('Unit 27');
    expect(joinTitle()).toBe('');
  });
});

describe('normalizeSet', () => {
  it('keeps only the normalized properties and fills the default title', () => {
    const [out] = normalizeSet(SET, [feature(square(0, 0), { u: 7, secret: 'x', OBJECTID: 3 })]);
    expect(out.properties).toEqual({
      set: 'deer',
      unit: '7',
      title: 'Deer Unit 7',
      note: null,
      url: null,
      urlLabel: null,
      url2: null,
      url2Label: null,
    });
  });

  it('drops features the mapping rejects, and anything that is not a polygon', () => {
    const out = normalizeSet(SET, [
      feature(square(0, 0), { u: 1 }),
      feature(square(2, 2), {}),
      feature({ type: 'Point', coordinates: [0, 0] }, { u: 2 }),
      feature(null, { u: 3 }),
    ]);
    expect(out.map((f) => f.properties.unit)).toEqual(['1']);
  });

  it('labels links, defaulting the button text when a mapping gave a link but no label', () => {
    const set: HuntSetConfig = { ...SET, map: () => ({ unit: '1', url: 'https://a.test', url2: 'https://b.test', url2Label: 'Second' }) };
    const [out] = normalizeSet(set, [feature(square(0, 0))]);
    expect(out.properties).toMatchObject({ url: 'https://a.test', urlLabel: 'More information', url2: 'https://b.test', url2Label: 'Second' });
  });

  it('accepts MultiPolygons', () => {
    const multi = { type: 'MultiPolygon', coordinates: [square(0, 0).coordinates, square(5, 5).coordinates] };
    expect(normalizeSet(SET, [feature(multi, { u: 1 })])).toHaveLength(1);
  });
});

describe('dissolveBy', () => {
  it('merges the polygons sharing a value into one feature per value', () => {
    const merged = dissolveBy(
      [feature(square(0, 0), { z: 1 }), feature(square(1, 0), { z: 1 }), feature(square(5, 5), { z: 2 })],
      'z'
    );
    expect(merged).toHaveLength(2);
    const zoneOne = merged.find((f) => f.properties?.z === 1)!;
    // two adjacent unit squares fuse into a single 2 x 1 polygon
    expect(zoneOne.geometry.type).toBe('Polygon');
    const xs = (zoneOne.geometry as Polygon).coordinates[0].map(([x]) => x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(2);
  });

  it('keeps disjoint pieces of one zone together as a MultiPolygon', () => {
    const [zone] = dissolveBy([feature(square(0, 0), { z: 1 }), feature(square(10, 10), { z: 1 })], 'z');
    expect(zone.geometry.type).toBe('MultiPolygon');
  });

  it('a set with dissolveBy runs it before mapping', () => {
    const set: HuntSetConfig = { ...SET, dissolveBy: 'u' };
    const out = normalizeSet(set, [feature(square(0, 0), { u: 1 }), feature(square(1, 0), { u: 1 }), feature(square(5, 5), { u: 2 })]);
    expect(out.map((f) => f.properties.unit).sort()).toEqual(['1', '2']);
  });
});

describe('boundsOf', () => {
  it('is the outer box of all features, rounded outward', () => {
    const features = normalizeSet(SET, [feature(square(-116.126, 43.501), { u: 1 }), feature(square(-115, 44), { u: 2 })]);
    const [w, s, e, n] = boundsOf(features);
    expect(w).toBeLessThanOrEqual(-116.126);
    expect(s).toBeLessThanOrEqual(43.501);
    expect(e).toBeGreaterThanOrEqual(-114);
    expect(n).toBeGreaterThanOrEqual(45);
    expect(w).toBe(-116.13);
  });
});

describe('boundsOf across the antimeridian', () => {
  it('keeps an Alaska-style set (Aleutians on both sides of 180°) as one continuous box west of -180', () => {
    const features = normalizeSet(SET, [
      feature(square(-150, 60, 5), { u: 1 }), // mainland
      feature(square(172, 52, 2), { u: 2 }), // western Aleutians, east longitude
      feature(square(-179.5, 51.5, 1), { u: 3 }), // just across the line
    ]);
    const [w, s, e, n] = boundsOf(features);
    expect(w).toBe(-188); // 172° east is 188° west
    expect(e).toBe(-145); // mainland's east edge
    expect(s).toBe(51.5);
    expect(n).toBe(65);
    expect(w).toBeLessThan(e); // still a valid box for the manifest check
  });

  it('leaves a normal state alone', () => {
    const features = normalizeSet(SET, [feature(square(-116, 43, 2), { u: 1 }), feature(square(-113, 44, 1), { u: 2 })]);
    expect(boundsOf(features)).toEqual([-116, 43, -112, 45]);
  });

  it('handles a very large feature set (hundreds of thousands of positions) without blowing the stack', () => {
    const ring: number[][] = [];
    for (let i = 0; i < 300_000; i++) ring.push([-110 + (i % 1000) / 1000, 44 + Math.floor(i / 1000) / 1000]);
    ring.push(ring[0]);
    const big = normalizeSet(SET, [feature({ type: 'Polygon', coordinates: [ring] }, { u: 1 })]);
    expect(boundsOf(big)).toEqual([-110, 44, -109, 44.3]);
  });
});
