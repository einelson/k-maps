import { GeoJSONSource, Layer, type PressEventWithFeatures } from '@maplibre/maplibre-react-native';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';

import type { HuntStateInfo } from '../huntUnits/types';
import { TEXT_FONT } from './glyphs';
import { HUNT_UNIT_COLOR } from './huntUnitsStyle';
import { PACK_ANCHORS } from './PackLayers';

/** One state's units to draw: the `file://` URI of a downloaded state, and which unit set to show. */
export interface HuntUnitSource {
  state: HuntStateInfo;
  data: string;
  activeSet: string;
}

export type HuntUnitPressEvent = { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void };

interface HuntUnitLayersProps {
  sources: HuntUnitSource[];
  visible: boolean;
  opacity: number;
  showLabels: boolean;
  /** Called with the state whose boundary was tapped. */
  onPress?: (state: HuntStateInfo, event: HuntUnitPressEvent) => void;
}

const setFilter = (setId: string) => ['==', ['get', 'set'], setId] as unknown as FilterSpecification;

/**
 * Hunting unit boundaries and unit numbers, for every downloaded state mounted. Each state's
 * units carry a `set` (species / layer) and only the chosen set is drawn, so states that publish separate elk and deer
 * areas don't overlay both. Deliberately outline-only: MapLibre sends a tap to the topmost interactive source, so a
 * full-coverage fill here would swallow every tap meant for the public-land polygons underneath. The dashed boundary
 * and the unit label are the tap targets.
 */
export function HuntUnitLayers({ sources, visible, opacity, showLabels, onPress }: HuntUnitLayersProps) {
  const vis = visible ? ('visible' as const) : ('none' as const);
  return (
    <>
      {sources.map(({ state, data, activeSet }) => {
        const id = `hunt-units-${state.state}`;
        const filter = setFilter(activeSet);
        return (
          <GeoJSONSource key={id} id={id} data={data} onPress={onPress ? (event) => onPress(state, event) : undefined}>
            <Layer
              id={`${id}-casing`}
              type="line"
              source={id}
              beforeId={PACK_ANCHORS.hunt}
              filter={filter}
              layout={{ visibility: vis }}
              paint={{ 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.5 * opacity }}
            />
            <Layer
              id={`${id}-line`}
              type="line"
              source={id}
              beforeId={PACK_ANCHORS.hunt}
              filter={filter}
              layout={{ visibility: vis }}
              paint={{
                'line-color': HUNT_UNIT_COLOR,
                'line-width': 2,
                'line-opacity': opacity,
                'line-dasharray': [4, 2],
              }}
            />
            <Layer
              id={`${id}-labels`}
              type="symbol"
              source={id}
              beforeId={PACK_ANCHORS.hunt}
              filter={filter}
              minzoom={7}
              layout={{
                'text-field': ['get', 'unit'] as never,
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
      })}
    </>
  );
}
