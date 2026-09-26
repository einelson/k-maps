import { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

import { blockGridLines } from '../downloads/blockSelect';

export interface BlockGridRange {
  size: number;
  bxMin: number;
  bxMax: number;
  byMin: number;
  byMax: number;
}

/**
 * The grid a tap on the Downloads map picks from: faint dashed lines around each block, so before touching
 * anything you can see what one tap will select (and watch the squares grow as you zoom out).
 */
export function BlockGridOverlay({ grid }: { grid: BlockGridRange | null }) {
  const data = useMemo(() => (grid ? blockGridLines(grid, grid.size) : null), [grid]);
  if (!data) return null;
  return (
    <GeoJSONSource id="download-block-grid" data={data}>
      <Layer
        id="download-block-grid-layer"
        type="line"
        source="download-block-grid"
        paint={{ 'line-color': '#1f2937', 'line-opacity': 0.55, 'line-width': 1, 'line-dasharray': [3, 3] }}
      />
    </GeoJSONSource>
  );
}
