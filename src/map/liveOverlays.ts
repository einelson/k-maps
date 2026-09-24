/**
 * Online-only raster overlays, each a public tile/export endpoint MapLibre hits directly — nothing
 * to download, nothing baked into offline packs. They cover the whole US, which is the point: the
 * vector packs (land, MVUM, ...) are per-cell, these work wherever you pan while you have signal.
 *
 * Two flavours of URL:
 *  - Cached XYZ tile services (USGS hydro, BLM SMA): esri tile URLs are z/y/x.
 *  - ArcGIS `export` / `exportImage` endpoints (NOAA radar, NWI, 3DEP slope): drawn on the fly for
 *    the requested box — MapLibre swaps `{bbox-epsg-3857}` for each tile's Web Mercator extent.
 *
 * Every endpoint below was probed live (transparent PNG back, real data) when this was written.
 */

/** A swatch + label pair for legends. */
export interface LegendEntry {
  color: string;
  label: string;
}

export type LiveRasterId = 'radar' | 'nhd' | 'wetlands' | 'slopeAngle' | 'landManager';

export interface LiveRasterDef {
  id: LiveRasterId;
  /** URL template. For time-sensitive layers this is a function of the refresh bucket (see `liveRasterTiles`). */
  tiles: string;
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  attribution: string;
  /** Time-sensitive layers re-fetch on this interval while visible (ms). */
  refreshMs?: number;
}

const BBOX = '{bbox-epsg-3857}';

