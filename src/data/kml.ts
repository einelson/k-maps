import { XMLParser } from 'fast-xml-parser';
import type { Geometry, LineString, Point, Polygon, Position } from 'geojson';

import type { Feature } from './types';
import type { ParsedImportFeature } from './importTypes';
import { asArray, escapeXml } from './xmlUtil';

function coordsToKml(coords: Position[]): string {
  return coords.map(([lon, lat]) => `${lon},${lat},0`).join(' ');
}

function geometryToKml(geometry: Geometry): string | null {
  switch (geometry.type) {
    case 'Point':
      return `<Point><coordinates>${coordsToKml([geometry.coordinates])}</coordinates></Point>`;
    case 'LineString':
      return `<LineString><coordinates>${coordsToKml(geometry.coordinates)}</coordinates></LineString>`;
    case 'Polygon':
      return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsToKml(
        geometry.coordinates[0]
      )}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    default:
      return null;
  }
}

export function featuresToKml(features: Feature[]): string {
  const placemarks = features
    .map((f) => {
      const geometry = JSON.parse(f.geometry) as Geometry;
      const geometryXml = geometryToKml(geometry);
      if (!geometryXml) return null;
      const nameTag = f.name ? `<name>${escapeXml(f.name)}</name>` : '';
      const descTag = f.notes ? `<description>${escapeXml(f.notes)}</description>` : '';
      return `  <Placemark>${nameTag}${descTag}${geometryXml}</Placemark>`;
    })
    .filter((x): x is string => x != null);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    ...placemarks,
    '</Document>',
    '</kml>',
  ].join('\n');
}

/**
 * Parser output is untyped XML JSON, so this file leans on explicit `any`
 * rather than modeling KML's full schema — same reasoning as src/data/gpx.ts.
 */
export function parseKml(xml: string): ParsedImportFeature[] {
  const parser = new XMLParser({ ignoreAttributes: true });
  const doc = parser.parse(xml);
  const root = doc.kml?.Document ?? doc.kml;
  if (!root) return [];

  const results: ParsedImportFeature[] = [];
  walkKmlNode(root, [], results);
  return results;
}

function walkKmlNode(node: any, folderPath: string[], out: ParsedImportFeature[]): void {
  for (const folder of asArray<any>(node.Folder)) {
    const name = typeof folder.name === 'string' ? folder.name : null;
    walkKmlNode(folder, name ? [...folderPath, name] : folderPath, out);
  }

  for (const placemark of asArray<any>(node.Placemark)) {
    const geometry = kmlPlacemarkGeometry(placemark);
    if (!geometry) continue;
    out.push({
      name: typeof placemark.name === 'string' ? placemark.name : null,
      notes: typeof placemark.description === 'string' ? placemark.description : null,
      geometry,
      folderPath,
    });
  }
}

function kmlPlacemarkGeometry(placemark: any): Point | LineString | Polygon | null {
  if (placemark.Point?.coordinates) {
    const [point] = parseKmlCoordinates(placemark.Point.coordinates);
    return point ? { type: 'Point', coordinates: point } : null;
  }
  if (placemark.LineString?.coordinates) {
    const coordinates = parseKmlCoordinates(placemark.LineString.coordinates);
    return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
  }
  if (placemark.Polygon?.outerBoundaryIs?.LinearRing?.coordinates) {
    const ring = parseKmlCoordinates(placemark.Polygon.outerBoundaryIs.LinearRing.coordinates);
    return ring.length >= 4 ? { type: 'Polygon', coordinates: [ring] } : null;
  }
  return null;
}

function parseKmlCoordinates(raw: string): Position[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((triplet): Position => {
      const [lon, lat] = triplet.split(',').map(Number);
      return [lon, lat];
    })
    .filter(([lon, lat]) => !Number.isNaN(lon) && !Number.isNaN(lat));
}
