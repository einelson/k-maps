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
 * The topo cache tops out around z16-17; verify per service via its tile
 * info endpoint (§12.3) and overzoom past this rather than requesting tiles
 * that don't exist.
 */
export const USGS_MAX_NATIVE_ZOOM = 16;

export type BaseMapMode = 'topo' | 'satellite' | 'hybrid';

export const BASE_MAP_TILE_URLS: Record<BaseMapMode, string> = {
  topo: USGS_TOPO_TILE_URL,
  satellite: USGS_IMAGERY_TILE_URL,
  hybrid: USGS_IMAGERY_TOPO_TILE_URL,
};
