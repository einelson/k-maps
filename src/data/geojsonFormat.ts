import type { FeatureCollection, Geometry } from 'geojson';

import type { Feature } from './types';

export function featuresToGeoJSON(features: Feature[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: {
        name: f.name,
        notes: f.notes,
        color: f.color,
        icon: f.icon,
        folder_id: f.folder_id,
      },
      geometry: JSON.parse(f.geometry) as Geometry,
    })),
  };
}
