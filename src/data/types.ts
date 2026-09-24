export type FeatureType = 'point' | 'line' | 'polygon';
export type FeatureSource = 'manual' | 'imported' | 'track';

export interface Folder {
  id: number;
  name: string;
  color: string | null;
  parent_id: number | null;
  visible: number;
  sort: number;
}

export interface Feature {
  id: number;
  folder_id: number | null;
  type: FeatureType;
  name: string | null;
  notes: string | null;
  color: string | null;
  icon: string | null;
  /** GeoJSON geometry, stored as text. */
  geometry: string;
  min_lon: number | null;
  min_lat: number | null;
  max_lon: number | null;
  max_lat: number | null;
  length_m: number | null;
  area_m2: number | null;
  elevation_m: number | null;
  source: FeatureSource;
  created_at: number;
  updated_at: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
}

export interface Photo {
  id: number;
  feature_id: number;
  path: string;
}

export type CoverageStatus =
  | 'not_downloaded'
  | 'queued'
  | 'downloading'
  | 'complete'
  | 'partial'
  | 'failed';

export interface CoverageRow {
  layer: string;
  cell_x: number;
  cell_y: number;
  max_zoom: number;
  status: CoverageStatus;
  bytes: number;
  updated_at: number;
}
