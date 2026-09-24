import { HUNT_UNIT_DISCLAIMER, HUNT_UNITS_DATA, HUNT_UNITS_META } from './huntUnitsSource';

describe('bundled Idaho hunt units', () => {
  const features = HUNT_UNITS_DATA.features;

  it('is a statewide set of polygons whose count matches the meta', () => {
    expect(features.length).toBe(HUNT_UNITS_META.featureCount);
    expect(features.length).toBeGreaterThanOrEqual(90);
    for (const f of features) expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
  });

  it('has a unique unit code on every feature (39, 60A, ...), and a display label to match', () => {
    const codes = features.map((f) => f.properties.unit);
    expect(new Set(codes).size).toBe(codes.length);
    for (const f of features.filter((x) => x.properties.isUnit)) {
      expect(f.properties.unit).toMatch(/^\d+[A-Z]?$/);
      expect(f.properties.label).toBe(`Unit ${f.properties.unit}`);
    }
    expect(features.filter((f) => f.properties.isUnit).length).toBeGreaterThanOrEqual(90);
  });

  it('does not call Yellowstone a hunt unit: it is labelled by name and flagged', () => {
    const notUnits = features.filter((f) => !f.properties.isUnit);
    expect(notUnits.map((f) => f.properties.unit)).toEqual(['YNP']);
    expect(notUnits[0].properties.label).toBe('Yellowstone National Park');
    expect(notUnits[0].properties.elkZone).toBeNull();
  });

  it('lies within Idaho (and so is real data, not an empty or mis-projected file)', () => {
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
  });

  it('only links to https URLs (they are opened in the phone\'s browser)', () => {
    for (const f of features) {
      for (const url of [f.properties.deerUrl, f.properties.elkUrl]) {
        if (url !== null) expect(url).toMatch(/^https:\/\/idfg\.idaho\.gov\//);
      }
    }
  });

  it('carries IDFG\'s caveat: the regulation booklet is the authority', () => {
    expect(HUNT_UNIT_DISCLAIMER).toMatch(/regulation booklet/i);
    expect(HUNT_UNITS_META.note).toMatch(/regulation booklet/i);
    expect(HUNT_UNITS_META.source).toMatch(/Idaho/);
  });
});
