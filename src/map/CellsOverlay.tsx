import { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { DataDrivenPropertyValueSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Polygon } from 'geojson';

import { cellBounds } from '../downloads/cells';

export type CellState = 'selected' | 'complete' | 'partial';

export interface CellOverlayEntry {
  cx: number;
  cy: number;
  state: CellState;
}

const STATE_COLORS: Record<CellState, string> = {
  selected: '#2f6f4f',
  complete: '#3b82f6',
  partial: '#f59e0b',
};

// Cast at the boundary, same reasoning as src/map/filterExpression.ts.
const COLOR_EXPRESSION = [
  'match',
  ['get', 'state'],
  'selected',
  STATE_COLORS.selected,
  'complete',
  STATE_COLORS.complete,
  STATE_COLORS.partial,
] as unknown as DataDrivenPropertyValueSpecification<string>;

const FILL_OPACITY_EXPRESSION = [
  'match',
  ['get', 'state'],
  'selected',
  0.3,
  0.12,
] as unknown as DataDrivenPropertyValueSpecification<number>;

/** The z10 download-cell grid state on the map (§4.3): picked cells, downloaded cells, partial cells. */
export function CellsOverlay({ cells }: { cells: CellOverlayEntry[] }) {
  const data = useMemo<FeatureCollection<Polygon, { state: CellState }>>(
    () => ({
      type: 'FeatureCollection',
      features: cells.map(({ cx, cy, state }): Feature<Polygon, { state: CellState }> => {
        const [west, south, east, north] = cellBounds(cx, cy);
        return {
          type: 'Feature',
          properties: { state },
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
      }),
    }),
    [cells]
  );

  return (
    <GeoJSONSource id="download-cells" data={data}>
      <Layer
        id="download-cells-fill-layer"
        type="fill"
        source="download-cells"
        paint={{ 'fill-color': COLOR_EXPRESSION, 'fill-opacity': FILL_OPACITY_EXPRESSION }}
      />
      <Layer
        id="download-cells-outline-layer"
        type="line"
        source="download-cells"
        paint={{ 'line-color': COLOR_EXPRESSION, 'line-width': 2 }}
      />
    </GeoJSONSource>
  );
}
