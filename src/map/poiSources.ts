import type { FeatureCollection, Point } from 'geojson';

import boatLaunchesData from '../../assets/poi/boat-launches.json';
import campsitesTrailsData from '../../assets/poi/campsites-trails.json';

/**
 * Pre-built POI pins, bundled as static GeoJSON rather than downloaded or
 * user-drawn. Sourced from OpenStreetMap via Overpass (tools/fetch_pois.mjs)
 * for one starter bbox (Treasure Valley / southwest Idaho) — re-run that
 * script with a different bbox to cover another region.
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
