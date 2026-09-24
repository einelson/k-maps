import type { Geometry, LineString, Point, Polygon } from 'geojson';

import type { FeatureType } from '../data/types';

/** [lon, lat] */
export type Vertex = [number, number];

/** Fewest vertices a shape of each type can keep. */
export const MIN_VERTICES: Record<FeatureType, number> = { point: 1, line: 2, polygon: 3 };

/**
 * Editable vertex list for a saved geometry. Polygons drop the ring's closing
 * duplicate (it's re-added on save) and only the outer ring is editable; other
 * geometry types (Multi*) aren't editable and return null.
 */
export function geometryToVertices(geometry: Geometry): { type: FeatureType; vertices: Vertex[] } | null {
  switch (geometry.type) {
    case 'Point':
      return { type: 'point', vertices: [[geometry.coordinates[0], geometry.coordinates[1]]] };
    case 'LineString':
      return { type: 'line', vertices: geometry.coordinates.map(([x, y]) => [x, y] as Vertex) };
    case 'Polygon': {
      const ring = geometry.coordinates[0] ?? [];
      const open = ring.length > 1 && sameVertex(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
      return { type: 'polygon', vertices: open.map(([x, y]) => [x, y] as Vertex) };
    }
    default:
      return null;
  }
}

export function verticesToGeometry(type: FeatureType, vertices: Vertex[]): Point | LineString | Polygon {
  if (type === 'point') return { type: 'Point', coordinates: vertices[0] };
  if (type === 'line') return { type: 'LineString', coordinates: vertices };
  return { type: 'Polygon', coordinates: [[...vertices, vertices[0]]] };
}

function sameVertex(a: number[], b: number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Where a new vertex can be inserted: the midpoint of each segment. `index` is
 * the position the new vertex would take in the list. A polygon's closing
 * segment (last -> first) inserts at the end.
 */
export function segmentMidpoints(
  type: FeatureType,
  vertices: Vertex[]
): { index: number; coordinates: Vertex }[] {
  if (type === 'point' || vertices.length < 2) return [];
  const out: { index: number; coordinates: Vertex }[] = [];
  const segments = type === 'polygon' ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segments; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    out.push({ index: i + 1, coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  }
  return out;
}

export function moveVertex(vertices: Vertex[], index: number, to: Vertex): Vertex[] {
  return vertices.map((v, i) => (i === index ? to : v));
}

export function insertVertex(vertices: Vertex[], index: number, at: Vertex): Vertex[] {
  return [...vertices.slice(0, index), at, ...vertices.slice(index)];
}

export function removeVertex(vertices: Vertex[], index: number): Vertex[] {
  return vertices.filter((_, i) => i !== index);
}

export function canRemoveVertex(type: FeatureType, vertices: Vertex[]): boolean {
  return vertices.length > MIN_VERTICES[type];
}
