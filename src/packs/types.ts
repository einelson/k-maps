import type { Feature, FeatureCollection, Geometry } from 'geojson';

import type { UsCoverage } from './usCoverage.ts';

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
  /**
   * Where the US is (src/packs/usCoverage.ts). When given, a fetch of a whole cell that holds no US land returns
   * nothing without touching the network, and in a cell that is only part US nothing outside the US is kept.
   * Left out, a fetch is unrestricted (an ad-hoc bbox, or a test).
   */
  us?: UsCoverage;
  /** Fraction complete, 0..1. Monotonic, always ends by reporting 1. */
  onProgress?: (fraction: number) => void;
}

export type PackFeature = Feature<Geometry, Record<string, unknown>>;
export type PackFeatureCollection = FeatureCollection<Geometry, Record<string, unknown>>;
