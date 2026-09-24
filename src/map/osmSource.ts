import type { DataDrivenPropertyValueSpecification } from '@maplibre/maplibre-gl-style-spec';

/**
 * Styling for the downloaded OpenStreetMap roads & trails overlay (spec §2/§5.2:
 * "the overlay approach lets you toggle roads, trails and labels independently").
 * The features come from src/packs/osm.ts, which stamps a `cls` on each way.
 */
export type OsmRoadClass = 'highway' | 'primary' | 'street' | 'track' | 'path';

export const OSM_CLASS_LABELS: Record<OsmRoadClass, string> = {
  highway: 'Highway',
  primary: 'Main road',
  street: 'Street',
  track: 'Dirt track / 4x4 road',
  path: 'Trail / footpath',
};

export const OSM_CLASS_COLORS: Record<OsmRoadClass, string> = {
  highway: '#dc2626',
  primary: '#ea580c',
  street: '#fde047',
  track: '#d97706',
  path: '#ffffff',
};

const OSM_CLASS_WIDTHS: Record<OsmRoadClass, number> = {
  highway: 3.4,
  primary: 2.8,
  street: 1.8,
  track: 2,
  path: 1.6,
};

// Cast at the boundary, same reasoning as src/map/filterExpression.ts.
function byClass<T extends string | number>(values: Record<OsmRoadClass, T>, fallback: T) {
  return [
    'match',
    ['get', 'cls'],
    'highway',
    values.highway,
    'primary',
    values.primary,
    'street',
    values.street,
    'track',
    values.track,
    'path',
    values.path,
    fallback,
  ] as unknown as DataDrivenPropertyValueSpecification<T>;
}

export const OSM_LINE_COLOR = byClass(OSM_CLASS_COLORS, '#ffffff');
export const OSM_LINE_WIDTH = byClass(OSM_CLASS_WIDTHS, 1.6);
export const OSM_CASING_WIDTH = byClass(
  Object.fromEntries(
    Object.entries(OSM_CLASS_WIDTHS).map(([cls, width]) => [cls, width + 2])
  ) as Record<OsmRoadClass, number>,
  3.6
);

export const OSM_ATTRIBUTION_SHORT = '© OpenStreetMap contributors';
