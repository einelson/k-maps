import { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { Feature, Polygon } from 'geojson';

import { blockBounds } from '../downloads/blockSelect';

export interface BlockCursor {
  bx: number;
  by: number;
  size: number;
}

/**
 * The block under the middle of the Downloads map — the one "Pick this square" acts on. A bold outline (a pale casing
 * under a dark line, so it shows on both the pale topo and the dark satellite maps) that follows the crosshair as
 * the map is panned.
 */
export function BlockCursorOverlay({ cursor }: { cursor: BlockCursor | null }) {
  const data = useMemo<Feature<Polygon> | null>(() => {
    if (!cursor) return null;
    const [west, south, east, north] = blockBounds(cursor.bx, cursor.by, cursor.size);
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
    };
  }, [cursor]);
  if (!data) return null;
  return (
    <GeoJSONSource id="download-block-cursor" data={data}>
      <Layer
        id="download-block-cursor-casing"
        type="line"
        source="download-block-cursor"
        paint={{ 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9 }}
      />
      <Layer
        id="download-block-cursor-line"
        type="line"
        source="download-block-cursor"
        paint={{ 'line-color': '#111827', 'line-width': 3 }}
      />
    </GeoJSONSource>
  );
}
