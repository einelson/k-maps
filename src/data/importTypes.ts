import type { LineString, Point, Polygon } from 'geojson';

import type { TrackSamples } from '../features/trackStats';

/** Common shape produced by the GPX, KML and GeoJSON parsers, ready to insert via featuresRepo. */
export interface ParsedImportFeature {
  name: string | null;
  notes: string | null;
  geometry: Point | LineString | Polygon;
  /** KML <Folder> nesting, outermost first; GPX has no folder concept so this is always empty. */
  folderPath: string[];
  /** A color from FEATURE_COLOR_PALETTE, when the file specified one; null/absent uses the app default. */
  color?: string | null;
  /** Per-point time/elevation for a GPX track, lined up with `geometry`'s coordinates. */
  track?: TrackSamples;
}

export type ExportFormat = 'geojson' | 'gpx' | 'kml';
