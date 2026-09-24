/**
 * USGS National Map raster tile services (§2). Public domain, Web Mercator,
 * cached tile pyramid. Esri MapServer tile endpoints are z/y/x, not z/x/y.
 *
 * Sources to avoid entirely (§2 "Sources to avoid"): Google/Bing/Esri World
 * Imagery, and tile.openstreetmap.org — none permit bulk offline caching.
 */
const USGS_BASE = 'https://basemap.nationalmap.gov/arcgis/rest/services';

export const USGS_TOPO_TILE_URL = `${USGS_BASE}/USGSTopo/MapServer/tile/{z}/{y}/{x}`;
export const USGS_IMAGERY_TILE_URL = `${USGS_BASE}/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`;
export const USGS_IMAGERY_TOPO_TILE_URL = `${USGS_BASE}/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`;
export const USGS_SHADED_RELIEF_TILE_URL = `${USGS_BASE}/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}`;

export const USGS_ATTRIBUTION = '© USGS The National Map';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** USGS tiles are 256px; MapLibre defaults to 512 — a wrong value renders mixed sharp/blurry tiles (§4.6). */
export const USGS_TILE_SIZE = 256;

/**
 * Probed against the live services (§12.3) — the tile-info endpoints claim
 * levels up to 23, but real tiles stop earlier: topo, imagery and hybrid
 * return 404 from z17, so MapLibre overzooms z16 beyond this rather than
 * requesting tiles that don't exist.
 */
export const USGS_MAX_NATIVE_ZOOM = 16;

/** Shaded relief is coarser: real tiles stop at z13 (404 from z14), same probe as above. */
export const USGS_SHADED_RELIEF_MAX_ZOOM = 13;

export type BaseMapMode = 'topo' | 'satellite' | 'hybrid';

export const BASE_MAP_TILE_URLS: Record<BaseMapMode, string> = {
  topo: USGS_TOPO_TILE_URL,
  satellite: USGS_IMAGERY_TILE_URL,
  hybrid: USGS_IMAGERY_TOPO_TILE_URL,
};
