import type { Geometry } from 'geojson';

import type { Feature } from '../data/types';

/** Builds a persisted-`Feature` row for export tests; geometry is serialized like the DB stores it. */
export function makeFeature(
  geometry: Geometry,
  overrides: Partial<Omit<Feature, 'geometry'>> = {}
): Feature {
  return {
    id: 1,
    folder_id: null,
    type: 'point',
    name: null,
    notes: null,
    color: null,
    icon: null,
    geometry: JSON.stringify(geometry),
    min_lon: null,
    min_lat: null,
    max_lon: null,
    max_lat: null,
    length_m: null,
    area_m2: null,
    elevation_m: null,
    source: 'manual',
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

export const POINT: Geometry = { type: 'Point', coordinates: [-116.2023, 43.615] };

export const LINE: Geometry = {
  type: 'LineString',
  coordinates: [
    [-116.2, 43.6],
    [-116.15, 43.62],
    [-116.1, 43.65],
  ],
};

/** Closed outer ring (first == last), counter-clockwise. */
export const POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-116.3, 43.5],
      [-116.2, 43.5],
      [-116.2, 43.6],
      [-116.3, 43.6],
      [-116.3, 43.5],
    ],
  ],
};
