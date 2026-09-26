/**
 * Keeps pack data on US land. The app and the pack builders only deal in US territory, so a cell with no US land
 * is never fetched, and in a cell that is part US (coast, Canada, Mexico) points and lines outside the US are dropped.
 *
 * Pure (no native modules), shared by the on-device fetchers and the laptop pack builders.
 */

import type { Position } from 'geojson';

import type { LineGeometry } from './clip.ts';
import type { Bounds, PackFeature, PackFeatureCollection } from './types.ts';
import { cellOfBounds } from './usCoverage.ts';
import type { UsCoverage, UsLand } from './usCoverage.ts';

export interface UsRestriction {
  /** The cell holds no US land: don't fetch it at all. */
  skip: boolean;
  /** For a cell that is only part US: whether a point is on US land. Null when every point may stay. */
  contains: ((lon: number, lat: number) => boolean) | null;
}

const UNRESTRICTED: UsRestriction = { skip: false, contains: null };

/**
 * What the US limits mean for a fetch of `bounds`. Only a fetch of exactly one cell can be judged; any other box
 * (an ad-hoc bbox given to tools/fetch_pack.mjs) and any call without coverage data is left unrestricted.
 */
export function usRestriction(bounds: Bounds, us: UsCoverage | undefined): UsRestriction {
  if (!us) return UNRESTRICTED;
  const cell = cellOfBounds(bounds);
  if (!cell) return UNRESTRICTED;
  const status = us.status(cell.cx, cell.cy);
  if (status === 'outside') return { skip: true, contains: null };
  return status === 'inside' ? UNRESTRICTED : { skip: false, contains: (lon, lat) => us.contains(lon, lat) };
}

/** The US part of a coast / border cell being fetched, or undefined when the whole cell counts (or it can't be judged). */
export function usEdgeLand(bounds: Bounds, us: UsCoverage | undefined): UsLand | undefined {
  const cell = us ? cellOfBounds(bounds) : null;
  return (cell && us?.edgeLand(cell.cx, cell.cy)) || undefined;
}

export const emptyCollection = (): PackFeatureCollection => ({ type: 'FeatureCollection', features: [] });

/** A line cut into the runs whose vertices are all on US land; runs of fewer than two points vanish. */
function restrictLine(line: Position[], contains: (lon: number, lat: number) => boolean): Position[][] {
  const runs: Position[][] = [];
  let run: Position[] = [];
  for (const point of line) {
    if (contains(point[0], point[1])) {
      run.push(point);
    } else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/** Points outside the US are dropped; lines are cut where they leave it (judged by their vertices). */
export function restrictToUs(features: PackFeature[], contains: (lon: number, lat: number) => boolean): PackFeature[] {
  const out: PackFeature[] = [];
  for (const feature of features) {
    const g = feature.geometry;
    if (g.type === 'Point') {
      if (contains(g.coordinates[0], g.coordinates[1])) out.push(feature);
    } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
      const lines =
        (g as LineGeometry).type === 'LineString'
          ? [(g as { coordinates: Position[] }).coordinates]
          : (g as { coordinates: Position[][] }).coordinates;
      const runs = lines.flatMap((line) => restrictLine(line, contains));
      if (runs.length === 1) out.push({ ...feature, geometry: { type: 'LineString', coordinates: runs[0] } });
      else if (runs.length > 1) out.push({ ...feature, geometry: { type: 'MultiLineString', coordinates: runs } });
    } else {
      out.push(feature);
    }
  }
  return out;
}
