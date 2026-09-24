import type { DataDrivenPropertyValueSpecification } from '@maplibre/maplibre-gl-style-spec';

import type { TrailClass } from '../packs/trails';

/**
 * Styling for the downloaded USFS trails overlay (src/packs/trails.ts). Two classes keep it legible
 * over any base map and distinct from MVUM roads (solid, green/orange/purple) and OSM paths (white
 * dashes): teal dashes for hiking/horse/bike trails, magenta dashes for motorized ones.
 */
export const TRAIL_CLASS_LABELS: Record<TrailClass, string> = {
  nonmotorized: 'Hiking / horse / bike trail',
  motorized: 'Motorized trail (OHV / motorcycle)',
};

export const TRAIL_CLASS_COLORS: Record<TrailClass, string> = {
  nonmotorized: '#0f766e',
  motorized: '#c026d3',
};

export const TRAIL_COLOR_EXPRESSION = [
  'match',
  ['get', 'trailClass'],
  'motorized',
  TRAIL_CLASS_COLORS.motorized,
  TRAIL_CLASS_COLORS.nonmotorized,
] as unknown as DataDrivenPropertyValueSpecification<string>;

export const TRAILS_SOURCE_NOTE = 'USFS National Forest System trails (Enterprise Data Warehouse)';
