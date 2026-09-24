/**
 * Shared starter region for all `tools/fetch_*` scripts — Treasure Valley /
 * southwest Idaho, matching the app's default map center
 * (src/map/MapView.tsx). [west, south, east, north] / EPSG:4326.
 */
export const BBOX_WSEN = [-117.0, 43.0, -115.5, 44.2];

export function bboxOverpass([west, south, east, north] = BBOX_WSEN) {
  return `${south},${west},${north},${east}`;
}

export function bboxArcGisEnvelope([west, south, east, north] = BBOX_WSEN) {
  return `${west},${south},${east},${north}`;
}
