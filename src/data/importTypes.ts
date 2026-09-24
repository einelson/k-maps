import type { LineString, Point, Polygon } from 'geojson';

/** Common shape produced by both the GPX and KML parsers, ready to insert via featuresRepo. */
export interface ParsedImportFeature {
  name: string | null;
  notes: string | null;
  geometry: Point | LineString | Polygon;
  /** KML <Folder> nesting, outermost first; GPX has no folder concept so this is always empty. */
  folderPath: string[];
}

export type ExportFormat = 'geojson' | 'gpx' | 'kml';
