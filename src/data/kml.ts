import { XMLParser } from 'fast-xml-parser';
import type { Geometry, LineString, Point, Polygon, Position } from 'geojson';

import type { Feature } from './types';
import type { ParsedImportFeature } from './importTypes';
import { kmlColorToPalette } from '../features/colorMatch';
import { asArray, escapeXml, htmlToText, textOf } from './xmlUtil';

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
  const parser = new XMLParser({
    ignoreAttributes: false, // `id` on <Style>/<StyleMap> is how placemarks find their colors
    attributeNamePrefix: '@_',
    parseTagValue: false,
    htmlEntities: true,
  });
  const doc = parser.parse(xml);
  if (!doc.kml) return [];

  const styles = new Map<string, any>();
  collectStyles(doc.kml, styles);

  const results: ParsedImportFeature[] = [];
  walkKmlNode(doc.kml, [], styles, results);
  return results;
}

/** Shared <Style>/<StyleMap> elements can sit in the top-level Document or inside any folder. */
function collectStyles(node: any, styles: Map<string, any>): void {
  for (const style of [...asArray<any>(node.Style), ...asArray<any>(node.StyleMap)]) {
    const id = style['@_id'];
    if (typeof id === 'string') styles.set(id, style);
  }
  for (const child of [...asArray<any>(node.Document), ...asArray<any>(node.Folder)]) {
    collectStyles(child, styles);
  }
}

function walkKmlNode(node: any, folderPath: string[], styles: Map<string, any>, out: ParsedImportFeature[]): void {
  // A <Document> is a container, not a user-made folder, so it adds no level to the path.
  for (const document of asArray<any>(node.Document)) {
    walkKmlNode(document, folderPath, styles, out);
  }

  for (const folder of asArray<any>(node.Folder)) {
    const name = textOf(folder.name);
    walkKmlNode(folder, name ? [...folderPath, name] : folderPath, styles, out);
  }

  for (const placemark of asArray<any>(node.Placemark)) {
    const description = textOf(placemark.description);
    const style = resolveStyle(placemark, styles);
    // A <MultiGeometry> (or several geometries in one placemark) becomes one feature per part, sharing the
    // placemark's name, notes and color, because the app models a feature as a single geometry.
    for (const geometry of placemarkGeometries(placemark)) {
      out.push({
        name: textOf(placemark.name),
        notes: description == null ? null : htmlToText(description),
        geometry,
        folderPath,
        color: styleColor(style, geometry.type),
      });
    }
  }
}

function placemarkGeometries(node: any): (Point | LineString | Polygon)[] {
  const results: (Point | LineString | Polygon)[] = [];

  for (const point of asArray<any>(node.Point)) {
    const [position] = parseKmlCoordinates(textOf(point.coordinates));
    if (position) results.push({ type: 'Point', coordinates: position });
  }
  for (const line of asArray<any>(node.LineString)) {
    const coordinates = parseKmlCoordinates(textOf(line.coordinates));
    if (coordinates.length >= 2) results.push({ type: 'LineString', coordinates });
  }
  // Only the outer boundary is kept; the app's areas have no holes.
  for (const polygon of asArray<any>(node.Polygon)) {
    const ring = parseKmlCoordinates(textOf(polygon.outerBoundaryIs?.LinearRing?.coordinates));
    if (ring.length >= 4) results.push({ type: 'Polygon', coordinates: [ring] });
  }
  for (const multi of asArray<any>(node.MultiGeometry)) {
    results.push(...placemarkGeometries(multi));
  }
  return results;
}

/** An inline <Style> wins; otherwise follow `styleUrl`, and through a <StyleMap> to its "normal" pair. */
function resolveStyle(placemark: any, styles: Map<string, any>): any | null {
  if (placemark.Style && typeof placemark.Style === 'object') return placemark.Style;

  let style = styles.get(styleId(textOf(placemark.styleUrl)));
  // Depth-limited so a self-referencing StyleMap in a malformed file can't loop forever.
  for (let depth = 0; style?.Pair && depth < 4; depth++) {
    const normal = asArray<any>(style.Pair).find((pair) => textOf(pair.key) === 'normal');
    if (!normal) return null;
    style = normal.Style ?? styles.get(styleId(textOf(normal.styleUrl)));
  }
  return style && !style.Pair ? style : null;
}

/** `#id` or `file.kml#id`; anything without a fragment can't match a style in this document. */
function styleId(styleUrl: string | null): string {
  const hash = styleUrl?.indexOf('#') ?? -1;
  return styleUrl && hash >= 0 ? styleUrl.slice(hash + 1).trim() : '';
}

/** Pins take their tint from the icon, lines from the line style, areas from their outline (fill is translucent). */
function styleColor(style: any | null, type: Geometry['type']): string | null {
  if (!style) return null;
  const raw =
    type === 'Point'
      ? textOf(style.IconStyle?.color)
      : (textOf(style.LineStyle?.color) ?? (type === 'Polygon' ? textOf(style.PolyStyle?.color) : null));
  return raw ? kmlColorToPalette(raw) : null;
}

function parseKmlCoordinates(raw: string | null): Position[] {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((triplet): Position => {
      const [lon, lat] = triplet.split(',').map(Number);
      return [lon, lat];
    })
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}
