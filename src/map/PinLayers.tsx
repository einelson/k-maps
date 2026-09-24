import { GeoJSONSource, Images, Layer } from '@maplibre/maplibre-react-native';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, Point } from 'geojson';

import { DEFAULT_PIN_COLOR, type PinStyleId } from '../features/pinStyles';
import { MAP_PIN_IMAGES, PIN_BODY_IMAGE, PIN_GLYPH_IMAGE_PREFIX } from './pinImages';

/** Registers the pin artwork with the map style. Render once inside the map. */
export function PinImages() {
  return <Images images={MAP_PIN_IMAGES} />;
}

/** On-screen scale of the 64×80 artwork — about 35×44 dp. */
const PIN_ICON_SIZE = 0.55;

const COLOR = ['get', 'displayColor'] as unknown as string;
const GLYPH_IMAGE = ['concat', PIN_GLYPH_IMAGE_PREFIX, ['get', 'pinStyle']] as unknown as string;

const ICON_LAYOUT = {
  'icon-anchor': 'bottom',
  'icon-size': PIN_ICON_SIZE,
  // A pin is never hidden by a neighbour or a label; clustering (not collision) handles crowding.
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
} as const;

interface PinSymbolLayersProps {
  /** Layer id prefix. */
  id: string;
  source: string;
  filter?: FilterSpecification;
}

/**
 * A pin is two stacked symbol layers: the teardrop body, tinted with the feature's
 * `displayColor` and outlined in white, and the style glyph on top in white. Both read the
 * feature's `pinStyle` / `displayColor` properties, so one source can hold pins of any look.
 */
export function PinSymbolLayers({ id, source, filter }: PinSymbolLayersProps) {
  return (
    <>
      <Layer
        id={`${id}-body-layer`}
        type="symbol"
        source={source}
        filter={filter}
        layout={{ ...ICON_LAYOUT, 'icon-image': PIN_BODY_IMAGE }}
        paint={{ 'icon-color': COLOR, 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.5 }}
      />
      <Layer
        id={`${id}-glyph-layer`}
        type="symbol"
        source={source}
        filter={filter}
        layout={{ ...ICON_LAYOUT, 'icon-image': GLYPH_IMAGE }}
        paint={{ 'icon-color': '#ffffff' }}
      />
    </>
  );
}

interface PinDraftLayersProps {
  /** Where the not-yet-saved pin will go, or null for none. */
  lngLat: [number, number] | null;
  color?: string;
  style: PinStyleId;
}

/** The pin being created in the new-pin card, previewed live as its colour and style change. */
export function PinDraftLayers({ lngLat, color = DEFAULT_PIN_COLOR, style }: PinDraftLayersProps) {
  if (!lngLat) return null;
  const feature: Feature<Point> = {
    type: 'Feature',
    properties: { displayColor: color, pinStyle: style },
    geometry: { type: 'Point', coordinates: lngLat },
  };
  return (
    <GeoJSONSource id="pin-draft" data={feature}>
      <PinSymbolLayers id="pin-draft" source="pin-draft" />
    </GeoJSONSource>
  );
}
