import type { Geometry } from 'geojson';

import { computeGeometryMetrics, geometryTypeToFeatureType } from './measure';

// turf measures on a sphere, so 1° along the equator (or any meridian) is R * pi/180.
const METERS_PER_DEGREE_TURF = (6371008.8 * Math.PI) / 180; // ~111195.08

describe('geometryTypeToFeatureType', () => {
  it('maps points and multipoints to "point"', () => {
    expect(geometryTypeToFeatureType({ type: 'Point', coordinates: [0, 0] })).toBe('point');
    expect(geometryTypeToFeatureType({ type: 'MultiPoint', coordinates: [[0, 0]] })).toBe('point');
  });

  it('maps lines and multilines to "line"', () => {
    expect(
      geometryTypeToFeatureType({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })
    ).toBe('line');
    expect(
      geometryTypeToFeatureType({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] })
    ).toBe('line');
  });

  it('maps polygons and multipolygons to "polygon"', () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(geometryTypeToFeatureType({ type: 'Polygon', coordinates: [ring] })).toBe('polygon');
    expect(geometryTypeToFeatureType({ type: 'MultiPolygon', coordinates: [[ring]] })).toBe('polygon');
  });

  it('throws for GeometryCollection (not storable as a single feature type)', () => {
    expect(() =>
      geometryTypeToFeatureType({ type: 'GeometryCollection', geometries: [] })
    ).toThrow('Unsupported geometry type: GeometryCollection');
  });
});

describe('computeGeometryMetrics: points', () => {
  it('returns a degenerate bbox and no length/area', () => {
    const m = computeGeometryMetrics({ type: 'Point', coordinates: [-116.2, 43.6] });
    expect(m).toEqual({
      minLon: -116.2,
      minLat: 43.6,
      maxLon: -116.2,
      maxLat: 43.6,
      lengthM: null,
      areaM2: null,
    });
  });

  it('a MultiPoint gets the bbox of all its points and still no length/area', () => {
    const m = computeGeometryMetrics({
      type: 'MultiPoint',
      coordinates: [[-116, 43], [-115, 44], [-117, 42.5]],
    });
    expect([m.minLon, m.minLat, m.maxLon, m.maxLat]).toEqual([-117, 42.5, -115, 44]);
    expect(m.lengthM).toBeNull();
    expect(m.areaM2).toBeNull();
  });
});

describe('computeGeometryMetrics: lines', () => {
  it('measures 1° of longitude on the equator in metres', () => {
    const m = computeGeometryMetrics({ type: 'LineString', coordinates: [[0, 0], [1, 0]] });
    expect(m.lengthM).toBeCloseTo(METERS_PER_DEGREE_TURF, 1);
    expect(m.areaM2).toBeNull();
  });

  it('measures along a meridian', () => {
    const m = computeGeometryMetrics({ type: 'LineString', coordinates: [[10, 20], [10, 21]] });
    expect(m.lengthM).toBeCloseTo(METERS_PER_DEGREE_TURF, 0);
  });

  it('a degree of longitude is shorter at higher latitudes (cos(lat) scaling)', () => {
    const equator = computeGeometryMetrics({ type: 'LineString', coordinates: [[0, 0], [1, 0]] });
    const idaho = computeGeometryMetrics({ type: 'LineString', coordinates: [[-116, 45], [-115, 45]] });
    expect(idaho.lengthM! / equator.lengthM!).toBeCloseTo(Math.cos((45 * Math.PI) / 180), 3);
  });

  it('sums the segments of a multi-vertex line', () => {
    const m = computeGeometryMetrics({
      type: 'LineString',
      coordinates: [[0, 0], [1, 0], [1, 1]],
    });
    expect(m.lengthM).toBeCloseTo(2 * METERS_PER_DEGREE_TURF, 0);
  });

  it('is symmetric under reversal', () => {
    const forward = computeGeometryMetrics({
      type: 'LineString',
      coordinates: [[-116.2, 43.6], [-116.1, 43.7], [-115.9, 43.65]],
    });
    const backward = computeGeometryMetrics({
      type: 'LineString',
      coordinates: [[-115.9, 43.65], [-116.1, 43.7], [-116.2, 43.6]],
    });
    expect(forward.lengthM).toBeCloseTo(backward.lengthM!, 6);
  });

  it('a zero-length line (identical vertices) measures 0, not null', () => {
    const m = computeGeometryMetrics({ type: 'LineString', coordinates: [[5, 5], [5, 5]] });
    expect(m.lengthM).toBe(0);
  });

  it('adds up every part of a MultiLineString', () => {
    const m = computeGeometryMetrics({
      type: 'MultiLineString',
      coordinates: [
        [[0, 0], [1, 0]],
        [[10, 10], [10, 11]],
      ],
    });
    expect(m.lengthM).toBeCloseTo(2 * METERS_PER_DEGREE_TURF, 0);
    expect(m.areaM2).toBeNull();
    expect([m.minLon, m.minLat, m.maxLon, m.maxLat]).toEqual([0, 0, 10, 11]);
  });

  it('bbox is [minLon, minLat, maxLon, maxLat] regardless of vertex order', () => {
    const m = computeGeometryMetrics({
      type: 'LineString',
      coordinates: [[-115, 44], [-117, 43], [-116, 45]],
    });
    expect(m.minLon).toBe(-117);
    expect(m.minLat).toBe(43);
    expect(m.maxLon).toBe(-115);
    expect(m.maxLat).toBe(45);
  });
});

