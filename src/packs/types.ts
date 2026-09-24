import type { Feature, FeatureCollection, Geometry } from 'geojson';

/**
 * Downloadable vector "packs", one file per z10 cell per layer (see
 * src/downloads/cells.ts). `land`, `mvum` and `poi` also ship bundled for the
 * starter region (src/packs/region.ts); `osm` and `trails` are download-only.
 */
export type PackLayerId = 'land' | 'mvum' | 'trails' | 'poi' | 'osm';

export const PACK_LAYER_IDS: readonly PackLayerId[] = ['land', 'mvum', 'trails', 'poi', 'osm'];

/** [west, south, east, north] in EPSG:4326. */
export type Bounds = [number, number, number, number];

export interface PackContext {
  signal?: AbortSignal;
  /** Fraction complete, 0..1. Monotonic, always ends by reporting 1. */
  onProgress?: (fraction: number) => void;
}

export type PackFeature = Feature<Geometry, Record<string, unknown>>;
export type PackFeatureCollection = FeatureCollection<Geometry, Record<string, unknown>>;
