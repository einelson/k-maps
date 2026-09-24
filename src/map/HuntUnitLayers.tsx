import { GeoJSONSource, Layer, type PressEventWithFeatures } from '@maplibre/maplibre-react-native';

import { TEXT_FONT } from './glyphs';
import { HUNT_UNITS_DATA } from './huntUnitsSource';
import { HUNT_UNIT_COLOR } from './huntUnitsStyle';
import { PACK_ANCHORS } from './PackLayers';

interface HuntUnitLayersProps {
  visible: boolean;
  opacity: number;
  showLabels: boolean;
  onPress?: (event: { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void }) => void;
}

/**
 * Idaho hunt unit boundaries and numbers. Deliberately outline-only: MapLibre sends a tap to the
 * topmost interactive source, so a full-coverage fill here would swallow every tap meant for the
 * public-land polygons underneath. The dashed boundary and the unit number are the tap targets.
 */
export function HuntUnitLayers({ visible, opacity, showLabels, onPress }: HuntUnitLayersProps) {
  const vis = visible ? ('visible' as const) : ('none' as const);
  return (
    <GeoJSONSource id="hunt-units" data={HUNT_UNITS_DATA} onPress={onPress}>
      <Layer
        id="hunt-units-casing"
        type="line"
        source="hunt-units"
        beforeId={PACK_ANCHORS.hunt}
        layout={{ visibility: vis }}
        paint={{ 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.5 * opacity }}
      />
      <Layer
        id="hunt-units-line"
        type="line"
        source="hunt-units"
        beforeId={PACK_ANCHORS.hunt}
        layout={{ visibility: vis }}
        paint={{
          'line-color': HUNT_UNIT_COLOR,
          'line-width': 2,
          'line-opacity': opacity,
          'line-dasharray': [4, 2],
        }}
      />
      <Layer
        id="hunt-units-labels"
        type="symbol"
        source="hunt-units"
        beforeId={PACK_ANCHORS.hunt}
        minzoom={7}
        layout={{
          'text-field': ['get', 'label'] as never,
          'text-font': TEXT_FONT,
          'text-size': 13,
          'text-max-width': 6,
          visibility: visible && showLabels ? 'visible' : 'none',
        }}
        paint={{
          'text-color': HUNT_UNIT_COLOR,
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
          'text-opacity': opacity,
        }}
      />
    </GeoJSONSource>
  );
}