describe('computeGeometryMetrics: polygons', () => {
  const unitSquare: Geometry = {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };

  it('returns area in square metres and no length', () => {
    const m = computeGeometryMetrics(unitSquare);
    expect(m.lengthM).toBeNull();
    // ~1° x 1° at the equator: (111.3 km)^2 = 1.239e10 m^2 (turf area uses the WGS84 equatorial radius).
    expect(m.areaM2).toBeGreaterThan(1.235e10);
    expect(m.areaM2).toBeLessThan(1.245e10);
    expect([m.minLon, m.minLat, m.maxLon, m.maxLat]).toEqual([0, 0, 1, 1]);
  });

  it('area shrinks with latitude', () => {
    const idahoSquare = computeGeometryMetrics({
      type: 'Polygon',
      coordinates: [[[-116, 45], [-115, 45], [-115, 46], [-116, 46], [-116, 45]]],
    });
    const equator = computeGeometryMetrics(unitSquare);
    expect(idahoSquare.areaM2!).toBeLessThan(equator.areaM2!);
    // cos(45.5°) ~ 0.70
    expect(idahoSquare.areaM2! / equator.areaM2!).toBeCloseTo(Math.cos((45.5 * Math.PI) / 180), 2);
  });

  it('is independent of ring winding order', () => {
    const cw = computeGeometryMetrics({
      type: 'Polygon',
      coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
    });
    expect(cw.areaM2).toBeCloseTo(computeGeometryMetrics(unitSquare).areaM2!, 3);
    expect(cw.areaM2!).toBeGreaterThan(0);
  });

  it('subtracts holes', () => {
    const hole = computeGeometryMetrics({
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]],
      ],
    });
    const solid = computeGeometryMetrics({
      type: 'Polygon',
      coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
    });
    const holeOnly = computeGeometryMetrics({
      type: 'Polygon',
      coordinates: [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]],
    });
    expect(hole.areaM2).toBeCloseTo(solid.areaM2! - holeOnly.areaM2!, -2);
    expect(hole.areaM2!).toBeLessThan(solid.areaM2!);
  });

  it('bbox comes from the outer ring only', () => {
    const m = computeGeometryMetrics({
      type: 'Polygon',
      coordinates: [
        [[-2, -1], [4, -1], [4, 3], [-2, 3], [-2, -1]],
        [[0, 0], [1, 0], [1, 1], [0, 0]],
      ],
    });
    expect([m.minLon, m.minLat, m.maxLon, m.maxLat]).toEqual([-2, -1, 4, 3]);
  });

  it('sums a MultiPolygon and spans all parts in the bbox', () => {
    const single = computeGeometryMetrics(unitSquare);
    const m = computeGeometryMetrics({
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]]],
      ],
    });
    expect(m.areaM2!).toBeGreaterThan(single.areaM2! * 1.9);
    expect(m.areaM2!).toBeLessThan(single.areaM2! * 2.1);
    expect(m.lengthM).toBeNull();
    expect([m.minLon, m.minLat, m.maxLon, m.maxLat]).toEqual([0, 0, 11, 1]);
  });

  it('a degenerate (collinear) polygon has zero area', () => {
    const m = computeGeometryMetrics({
      type: 'Polygon',
      coordinates: [[[0, 0], [0, 1], [0, 2], [0, 0]]],
    });
    // Points on one meridian are collinear on the sphere too (unlike a diagonal in lon/lat).
    expect(m.areaM2).toBeCloseTo(0, 0);
  });
});

describe('computeGeometryMetrics: unsupported / odd input', () => {
  it('a GeometryCollection still gets a bbox but no length or area', () => {
    const m = computeGeometryMetrics({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [1, 2] },
        { type: 'LineString', coordinates: [[3, 4], [5, 6]] },
      ],
    });
    expect([m.minLon, m.minLat, m.maxLon, m.maxLat]).toEqual([1, 2, 5, 6]);
    expect(m.lengthM).toBeNull();
    expect(m.areaM2).toBeNull();
  });
});
