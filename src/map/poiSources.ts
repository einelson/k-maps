import type { FeatureCollection, Point } from 'geojson';

import boatLaunchesData from '../../assets/poi/boat-launches.json';
import campsitesTrailsData from '../../assets/poi/campsites-trails.json';

/**
 * Pre-built POI pins for the bundled, cell-aligned starter region (Treasure
 * Valley / southwest Idaho, src/packs/region.ts), in the same pack format
 * that `fetchPoiPack` (src/packs/poi.ts) downloads per cell on-device:
 * Point features with `category` ('boatLaunches' | 'campsitesTrails'),
 * `name` (string | null) and `osm_id`. Sourced from OpenStreetMap via
 * Overpass by tools/build_starter_pack.mjs.
 */
export type PoiCategory = 'boatLaunches' | 'campsitesTrails';

export const POI_DATASETS: Record<PoiCategory, FeatureCollection<Point>> = {
  boatLaunches: boatLaunchesData as FeatureCollection<Point>,
  campsitesTrails: campsitesTrailsData as FeatureCollection<Point>,
};

export const POI_CATEGORY_META: Record<PoiCategory, { label: string; color: string }> = {
  boatLaunches: { label: 'Boat launches', color: '#0ea5e9' },
  campsitesTrails: { label: 'Campsites & trailheads', color: '#16a34a' },
};

export const POI_ATTRIBUTION = '© OpenStreetMap contributors';
