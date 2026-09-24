import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  RasterSource,
  UserLocation,
  type LngLat,
  type PressEvent,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Point } from 'geojson';

import { openDirections } from '../features/directions';
import { POI_CATEGORY_META, POI_DATASETS, type PoiCategory } from './poiSources';
import { usePoiStore } from '../state/usePoiStore';
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

const POI_CATEGORIES = Object.keys(POI_CATEGORY_META) as PoiCategory[];

interface SelectedPoi {
  category: PoiCategory;
  name: string | null;
  lon: number;
  lat: number;
}

export interface MapScreenMapProps {
  /** Forwards map taps as lon/lat — used for both drawing (MapScreen) and cell picking (DownloadsScreen). */
  onMapPress?: (lngLat: LngLat) => void;
  children?: ReactNode;
}

export function MapScreenMap({ onMapPress, children }: MapScreenMapProps = {}) {
  const baseMap = useLayersStore((s) => s.baseMap);
  const showUserLocation = useLayersStore((s) => s.showUserLocation);
  const poiVisibility = usePoiStore((s) => s.visibility);
  const [selectedPoi, setSelectedPoi] = useState<SelectedPoi | null>(null);

  const tileUrl = useMemo(() => BASE_MAP_TILE_URLS[baseMap], [baseMap]);

  const handlePress = onMapPress
    ? (event: { nativeEvent: PressEvent }) => onMapPress(event.nativeEvent.lngLat)
    : undefined;

  function handlePoiPress(category: PoiCategory) {
    return (event: { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      const feature = event.nativeEvent.features[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const [lon, lat] = (feature.geometry as Point).coordinates;
      setSelectedPoi({
        category,
        name: (feature.properties?.name as string | null) ?? null,
        lon,
        lat,
      });
    };
  }

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

        {POI_CATEGORIES.map((category) => (
          <GeoJSONSource
            key={category}
            id={`poi-${category}`}
            data={POI_DATASETS[category]}
            onPress={handlePoiPress(category)}
          >
            <Layer
              id={`poi-${category}-layer`}
              type="circle"
              source={`poi-${category}`}
              layout={{ visibility: poiVisibility[category] ? 'visible' : 'none' }}
              paint={{
                'circle-radius': 6,
                'circle-color': POI_CATEGORY_META[category].color,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </GeoJSONSource>
        ))}

        {showUserLocation ? <UserLocation heading accuracy /> : null}

        {children}
      </Map>

      <View pointerEvents="none" style={styles.attribution}>
        <Text style={styles.attributionText}>{USGS_ATTRIBUTION}</Text>
      </View>

      {selectedPoi && (
        <View style={styles.poiCard}>
          <View style={styles.poiCardHeader}>
            <View
              style={[
                styles.poiDot,
                { backgroundColor: POI_CATEGORY_META[selectedPoi.category].color },
              ]}
            />
            <Text style={styles.poiCategory}>{POI_CATEGORY_META[selectedPoi.category].label}</Text>
            <Pressable onPress={() => setSelectedPoi(null)} hitSlop={12}>
              <Text style={styles.poiClose}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.poiName}>{selectedPoi.name ?? 'Unnamed'}</Text>
          <Pressable
            style={styles.directionsButton}
            onPress={() => openDirections(selectedPoi.lat, selectedPoi.lon, selectedPoi.name)}
          >
            <Text style={styles.directionsButtonText}>Get Directions</Text>
          </Pressable>
        </View>
      )}
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
  poiCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 100,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  poiCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  poiDot: { width: 10, height: 10, borderRadius: 5 },
  poiCategory: { flex: 1, fontSize: 12, color: '#666', textTransform: 'uppercase' },
  poiClose: { fontSize: 16, color: '#888', paddingHorizontal: 4 },
  poiName: { fontSize: 17, fontWeight: '700', marginTop: 4 },
  directionsButton: {
    marginTop: 12,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  directionsButtonText: { color: 'white', fontWeight: '700' },
});
