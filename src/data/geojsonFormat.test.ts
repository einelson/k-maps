import type { Geometry } from 'geojson';

import { LINE, POINT, POLYGON, makeFeature } from '../testing/featureFixtures';
import { featuresToGeoJSON } from './geojsonFormat';

describe('featuresToGeoJSON', () => {
  it('returns an empty FeatureCollection for no features', () => {
    expect(featuresToGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('exports name, notes, color, icon and folder_id as properties', () => {
    const fc = featuresToGeoJSON([
      makeFeature(POINT, {
        name: 'Trailhead',
        notes: 'Park by the gate',
        color: '#e11d48',
        icon: 'flag',
        folder_id: 7,
      }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]).toEqual({
      type: 'Feature',
      properties: {
        name: 'Trailhead',
        notes: 'Park by the gate',
        color: '#e11d48',
        icon: 'flag',
        folder_id: 7,
      },
      geometry: POINT,
    });
  });

  it('keeps null properties as null rather than dropping the keys', () => {
    const [feature] = featuresToGeoJSON([makeFeature(POINT)]).features;
    expect(feature.properties).toEqual({
      name: null,
      notes: null,
      color: null,
      icon: null,
      folder_id: null,
    });
  });

  it('parses the stored geometry text into real geometry objects for every type', () => {
    const fc = featuresToGeoJSON([makeFeature(POINT), makeFeature(LINE), makeFeature(POLYGON)]);
    expect(fc.features.map((f) => f.geometry)).toEqual([POINT, LINE, POLYGON]);
  });

  it('preserves feature order', () => {
    const fc = featuresToGeoJSON([
      makeFeature(POINT, { name: 'c' }),
      makeFeature(POINT, { name: 'a' }),
      makeFeature(POINT, { name: 'b' }),
    ]);
    expect(fc.features.map((f) => f.properties!.name)).toEqual(['c', 'a', 'b']);
  });

  it('round-trips through JSON text without losing precision', () => {
    const geometry: Geometry = { type: 'Point', coordinates: [-116.123456789012, 43.987654321098] };
    const text = JSON.stringify(featuresToGeoJSON([makeFeature(geometry)]));
    const parsed = JSON.parse(text);
    expect(parsed.features[0].geometry.coordinates).toEqual([-116.123456789012, 43.987654321098]);
  });

  it('passes Multi* geometries through untouched (GeoJSON is the lossless format)', () => {
    const multi: Geometry = {
      type: 'MultiLineString',
      coordinates: [
        [[0, 0], [1, 1]],
        [[2, 2], [3, 3]],
      ],
    };
    expect(featuresToGeoJSON([makeFeature(multi)]).features[0].geometry).toEqual(multi);
  });

  it('throws on a corrupt stored geometry rather than emitting a bogus feature', () => {
    const bad = makeFeature(POINT);
    bad.geometry = '{not json';
    expect(() => featuresToGeoJSON([bad])).toThrow(SyntaxError);
  });
});
