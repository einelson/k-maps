import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import huntUnitsData from '../../assets/idfg/game-units.json';
import huntUnitsMeta from '../../assets/idfg/game-units.meta.json';
import type { HuntUnitProperties } from './huntUnitsStyle';

export { HUNT_UNIT_COLOR, HUNT_UNIT_DISCLAIMER } from './huntUnitsStyle';
export type { HuntUnitProperties } from './huntUnitsStyle';

/**
 * Idaho Fish and Game hunt units (Game Management Units), bundled statewide as a static asset —
 * 100 polygons, so unlike land/MVUM there is nothing to download per cell. Built by
 * tools/fetch_idfg_units.mjs; re-run it each season.
 */
export const HUNT_UNITS_DATA = huntUnitsData as unknown as FeatureCollection<
  Polygon | MultiPolygon,
  HuntUnitProperties
>;
export const HUNT_UNITS_META = huntUnitsMeta as {
  source: string;
  serviceUrl: string;
  featureCount: number;
  fetchedAt: string;
  license: string;
  note: string;
};
