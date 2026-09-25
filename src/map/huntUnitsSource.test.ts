import { huntUnitDisclaimer, IDAHO_HUNT_STATE, IDAHO_UNITS_DATA, IDAHO_UNITS_META } from './huntUnitsSource';

describe('bundled Idaho hunt units', () => {
  const features = IDAHO_UNITS_DATA.features;

  it('is a statewide set of polygons whose count matches the meta', () => {
    expect(features.length).toBe(IDAHO_UNITS_META.featureCount);
    expect(IDAHO_HUNT_STATE.sets).toEqual([
      { id: 'gmu', label: 'Game Management Units', count: features.length, updated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    ]);
    expect(IDAHO_HUNT_STATE.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // the card says when the units were downloaded
    expect(features.length).toBeGreaterThanOrEqual(90);
    for (const f of features) expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
  });

  it('uses the same normalized properties as every downloadable state', () => {
    for (const f of features) {
      expect(Object.keys(f.properties).sort()).toEqual(['note', 'set', 'title', 'unit', 'url', 'url2', 'url2Label', 'urlLabel']);
      expect(f.properties.set).toBe('gmu');
    }
  });

  it('has a unique unit code on every feature (39, 60A, ...), titled "Unit <code>"', () => {
    const codes = features.map((f) => f.properties.unit);
    expect(new Set(codes).size).toBe(codes.length);
    const real = features.filter((f) => f.properties.unit !== 'YNP');
    for (const f of real) {
      expect(f.properties.unit).toMatch(/^\d+[A-Z]?$/);
      expect(f.properties.title).toBe(`Unit ${f.properties.unit}`);
    }
    expect(real.length).toBeGreaterThanOrEqual(90);
  });

  it('does not call Yellowstone a hunt unit: it is titled by name', () => {
    const park = features.filter((f) => f.properties.unit === 'YNP');
    expect(park).toHaveLength(1);
    expect(park[0].properties.title).toBe('Yellowstone National Park');
    expect(park[0].properties.note).toBeNull();
    expect(park[0].properties.url).toBeNull();
  });

  it('lies within Idaho (and so is real data, not an empty or mis-projected file), and the meta box says so', () => {
    const coords: number[][] = [];
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') coords.push(c as number[]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    for (const f of features) walk((f.geometry as { coordinates: unknown }).coordinates);
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    expect(Math.min(...lons)).toBeGreaterThan(-117.5);
    expect(Math.max(...lons)).toBeLessThan(-110.5);
    expect(Math.min(...lats)).toBeGreaterThan(41.5);
    expect(Math.max(...lats)).toBeLessThan(49.5);
    const [w, s, e, n] = IDAHO_HUNT_STATE.bbox;
    expect(w).toBeLessThanOrEqual(Math.min(...lons));
    expect(e).toBeGreaterThanOrEqual(Math.max(...lons));
    expect(s).toBeLessThanOrEqual(Math.min(...lats));
    expect(n).toBeGreaterThanOrEqual(Math.max(...lats));
  });

  it('only links to https URLs (they are opened in the phone\'s browser)', () => {
    for (const f of features) {
      for (const url of [f.properties.url, f.properties.url2]) {
        if (url !== null) expect(url).toMatch(/^https:\/\/idfg\.idaho\.gov\//);
      }
      // A link always has a button label, and a label never appears without its link.
      expect(f.properties.url === null).toBe(f.properties.urlLabel === null);
      expect(f.properties.url2 === null).toBe(f.properties.url2Label === null);
    }
  });

  it('names the agency and defers to the regulations', () => {
    expect(huntUnitDisclaimer('Idaho')).toMatch(/Idaho hunting regulations/i);
    expect(IDAHO_UNITS_META.note).toMatch(/regulation booklet/i);
    expect(IDAHO_HUNT_STATE.agency).toMatch(/Idaho Department of Fish and Game/);
    expect(IDAHO_HUNT_STATE.regsUrl).toMatch(/^https:\/\/idfg\.idaho\.gov\//);
  });
});
