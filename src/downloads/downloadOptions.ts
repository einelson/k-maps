/**
 * What the Downloads screen can save, in words a person can choose between: the offline map pictures
 * (raster tiles) and the overlay data packs, with rough size and time so the screen can total them up.
 */

import { USGS_MAX_NATIVE_ZOOM } from '../map/usgsSources';
import type { PackLayerId } from '../packs/types';
import type { LayerId } from './types';

export const TILE_LAYER_OPTIONS: { id: LayerId; label: string; note: string }[] = [
  { id: 'topo', label: 'Topo', note: 'USGS topographic map' },
  { id: 'satellite', label: 'Satellite', note: 'Aerial photos' },
  { id: 'hybrid', label: 'Hybrid', note: 'Aerial photos with roads and labels' },
];

/** USGS tiles don't exist past z16 (they 404), so offering more would just spam the shared servers. */
export const DETAIL_OPTIONS: { zoom: number; label: string }[] = [
  { zoom: 14, label: 'Standard' },
  { zoom: 15, label: 'High' },
  { zoom: USGS_MAX_NATIVE_ZOOM, label: 'Maximum' },
];

export interface PackOption {
  id: PackLayerId;
  label: string;
  note: string;
  /** Typical size of one area's file. */
  estimateBytes: number;
  /** Typical time to fetch one area from the public services, on a phone. */
  estimateSeconds: number;
}

/** Vector overlay datasets fetched straight from their public services, one area at a time. */
export const PACK_OPTIONS: PackOption[] = [
  {
    id: 'land',
    label: 'Public land + private shading',
    note: 'USGS PAD-US federal, state and local land, plus the inferred "likely private" tint',
    estimateBytes: 300_000,
    estimateSeconds: 10,
  },
  {
    id: 'mvum',
    label: 'Forest roads (MVUM)',
    note: 'USFS motor vehicle use map — which roads your vehicle is allowed on',
    estimateBytes: 500_000,
    estimateSeconds: 2,
  },
  {
    id: 'trails',
    label: 'USFS trails',
    note: 'National Forest hiking, horse, bike and motorized trails',
    estimateBytes: 200_000,
    estimateSeconds: 2,
  },
  {
    id: 'poi',
    label: 'POI pins',
    note: 'Boat launches, campsites and trailheads from OpenStreetMap',
    estimateBytes: 60_000,
    estimateSeconds: 6,
  },
  {
    id: 'osm',
    label: 'Roads & trails (OSM)',
    note: 'OpenStreetMap roads, tracks and trails with names. Dense cities reach ~7 MB, and the free servers can be slow',
    estimateBytes: 4_000_000,
    estimateSeconds: 90,
  },
];

/** Display names for every layer that can show up in coverage, progress or storage lists. */
export const LAYER_LABELS: Record<string, string> = {
  ...Object.fromEntries(TILE_LAYER_OPTIONS.map((o) => [o.id, o.label])),
  ...Object.fromEntries(PACK_OPTIONS.map((o) => [o.id, o.label])),
};

export const packOption = (id: string): PackOption | undefined => PACK_OPTIONS.find((o) => o.id === id);
