import { area, bbox, length } from '@turf/turf';
import type { Feature as GeoJSONFeature, Geometry } from 'geojson';

import type { FeatureType } from '../data/types';

export interface GeometryMetrics {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  lengthM: number | null;
  areaM2: number | null;
}

export function geometryTypeToFeatureType(geometry: Geometry): FeatureType {
  switch (geometry.type) {
    case 'Point':
    case 'MultiPoint':
      return 'point';
    case 'LineString':
    case 'MultiLineString':
      return 'line';
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygon';
    default:
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
}

/** Live length/area/bbox readout while drawing, and the values persisted on save (§7.3). */
export function computeGeometryMetrics(geometry: Geometry): GeometryMetrics {
  const feature: GeoJSONFeature = { type: 'Feature', properties: {}, geometry };
  const [minLon, minLat, maxLon, maxLat] = bbox(feature);

  let lengthM: number | null = null;
  let areaM2: number | null = null;

  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    lengthM = length(feature, { units: 'meters' });
  } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    areaM2 = area(feature);
  }

  return { minLon, minLat, maxLon, maxLat, lengthM, areaM2 };
}
