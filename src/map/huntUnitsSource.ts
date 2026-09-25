import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import huntUnitsData from '../../assets/idfg/game-units.json';
import huntUnitsMeta from '../../assets/idfg/game-units.meta.json';
import type { HuntStateInfo, HuntUnitProperties } from '../huntUnits/types';

export { HUNT_UNIT_COLOR, huntUnitDisclaimer } from './huntUnitsStyle';
export type { HuntUnitProperties } from './huntUnitsStyle';

/**
 * Idaho Fish and Game hunt units (Game Management Units), bundled statewide so the layer works offline out of the
 * box — 100 polygons in the same normalized shape as every downloadable state (src/huntUnits/). Built by
 * tools/fetch_idfg_units.mjs; re-run it each season.
 */
export const IDAHO_UNITS_DATA = huntUnitsData as unknown as FeatureCollection<Polygon | MultiPolygon, HuntUnitProperties>;

export const IDAHO_UNITS_META = huntUnitsMeta as HuntStateInfo & {
  source: string;
  serviceUrl: string;
  featureCount: number;
  fetchedAt: string;
  license: string;
  note: string;
};

/** Idaho as the map sees any other state: who published it, which sets it has, where it is. */
export const IDAHO_HUNT_STATE: HuntStateInfo = {
  state: IDAHO_UNITS_META.state,
  name: IDAHO_UNITS_META.name,
  agency: IDAHO_UNITS_META.agency,
  regsUrl: IDAHO_UNITS_META.regsUrl,
  vintage: IDAHO_UNITS_META.vintage,
  fetchedAt: IDAHO_UNITS_META.fetchedAt,
  bbox: IDAHO_UNITS_META.bbox,
  sets: IDAHO_UNITS_META.sets,
};
