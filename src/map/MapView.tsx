import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  Layer,
  Map,
  RasterSource,
  UserLocation,
  type LngLat,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

import { useLayersStore } from '../state/useLayersStore';
import {
  BASE_MAP_TILE_URLS,
  USGS_ATTRIBUTION,
  USGS_MAX_NATIVE_ZOOM,
  USGS_TILE_SIZE,
} from './usgsSources';

/** Southwest Idaho — the spec's suggested first region (§10): frequent BLM/USFS-to-private boundaries. */
const DEFAULT_CENTER: LngLat = [-116.2, 43.6];
const DEFAULT_ZOOM = 10;

/** No vector style of our own yet — base raster layers are added declaratively as children below. */
const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

export interface MapScreenMapProps {
  /** Forwards map taps as lon/lat — used for both drawing (MapScreen) and cell picking (DownloadsScreen). */
  onMapPress?: (lngLat: LngLat) => void;
  children?: ReactNode;
}

export function MapScreenMap({ onMapPress, children }: MapScreenMapProps = {}) {
  const baseMap = useLayersStore((s) => s.baseMap);
  const showUserLocation = useLayersStore((s) => s.showUserLocation);

  const tileUrl = useMemo(() => BASE_MAP_TILE_URLS[baseMap], [baseMap]);

  const handlePress = onMapPress
    ? (event: { nativeEvent: PressEvent }) => onMapPress(event.nativeEvent.lngLat)
    : undefined;

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={EMPTY_STYLE} logo={false} onPress={handlePress}>
        <Camera initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} />

        <RasterSource
          id="base"
          tiles={[tileUrl]}
          tileSize={USGS_TILE_SIZE}
          minzoom={0}
          maxzoom={USGS_MAX_NATIVE_ZOOM}
          attribution={USGS_ATTRIBUTION}
        >
          <Layer id="base-layer" type="raster" source="base" />
        </RasterSource>

        {showUserLocation ? <UserLocation heading accuracy /> : null}

        {children}
      </Map>

      <View pointerEvents="none" style={styles.attribution}>
        <Text style={styles.attributionText}>{USGS_ATTRIBUTION}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  attribution: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  attributionText: { fontSize: 10, color: '#333' },
});
