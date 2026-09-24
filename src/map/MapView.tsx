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

import { localRasterTileUrl } from '../downloads/mbtiles';
import { openDirections } from '../features/directions';
import {
  BLM_FILL_COLOR_EXPRESSION,
  BLM_PRIVATE_UNKNOWN_DATA,
  BLM_PRIVATE_UNKNOWN_META,
  blmAgencyLabel,
} from './blmSmaSource';
import {
  LAND_FILL_COLOR_EXPRESSION,
  PUBLIC_LAND_DATA,
  PUBLIC_LAND_META,
  PUB_ACCESS_COLORS,
  pubAccessLabel,
} from './landSource';
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

type Selected =
  | { kind: 'poi'; category: PoiCategory; name: string | null; lon: number; lat: number }
  | {
      kind: 'land';
      unitName: string | null;
      manager: string | null;
      ownerType: string | null;
      access: string | null;
      designation: string | null;
    }
  | { kind: 'blmSma'; agency: string };

export interface MapScreenMapProps {
  /** Forwards map taps as lon/lat — used for both drawing (MapScreen) and cell picking (DownloadsScreen). */
  onMapPress?: (lngLat: LngLat) => void;
  children?: ReactNode;
}

export function MapScreenMap({ onMapPress, children }: MapScreenMapProps = {}) {
  const baseMap = useLayersStore((s) => s.baseMap);
  const showUserLocation = useLayersStore((s) => s.showUserLocation);
  const landVisible = useLayersStore((s) => s.overlayVisibility.land);
  const landOpacity = useLayersStore((s) => s.overlayOpacity.land);
  const blmSmaVisible = useLayersStore((s) => s.overlayVisibility.blmSma);
  const blmSmaOpacity = useLayersStore((s) => s.overlayOpacity.blmSma);
  const useOfflineMaps = useLayersStore((s) => s.useOfflineMaps);
  const poiVisibility = usePoiStore((s) => s.visibility);
  const [selected, setSelected] = useState<Selected | null>(null);

  const tileUrl = useMemo(
    () => (useOfflineMaps ? localRasterTileUrl(baseMap) : BASE_MAP_TILE_URLS[baseMap]),
    [baseMap, useOfflineMaps]
  );

  const handlePress = onMapPress
    ? (event: { nativeEvent: PressEvent }) => onMapPress(event.nativeEvent.lngLat)
    : undefined;

  function handlePoiPress(category: PoiCategory) {
    return (event: { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      const feature = event.nativeEvent.features[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const [lon, lat] = (feature.geometry as Point).coordinates;
      setSelected({
        kind: 'poi',
        category,
        name: (feature.properties?.name as string | null) ?? null,
        lon,
        lat,
      });
    };
  }

  function handleLandPress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    const feature = event.nativeEvent.features[0];
    if (!feature) return;
    const p = feature.properties ?? {};
    setSelected({
      kind: 'land',
      unitName: (p.Unit_Nm as string | null) ?? null,
      manager: (p.Mang_Name as string | null) ?? (p.Mang_Type as string | null) ?? null,
      ownerType: (p.Own_Type as string | null) ?? null,
      access: pubAccessLabel(p.Pub_Access as string | undefined),
      designation: (p.Des_Tp as string | null) ?? null,
    });
  }

  function handleBlmSmaPress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    const feature = event.nativeEvent.features[0];
    if (!feature) return;
    setSelected({
      kind: 'blmSma',
      agency: blmAgencyLabel(feature.properties?.ADMIN_AGENCY_CODE as string | undefined),
    });
  }

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={EMPTY_STYLE} logo={false} onPress={handlePress}>
        <Camera initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} />

        {/* Keying on offline/online forces a remount instead of mutating the source's tiles in place —
            switching a live MapLibre source's tile URLs at runtime doesn't reliably refresh already-cached tiles. */}
        <RasterSource
          key={useOfflineMaps ? 'base-offline' : 'base-online'}
          id="base"
          tiles={[tileUrl]}
          tileSize={USGS_TILE_SIZE}
          minzoom={0}
          maxzoom={USGS_MAX_NATIVE_ZOOM}
          attribution={USGS_ATTRIBUTION}
        >
          <Layer id="base-layer" type="raster" source="base" />
        </RasterSource>

        <GeoJSONSource id="land" data={PUBLIC_LAND_DATA} onPress={handleLandPress}>
          <Layer
            id="land-fill-layer"
            type="fill"
            source="land"
            layout={{ visibility: landVisible ? 'visible' : 'none' }}
            paint={{ 'fill-color': LAND_FILL_COLOR_EXPRESSION, 'fill-opacity': landOpacity }}
          />
          <Layer
            id="land-outline-layer"
            type="line"
            source="land"
            filter={['!=', ['get', 'Pub_Access'], 'RA']}
            layout={{ visibility: landVisible ? 'visible' : 'none' }}
            paint={{ 'line-color': LAND_FILL_COLOR_EXPRESSION, 'line-width': 1.5 }}
          />
          <Layer
            id="land-outline-restricted-layer"
            type="line"
            source="land"
            filter={['==', ['get', 'Pub_Access'], 'RA']}
            layout={{ visibility: landVisible ? 'visible' : 'none' }}
            paint={{ 'line-color': PUB_ACCESS_COLORS.RA, 'line-width': 1.5, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="blm-sma" data={BLM_PRIVATE_UNKNOWN_DATA} onPress={handleBlmSmaPress}>
          <Layer
            id="blm-sma-fill-layer"
            type="fill"
            source="blm-sma"
            layout={{ visibility: blmSmaVisible ? 'visible' : 'none' }}
            paint={{ 'fill-color': BLM_FILL_COLOR_EXPRESSION, 'fill-opacity': blmSmaOpacity * 0.4 }}
          />
          <Layer
            id="blm-sma-outline-layer"
            type="line"
            source="blm-sma"
            layout={{ visibility: blmSmaVisible ? 'visible' : 'none' }}
            paint={{ 'line-color': BLM_FILL_COLOR_EXPRESSION, 'line-width': 1, 'line-dasharray': [1, 2] }}
          />
        </GeoJSONSource>

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

      {selected?.kind === 'poi' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.dot, { backgroundColor: POI_CATEGORY_META[selected.category].color }]} />
            <Text style={styles.cardEyebrow}>{POI_CATEGORY_META[selected.category].label}</Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.cardTitle}>{selected.name ?? 'Unnamed'}</Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => openDirections(selected.lat, selected.lon, selected.name)}
          >
            <Text style={styles.primaryButtonText}>Get Directions</Text>
          </Pressable>
        </View>
      )}

      {selected?.kind === 'land' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardEyebrow}>Public land</Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.cardTitle}>{selected.unitName ?? 'Unnamed unit'}</Text>
          <Text style={styles.cardRow}>Manager: {selected.manager ?? '—'}</Text>
          <Text style={styles.cardRow}>Owner type: {selected.ownerType ?? '—'}</Text>
          <Text style={styles.cardRow}>Access: {selected.access ?? '—'}</Text>
          <Text style={styles.cardRow}>Designation: {selected.designation ?? '—'}</Text>
          <Text style={styles.cardSource}>
            {PUBLIC_LAND_META.source} · fetched {PUBLIC_LAND_META.fetchedAt.slice(0, 10)}. For
            planning only — verify on the ground.
          </Text>
        </View>
      )}

      {selected?.kind === 'blmSma' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardEyebrow}>BLM cross-check</Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.cardTitle}>{selected.agency}</Text>
          <Text style={styles.cardRow}>
            Not classified as federal/state/local public land here — a second opinion on &ldquo;not
            public&rdquo;, not a parcel-level ownership record.
          </Text>
          <Text style={styles.cardSource}>
            {BLM_PRIVATE_UNKNOWN_META.source} · fetched{' '}
            {BLM_PRIVATE_UNKNOWN_META.fetchedAt.slice(0, 10)}.
          </Text>
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
  card: {
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardEyebrow: { flex: 1, fontSize: 12, color: '#666', textTransform: 'uppercase' },
  close: { fontSize: 16, color: '#888', paddingHorizontal: 4 },
  cardTitle: { fontSize: 17, fontWeight: '700', marginTop: 4 },
  cardRow: { fontSize: 13, color: '#444', marginTop: 4 },
  cardSource: { fontSize: 11, color: '#999', marginTop: 8 },
  primaryButton: {
    marginTop: 12,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryButtonText: { color: 'white', fontWeight: '700' },
});
