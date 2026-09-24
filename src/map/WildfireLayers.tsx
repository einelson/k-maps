import { GeoJSONSource, Layer, type PressEventWithFeatures } from '@maplibre/maplibre-react-native';
import type { FeatureCollection } from 'geojson';

import { useWildfireStore } from '../state/useWildfireStore';
import { TEXT_FONT } from './glyphs';
import { PACK_ANCHORS } from './PackLayers';
import { useWildfireRefresh } from './useWildfireRefresh';
import { WILDFIRE_FILL_EXPRESSION, WILDFIRE_OUTLINE_EXPRESSION } from './wildfireSource';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

interface WildfireLayersProps {
  visible: boolean;
  opacity: number;
  showLabels: boolean;
  onPress?: (event: { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void }) => void;
}

/**
 * NIFC wildfire perimeters: translucent fill + outline (prescribed burns in amber), fire names as
 * labels. Data comes from the wildfire store, which refreshes itself every 5 minutes while this is
 * mounted and visible, and falls back to the last copy saved on the device when offline.
 */
export function WildfireLayers({ visible, opacity, showLabels, onPress }: WildfireLayersProps) {
  useWildfireRefresh(visible);
  const collection = useWildfireStore((s) => s.collection);
  const vis = visible ? ('visible' as const) : ('none' as const);
  return (
    <GeoJSONSource id="wildfire" data={(collection as FeatureCollection | null) ?? EMPTY} onPress={onPress}>
      <Layer
        id="wildfire-fill"
        type="fill"
        source="wildfire"
        beforeId={PACK_ANCHORS.hazard}
        layout={{ visibility: vis }}
        paint={{ 'fill-color': WILDFIRE_FILL_EXPRESSION, 'fill-opacity': 0.35 * opacity }}
      />
      <Layer
        id="wildfire-outline"
        type="line"
        source="wildfire"
        beforeId={PACK_ANCHORS.hazard}
        layout={{ visibility: vis, 'line-join': 'round' }}
        paint={{ 'line-color': WILDFIRE_OUTLINE_EXPRESSION, 'line-width': 2, 'line-opacity': Math.max(0.4, opacity) }}
      />
      <Layer
        id="wildfire-labels"
        type="symbol"
        source="wildfire"
        beforeId={PACK_ANCHORS.hazard}
        minzoom={6}
        layout={{
          'text-field': ['get', 'name'] as never,
          'text-font': TEXT_FONT,
          'text-size': 12,
          'text-max-width': 8,
          'text-optional': true,
          visibility: visible && showLabels ? 'visible' : 'none',
        }}
        paint={{ 'text-color': '#7f1d1d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }}
      />
    </GeoJSONSource>
  );
}