/** Shared query string for ArcGIS `export` on a 256px tile, transparent PNG with real alpha. */
const EXPORT_PARAMS = `bbox=${BBOX}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;

// --- Weather radar ---------------------------------------------------------------------------

/** NWS "Radar Base Reflectivity": the MRMS 1 km CONUS mosaic, updated every few minutes. */
export const RADAR_EXPORT_URL =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer/export';
/** The mosaic itself refreshes about every 2-5 min, so there is no point polling faster. */
export const RADAR_REFRESH_MS = 5 * 60 * 1000;

// --- Water (NHD) and wetlands (NWI) ---------------------------------------------------------

/** USGS cached cartographic rendering of the National Hydrography Dataset (transparent PNG, native to z16). */
export const NHD_TILE_URL =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}';
export const NHD_MAX_ZOOM = 16;

/** USFWS National Wetlands Inventory map service. Draws nothing above 1:100,000 (about z13 on 256px tiles). */
export const WETLANDS_EXPORT_URL =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/export';
export const WETLANDS_MIN_ZOOM = 13;

// --- Slope angle (USGS 3DEP) ------------------------------------------------------------------

/** 3DEP bare-earth DEM image service. Its "Slope Degrees" function already corrects for Web Mercator stretch. */
export const SLOPE_EXPORT_URL =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

/**
 * Backcountry-travel classes (the usual avalanche-terrain bands: most slides start on 30-45 deg).
 * Below `SLOPE_MIN_DEGREES` the tile is fully transparent, so flat ground stays uncluttered.
 */
export const SLOPE_CLASSES: (LegendEntry & { min: number; max: number; rgb: [number, number, number] })[] = [
  { min: 27, max: 30, color: '#ffeb3b', rgb: [255, 235, 59], label: '27-30°  gentle-steep' },
  { min: 30, max: 35, color: '#ff9800', rgb: [255, 152, 0], label: '30-35°  steep' },
  { min: 35, max: 45, color: '#e53935', rgb: [229, 57, 53], label: '35-45°  very steep' },
  { min: 45, max: 90, color: '#7b1fa2', rgb: [123, 31, 162], label: '45°+  extreme' },
];
export const SLOPE_MIN_DEGREES = SLOPE_CLASSES[0].min;
/** The DEM is 10 m at best, so slope from coarser pixels is meaningless: only draw from here up. */
export const SLOPE_MIN_ZOOM = 12;
/** Past this the DEM has nothing more to give (~5 m per pixel), so MapLibre overzooms instead of asking for more. */
export const SLOPE_MAX_ZOOM = 15;

/**
 * ArcGIS raster-function chain: slope in degrees -> remap into class ids (anything under 27° becomes
 * NoData, i.e. transparent) -> colormap. Built from `SLOPE_CLASSES` so the legend cannot drift from the map.
 */
export function slopeRenderingRule() {
  return {
    rasterFunction: 'Colormap',
    rasterFunctionArguments: {
      Colormap: SLOPE_CLASSES.map((c, i) => [i + 1, ...c.rgb]),
      Raster: {
        rasterFunction: 'Remap',
        rasterFunctionArguments: {
          InputRanges: SLOPE_CLASSES.flatMap((c) => [c.min, c.max]),
          OutputValues: SLOPE_CLASSES.map((_, i) => i + 1),
          NoDataRanges: [0, SLOPE_MIN_DEGREES],
          Raster: { rasterFunction: 'Slope Degrees' },
        },
        variableName: 'Raster',
      },
    },
  };
}

// --- Land managers (BLM Surface Management Agency) -----------------------------------------

/**
 * BLM's cached National SMA tiles: federal (and some state/local) land colored by managing agency.
 * The "without PriUnk" build is a transparent PNG; the "with PriUnk" one is an opaque JPEG basemap.
 * Cached to z14 (404 past it), so MapLibre overzooms z14.
 */
export const LAND_MANAGER_TILE_URL =
  'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}';
export const LAND_MANAGER_MAX_ZOOM = 14;

/** The service's own legend colors (sampled from its legend swatches). */
export const LAND_MANAGER_LEGEND: LegendEntry[] = [
  { color: '#fee679', label: 'BLM' },
  { color: '#cbebc5', label: 'US Forest Service' },
  { color: '#cabddc', label: 'National Park Service' },
  { color: '#7fcca7', label: 'US Fish & Wildlife' },
  { color: '#ffffb3', label: 'Bureau of Reclamation' },
  { color: '#fdb46c', label: 'Bureau of Indian Affairs' },
  { color: '#fbb4ce', label: 'Dept. of Defense' },
  { color: '#e4c49f', label: 'Other federal' },
  { color: '#b3e3ee', label: 'State' },
  { color: '#8fb5be', label: 'Local' },
];

// --- Assembling the sources ---------------------------------------------------------------

/**
 * Time bucket for a refresh interval. It goes into the tile URL (as a cache-buster) and the source's
 * React key, so a new bucket both bypasses MapLibre's tile cache and remounts the source.
 */
export function refreshBucket(nowMs: number, intervalMs: number): number {
  return Math.floor(nowMs / intervalMs);
}

const ATTRIBUTIONS: Record<LiveRasterId, string> = {
  radar: 'NOAA / National Weather Service',
  nhd: 'USGS National Hydrography Dataset',
  wetlands: 'USFWS National Wetlands Inventory',
  slopeAngle: 'USGS 3DEP',
  landManager: 'BLM National SMA',
};

/** Static definitions; `liveRasterTiles` fills in the time-dependent URL. */
export const LIVE_RASTERS: Record<LiveRasterId, LiveRasterDef> = {
  radar: {
    id: 'radar',
    tiles: `${RADAR_EXPORT_URL}?${EXPORT_PARAMS}`,
    tileSize: 256,
    minzoom: 3,
    maxzoom: 9,
    attribution: ATTRIBUTIONS.radar,
    refreshMs: RADAR_REFRESH_MS,
  },
  nhd: {
    id: 'nhd',
    tiles: NHD_TILE_URL,
    tileSize: 256,
    minzoom: 0,
    maxzoom: NHD_MAX_ZOOM,
    attribution: ATTRIBUTIONS.nhd,
  },
  wetlands: {
    id: 'wetlands',
    tiles: `${WETLANDS_EXPORT_URL}?${EXPORT_PARAMS}`,
    tileSize: 256,
    minzoom: WETLANDS_MIN_ZOOM,
    maxzoom: 17,
    attribution: ATTRIBUTIONS.wetlands,
  },
  slopeAngle: {
    id: 'slopeAngle',
    tiles: `${SLOPE_EXPORT_URL}?bbox=${BBOX}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&f=image&renderingRule=${encodeURIComponent(
      JSON.stringify(slopeRenderingRule())
    )}`,
    tileSize: 256,
    minzoom: SLOPE_MIN_ZOOM,
    maxzoom: SLOPE_MAX_ZOOM,
    attribution: ATTRIBUTIONS.slopeAngle,
  },
  landManager: {
    id: 'landManager',
    tiles: LAND_MANAGER_TILE_URL,
    tileSize: 256,
    minzoom: 0,
    maxzoom: LAND_MANAGER_MAX_ZOOM,
    attribution: ATTRIBUTIONS.landManager,
  },
};

/** The tile URL(s) for a layer at `nowMs`: time-sensitive ones get the refresh bucket appended. */
export function liveRasterTiles(def: LiveRasterDef, nowMs: number): string[] {
  if (!def.refreshMs) return [def.tiles];
  const bucket = refreshBucket(nowMs, def.refreshMs);
  return [`${def.tiles}${def.tiles.includes('?') ? '&' : '?'}_t=${bucket}`];
}
