import type { FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson';

import { cssColorToPalette } from '../features/colorMatch';
import type { ParsedImportFeature } from './importTypes';
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

type SimpleGeometry = Point | LineString | Polygon;

/** Splits Multi* and GeometryCollection into the single-part geometries a K-Maps feature can hold. */
function simpleGeometries(geometry: any): SimpleGeometry[] {
  if (!geometry || typeof geometry !== 'object') return [];
  switch (geometry.type) {
    case 'Point':
    case 'LineString':
    case 'Polygon':
      return Array.isArray(geometry.coordinates) ? [geometry] : [];
    case 'MultiPoint':
      return asCoordinateList(geometry).map((coordinates) => ({ type: 'Point', coordinates }));
    case 'MultiLineString':
      return asCoordinateList(geometry).map((coordinates) => ({ type: 'LineString', coordinates }));
    case 'MultiPolygon':
      return asCoordinateList(geometry).map((coordinates) => ({ type: 'Polygon', coordinates }));
    case 'GeometryCollection':
      return Array.isArray(geometry.geometries) ? geometry.geometries.flatMap(simpleGeometries) : [];
    default:
      return [];
  }
}

function asCoordinateList(geometry: { coordinates?: unknown }): any[] {
  return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
}

const GEOMETRY_TYPES = new Set([
  'Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection',
]);

function textProperty(properties: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Accepts a FeatureCollection, a single Feature or a bare geometry. Property names follow what other apps
 * write: `title` (CalTopo) for names, and `stroke` / `marker-color` / `fill` (simplestyle) for colors, alongside
 * K-Maps' own `name`, `notes` and `color`. Colors snap to the app palette.
 */
export function parseGeoJSON(content: string): ParsedImportFeature[] {
  let json: any;
  try {
    json = JSON.parse(content);
  } catch {
    throw new Error('This file is not valid GeoJSON.');
  }

  let rawFeatures: any[];
  if (json?.type === 'FeatureCollection') rawFeatures = Array.isArray(json.features) ? json.features : [];
  else if (GEOMETRY_TYPES.has(json?.type)) rawFeatures = [{ type: 'Feature', properties: {}, geometry: json }];
  else rawFeatures = [json];

  const results: ParsedImportFeature[] = [];
  for (const raw of rawFeatures) {
    const properties: Record<string, unknown> =
      raw?.properties && typeof raw.properties === 'object' ? raw.properties : {};
    const name = textProperty(properties, 'name', 'title');
    const notes = textProperty(properties, 'notes', 'description', 'desc', 'comment');
    const color =
      [properties.color, properties.stroke, properties['marker-color'], properties.fill]
        .map(cssColorToPalette)
        .find((c) => c != null) ?? null;

    for (const geometry of simpleGeometries(raw?.geometry)) {
      results.push({ name, notes, geometry, folderPath: [], color });
    }
  }
  return results;
}
