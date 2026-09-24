import type { FeatureCollection, LineString, MultiLineString } from 'geojson';

import mvumData from '../../assets/mvum/mvum.json';
import mvumMeta from '../../assets/mvum/mvum.meta.json';
import { mvumVehicleClass } from '../packs/mvumClass.ts';
import type { MvumVehicleClass } from '../packs/mvumClass.ts';

export { mvumVehicleClass };
export type { MvumVehicleClass };

/**
 * USFS Motor Vehicle Use Map — roads + motorized trails (spec §2: "is this
 * forest road legal for my vehicle" detail OSM often lacks). Bundled as
 * static GeoJSON for the cell-aligned starter region, in the same pack
 * format that `fetchMvumPack` (src/packs/mvum.ts) downloads per cell
 * on-device — so `vehicleClass` is already stamped on every feature. Built
 * by tools/build_starter_pack.mjs; the classification logic lives in
 * src/packs/mvumClass.ts (pure, shared with the fetcher).
 */
export const MVUM_DATA = mvumData as FeatureCollection<LineString | MultiLineString>;
export const MVUM_META = mvumMeta as unknown as {
  source: string;
  serviceUrl: string;
  /** [west, south, east, north] of the bundled region (cell-aligned). */
  bbox: [number, number, number, number];
  cellRect: { cxMin: number; cxMax: number; cyMin: number; cyMax: number };
  featureCount: number;
  kinds: Record<string, number>;
  vehicleClasses: Record<MvumVehicleClass, number>;
  fetchedAt: string;
  license: string;
};

export const MVUM_CLASS_LABELS: Record<MvumVehicleClass, string> = {
  passenger: 'Open to passenger vehicles',
  highClearance: 'High-clearance / 4WD required',
  offroad: 'OHV / motorcycle / ATV only',
  unknown: 'Vehicle access unknown',
};

export const MVUM_CLASS_COLORS: Record<MvumVehicleClass, string> = {
  passenger: '#16a34a', // green
  highClearance: '#f97316', // orange
  offroad: '#a855f7', // purple
  unknown: '#6b7280', // gray
};

/** MapLibre `match` expression on the derived `vehicleClass` property, for line-color styling. */
export const MVUM_COLOR_EXPRESSION = [
  'match',
  ['get', 'vehicleClass'],
  'passenger',
  MVUM_CLASS_COLORS.passenger,
  'highClearance',
  MVUM_CLASS_COLORS.highClearance,
  'offroad',
  MVUM_CLASS_COLORS.offroad,
  MVUM_CLASS_COLORS.unknown,
] as unknown as import('@maplibre/maplibre-gl-style-spec').DataDrivenPropertyValueSpecification<string>;
