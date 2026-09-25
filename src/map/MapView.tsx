import { useCallback, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  RasterSource,
  UserLocation,
  type CameraRef,
  type LngLat,
  type MapRef,
  type PressEvent,
  type PressEventWithFeatures,
  type ViewState,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection, Point } from 'geojson';

import { localRasterTileUrl } from '../downloads/mbtiles';
import { huntUnitsExist, huntUnitsUri } from '../huntUnits/storage';
import type { HuntStateInfo } from '../huntUnits/types';
import type { PackLayerId } from '../packs/types';
import { useAutoLoadStore } from '../state/useAutoLoadStore';
import { resolveActiveSet, useHuntUnitStore } from '../state/useHuntUnitStore';
import { useWildfireStore } from '../state/useWildfireStore';
import { Text, useThemedStyles, type ThemeColors } from '../theme';
import { openDirections } from '../features/directions';
import {
  BLM_FILL_COLOR_EXPRESSION,
  BLM_PRIVATE_UNKNOWN_DATA,
  BLM_PRIVATE_UNKNOWN_META,
  blmAgencyLabel,
} from './blmSmaSource';
import { PUBLIC_LAND_DATA, PUBLIC_LAND_META, pubAccessLabel } from './landSource';
import { MVUM_CLASS_LABELS, MVUM_DATA, MVUM_META, mvumVehicleClass } from './mvumSource';
import { ensureGlyphs, GLYPHS_URL_TEMPLATE } from './glyphs';
import { BASE_MAPS, mapAttribution } from './layerOptions';
import { HuntUnitLayers, type HuntUnitPressEvent, type HuntUnitSource } from './HuntUnitLayers';
import { huntStatesInView } from './huntUnitWindow';
import { huntUnitDisclaimer, huntUnitSourceNote } from './huntUnitsStyle';
import { acceptanceFor, staleWarningFor, unacceptedStale } from './huntUnitStaleness';
import { IDAHO_HUNT_STATE, IDAHO_UNITS_DATA } from './huntUnitsSource';
import { HuntUnitDisclaimerModal } from '../screens/components/HuntUnitDisclaimerModal';
import { LiveRasterLayers } from './LiveRasterLayers';
import { PinImages } from './PinLayers';
import {
  LandLayers,
  MvumLayers,
  OsmLayers,
  PACK_ANCHORS,
  PackAnchors,
  PoiLayers,
  TrailsLayers,
  usePackCells,
} from './PackLayers';
import { pickWindowCells } from './cellWindow';
import { TRAIL_CLASS_LABELS } from './trailsSource';
import { useAutoPackLoader } from './useAutoPackLoader';
import { useCellWindow } from './useCellWindow';
import { WildfireLayers } from './WildfireLayers';
import { formatAcres, formatAge, formatContainment, formatDate, wildfireCategoryLabel } from './wildfireSource';
import { POI_CATEGORY_META, POI_DATASETS, type PoiCategory } from './poiSources';
import { usePoiStore } from '../state/usePoiStore';
import { useLayersStore } from '../state/useLayersStore';
import {
  BASE_MAP_TILE_URLS,
  MAP_MAX_ZOOM,
  USGS_ATTRIBUTION,
  USGS_MAX_NATIVE_ZOOM,
  USGS_SHADED_RELIEF_MAX_ZOOM,
  USGS_SHADED_RELIEF_TILE_URL,
  USGS_TILE_SIZE,
} from './usgsSources';

/** Southwest Idaho — the spec's suggested first region (§10): frequent BLM/USFS-to-private boundaries. */
export const DEFAULT_CENTER: LngLat = [-116.2, 43.6];
export const DEFAULT_ZOOM = 10;

// Label glyphs are written to disk before the first map renders; the style then points at them.
ensureGlyphs();

/** No vector basemap of our own — raster layers are added declaratively as children below. `glyphs` is what lets text labels draw offline. */
const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS_URL_TEMPLATE,
  sources: {},
  layers: [],
};

/**
 * Invisible layer that sits at the very bottom of the stack. Base map layers are inserted just above
 * it (`afterId`), so a base map source that gets (re)mounted later still lands *under* land, roads
 * and pins — a layer with no position is added on top of everything.
 */
const BASE_ANCHOR = 'anchor-base';

/** Both bundled POI datasets as one collection (each feature carries its `category`). */
const BUNDLED_POI_DATA: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: Object.values(POI_DATASETS).flatMap((dataset) => dataset.features),
};

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
  | { kind: 'likelyPrivate' }
  | { kind: 'blmSma'; agency: string }
  | { kind: 'mvum'; name: string | null; symbolName: string | null; vehicleClass: string; miles: number | null }
  | {
      kind: 'trail';
      name: string | null;
      trailNo: string | null;
      trailClass: string;
      uses: string | null;
      surface: string | null;
      width: string | null;
      miles: number | null;
    }
  | {
      kind: 'huntUnit';
      state: HuntStateInfo;
      setId: string;
      setLabel: string;
      title: string;
      note: string | null;
      url: string | null;
      urlLabel: string | null;
      url2: string | null;
      url2Label: string | null;
    }
  | {
      kind: 'wildfire';
      name: string;
      category: string;
      acres: number | null;
      containment: number | null;
      discovered: number | null;
      updated: number | null;
      place: string | null;
      description: string | null;
      cause: string | null;
      /** When the perimeter data on screen was fetched (may be old when offline). */
      fetchedAt: number | null;
    };

export interface MapScreenMapProps {
  /** Forwards map taps as lon/lat — used for both drawing (MapScreen) and cell picking (DownloadsScreen). */
  onMapPress?: (lngLat: LngLat) => void;
  /** Long-press on empty map, as lon/lat — MapScreen uses it to drop a pin right where the finger is. */
  onMapLongPress?: (lngLat: LngLat) => void;
  /**
   * Whether taps on land/MVUM/BLM/POI features open their info cards. Turn off while taps mean
   * something else (placing a vertex, picking a download cell) — otherwise a tap on public land,
   * which covers most of the map, would open a card and never reach `onMapPress`.
   */
  overlayPressEnabled?: boolean;
  /** Fires when the camera settles — used for the coordinate readout. */
  onViewStateChange?: (viewState: ViewState) => void;
  /**
   * Fetch land / MVUM / USFS-trail data for the cells in view as the camera moves (Layers ->
   * "Load data as I pan"). Off by default: the Downloads screen's map is for picking cells by hand.
   */
  autoLoad?: boolean;
  /** Distance of the native scale bar from the bottom edge, to clear whatever the host screen puts there. */
  scaleBarBottom?: number;
  /** Distance of the compass from the top edge, to clear whatever buttons the host screen floats there. */
  compassTop?: number;
  /** Imperative handles for screens that move the camera or project coordinates. */
  cameraRef?: Ref<CameraRef>;
  mapRef?: Ref<MapRef>;
  children?: ReactNode;
}

/** Sets a ref of either kind — lets one element feed both our own ref and the one a parent passed in. */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

export function MapScreenMap({
  onMapPress,
  onMapLongPress,
  overlayPressEnabled = true,
  onViewStateChange,
  autoLoad = false,
  scaleBarBottom = 30,
  compassTop = 56,
  cameraRef,
  mapRef,
  children,
}: MapScreenMapProps = {}) {
  const styles = useThemedStyles(makeStyles);
  const baseMap = useLayersStore((s) => s.baseMap);
  const showUserLocation = useLayersStore((s) => s.showUserLocation);
  const landVisible = useLayersStore((s) => s.overlayVisibility.land);
  const landOpacity = useLayersStore((s) => s.overlayOpacity.land);
  const blmSmaVisible = useLayersStore((s) => s.overlayVisibility.blmSma);
  const blmSmaOpacity = useLayersStore((s) => s.overlayOpacity.blmSma);
  const mvumVisible = useLayersStore((s) => s.overlayVisibility.mvum);
  const mvumOpacity = useLayersStore((s) => s.overlayOpacity.mvum);
  const reliefVisible = useLayersStore((s) => s.overlayVisibility.shadedRelief);
  const reliefOpacity = useLayersStore((s) => s.overlayOpacity.shadedRelief);
  const privateVisible = useLayersStore((s) => s.overlayVisibility.likelyPrivate);
  const privateOpacity = useLayersStore((s) => s.overlayOpacity.likelyPrivate);
  const osmVisible = useLayersStore((s) => s.overlayVisibility.osm);
  const osmOpacity = useLayersStore((s) => s.overlayOpacity.osm);
  const overlayVisibility = useLayersStore((s) => s.overlayVisibility);
  const overlayOpacity = useLayersStore((s) => s.overlayOpacity);
  const autoLoadSetting = useLayersStore((s) => s.autoLoadOverlays);
  const showLabels = useLayersStore((s) => s.showLabels);
  const useOfflineMaps = useLayersStore((s) => s.useOfflineMaps);
  const poiVisibility = usePoiStore((s) => s.visibility);
  const [selected, setSelected] = useState<Selected | null>(null);
  const packCells = usePackCells();
  // Only the downloaded cells in (or next to) the view are mounted: a region pack can install hundreds,
  // and every mounted cell is a source plus several style layers.
  const { cellWindow, viewBox, updateCellWindow } = useCellWindow();
  const mountedPackCells = useMemo(() => pickWindowCells(packCells, cellWindow), [packCells, cellWindow]);
  // Hunting units: Idaho is bundled and always mounted; downloaded states mount only when the layer is on and
  // their area is in view (each is a source plus layers, and all fifty can be downloaded).
  const huntVisible = useLayersStore((s) => s.overlayVisibility.huntUnits);
  const setOverlayVisible = useLayersStore((s) => s.setOverlayVisible);
  const huntDisclaimerAccepted = useHuntUnitStore((s) => s.disclaimerAccepted);
  const acceptHuntDisclaimer = useHuntUnitStore((s) => s.acceptDisclaimer);
  const staleAccepted = useHuntUnitStore((s) => s.staleAccepted);
  const acceptStale = useHuntUnitStore((s) => s.acceptStale);
  const installedHunt = useHuntUnitStore((s) => s.installed);
  const huntActiveSets = useHuntUnitStore((s) => s.activeSets);
  const huntSources = useMemo<HuntUnitSource[]>(() => {
    const sources: HuntUnitSource[] = [
      { state: IDAHO_HUNT_STATE, data: IDAHO_UNITS_DATA, activeSet: resolveActiveSet(IDAHO_HUNT_STATE, undefined) },
    ];
    if (!huntVisible) return sources;
    for (const info of huntStatesInView(Object.values(installedHunt), viewBox)) {
      if (info.state === IDAHO_HUNT_STATE.state || !huntUnitsExist(info.state)) continue; // a cleared cache leaves a stale record
      sources.push({ state: info, data: huntUnitsUri(info.state), activeSet: resolveActiveSet(info, huntActiveSets[info.state]) });
    }
    return sources;
  }, [huntVisible, installedHunt, huntActiveSets, viewBox]);
  // Layers whose source data is 3+ years old must be accepted before they're used — including ones downloaded earlier
  // that have since aged past the line, and bundled Idaho.
  const huntInfos = useMemo(() => [IDAHO_HUNT_STATE, ...Object.values(installedHunt)], [installedHunt]);
  const staleUnaccepted = useMemo(() => unacceptedStale(huntInfos, staleAccepted), [huntInfos, staleAccepted]);
  const innerMapRef = useRef<MapRef | null>(null);
  const setMapRef = useCallback(
    (instance: MapRef | null) => {
      assignRef(innerMapRef, instance);
      assignRef(mapRef, instance);
    },
    [mapRef]
  );

  // Which per-cell packs the on-screen overlays need, for the "load as I pan" loader.
  const wantedPacks = useMemo<PackLayerId[]>(() => {
    const wanted: PackLayerId[] = [];
    if (overlayVisibility.land || overlayVisibility.likelyPrivate) wanted.push('land');
    if (overlayVisibility.mvum) wanted.push('mvum');
    if (overlayVisibility.usfsTrails) wanted.push('trails');
    return wanted;
  }, [overlayVisibility.land, overlayVisibility.likelyPrivate, overlayVisibility.mvum, overlayVisibility.usfsTrails]);
  const onAutoLoadView = useAutoPackLoader({ enabled: autoLoad && autoLoadSetting, layers: wantedPacks });

  // A card left open would be stale (and unreachable) once taps stop opening cards, so drop it
  // when they're switched off. (Adjusting state during render, not in an effect.)
  const [prevOverlayPressEnabled, setPrevOverlayPressEnabled] = useState(overlayPressEnabled);
  if (prevOverlayPressEnabled !== overlayPressEnabled) {
    setPrevOverlayPressEnabled(overlayPressEnabled);
    if (!overlayPressEnabled) setSelected(null);
  }

  const handlePress = onMapPress
    ? (event: { nativeEvent: PressEvent }) => onMapPress(event.nativeEvent.lngLat)
    : undefined;

  const handleLongPress = onMapLongPress
    ? (event: { nativeEvent: PressEvent }) => onMapLongPress(event.nativeEvent.lngLat)
    : undefined;

  function handlePoiPress(event: { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void }) {
    event.stopPropagation?.();
    const feature = event.nativeEvent.features[0];
    if (!feature || feature.geometry.type !== 'Point') return;
    const category = feature.properties?.category as PoiCategory | undefined;
    if (!category || !(category in POI_CATEGORY_META)) return;
    const [lon, lat] = (feature.geometry as Point).coordinates;
    setSelected({
      kind: 'poi',
      category,
      name: (feature.properties?.name as string | null) ?? null,
      lon,
      lat,
    });
  }

  function handleLandPress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    // The source also serves outline linework, which isn't a tappable "area".
    const features = event.nativeEvent.features;
    const publicLand = features.find((feature) => feature.properties?.kind === 'public');
    if (!publicLand) {
      if (features.some((feature) => feature.properties?.kind === 'private')) {
        setSelected({ kind: 'likelyPrivate' });
      }
      return;
    }
    const p = publicLand.properties ?? {};
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

  function handleMvumPress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    const feature = event.nativeEvent.features[0];
    if (!feature) return;
    const p = feature.properties ?? {};
    setSelected({
      kind: 'mvum',
      name: (p.name as string | null) ?? null,
      symbolName: (p.mvum_symbol_name as string | null) ?? null,
      vehicleClass: MVUM_CLASS_LABELS[mvumVehicleClass(p)],
      miles: (p.gis_miles as number | null) ?? null,
    });
  }

  function handleTrailPress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    const p = event.nativeEvent.features[0]?.properties;
    if (!p) return;
    setSelected({
      kind: 'trail',
      name: (p.name as string | null) ?? null,
      trailNo: (p.trail_no as string | null) ?? null,
      trailClass: TRAIL_CLASS_LABELS[p.trailClass === 'motorized' ? 'motorized' : 'nonmotorized'],
      uses: (p.uses as string | null) ?? null,
      surface: (p.surface as string | null) ?? null,
      width: (p.width as string | null) ?? null,
      miles: (p.miles as number | null) ?? null,
    });
  }

  function handleHuntUnitPress(state: HuntStateInfo, event: HuntUnitPressEvent) {
    event.stopPropagation?.();
    const p = event.nativeEvent.features[0]?.properties;
    if (!p || typeof p.title !== 'string') return;
    const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
    setSelected({
      kind: 'huntUnit',
      state,
      setId: typeof p.set === 'string' ? p.set : '',
      setLabel: state.sets.find((set) => set.id === p.set)?.label ?? 'Hunting units',
      title: p.title,
      note: str(p.note),
      url: str(p.url),
      urlLabel: str(p.urlLabel),
      url2: str(p.url2),
      url2Label: str(p.url2Label),
    });
  }

  function handleWildfirePress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    const p = event.nativeEvent.features[0]?.properties;
    if (!p) return;
    const county = (p.county as string | null) ?? null;
    const state = (p.state as string | null) ?? null;
    setSelected({
      kind: 'wildfire',
      name: (p.name as string | null) ?? 'Unnamed fire',
      category: (p.category as string | null) ?? 'WF',
      acres: (p.acres as number | null) ?? null,
      containment: (p.containment as number | null) ?? null,
      discovered: (p.discovered as number | null) ?? null,
      updated: (p.updated as number | null) ?? null,
      place: county && state ? `${county} County, ${state}` : (state ?? county),
      description: (p.description as string | null) ?? null,
      cause: (p.cause as string | null) ?? null,
      fetchedAt: useWildfireStore.getState().fetchedAt,
    });
  }

  return (
    <View style={styles.container}>
      <Map
        ref={setMapRef}
        style={styles.map}
        mapStyle={EMPTY_STYLE}
        logo={false}
        compass
        compassPosition={{ top: compassTop, right: 12 }}
        scaleBar
        scaleBarPosition={{ bottom: scaleBarBottom, left: 12 }}
        onPress={handlePress}
        onLongPress={handleLongPress}
        onDidFinishLoadingMap={() => {
          // The first region-change event isn't guaranteed to fire for the initial camera, so ask for the view.
          innerMapRef.current
            ?.getViewState()
            .then(updateCellWindow)
            .catch((err) => console.warn('Could not read the initial map view', err));
        }}
        onRegionDidChange={(event) => {
          updateCellWindow(event.nativeEvent);
          onAutoLoadView(event.nativeEvent);
          onViewStateChange?.(event.nativeEvent);
        }}
      >
        <Camera ref={cameraRef} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} maxZoom={MAP_MAX_ZOOM} />

        <Layer id={BASE_ANCHOR} type="background" layout={{ visibility: 'none' }} />

        {/* One source per base map, with only the selected one's layer visible: MapLibre only fetches tiles
            for a source with a visible layer, and — unlike a source's `tiles` prop, which is read once when
            the native source is created — layer visibility updates live. Keying on offline/online remounts
            them, because switching a live source's tile URLs doesn't reliably refresh cached tiles. */}
        {BASE_MAPS.map((mode) => {
          const sourceId = `base-${mode.id}-${useOfflineMaps ? 'offline' : 'online'}`;
          return (
            <RasterSource
              key={sourceId}
              id={sourceId}
              tiles={[useOfflineMaps ? localRasterTileUrl(mode.id) : BASE_MAP_TILE_URLS[mode.id]]}
              tileSize={USGS_TILE_SIZE}
              minzoom={0}
              maxzoom={USGS_MAX_NATIVE_ZOOM}
              attribution={USGS_ATTRIBUTION}
            >
              <Layer
                id={`${sourceId}-layer`}
                type="raster"
                source={sourceId}
                afterId={BASE_ANCHOR}
                layout={{ visibility: baseMap === mode.id ? 'visible' : 'none' }}
              />
            </RasterSource>
          );
        })}

        {/* Live-only: USGS relief isn't in the downloader, so it's hidden while rendering from downloaded maps. */}
        <RasterSource
          id="shaded-relief"
          tiles={[USGS_SHADED_RELIEF_TILE_URL]}
          tileSize={USGS_TILE_SIZE}
          minzoom={0}
          maxzoom={USGS_SHADED_RELIEF_MAX_ZOOM}
          attribution={USGS_ATTRIBUTION}
        >
          <Layer
            id="shaded-relief-layer"
            type="raster"
            source="shaded-relief"
            layout={{ visibility: reliefVisible && !useOfflineMaps ? 'visible' : 'none' }}
            paint={{ 'raster-opacity': reliefOpacity }}
          />
        </RasterSource>

        <PackAnchors />

        {/* Online-only rasters (land managers, slope, wetlands, water) sit under the land layers; radar sits with the hazards. */}
        <LiveRasterLayers visibility={overlayVisibility} opacity={overlayOpacity} />

        {/* Bundled starter region first, then every downloaded cell — all drawn by the same layer set. */}
        <LandLayers
          id="land"
          data={PUBLIC_LAND_DATA}
          landVisible={landVisible}
          landOpacity={landOpacity}
          privateVisible={privateVisible}
          privateOpacity={privateOpacity}
          onPress={overlayPressEnabled ? handleLandPress : undefined}
        />
        {mountedPackCells
          .filter((cell) => cell.layer === 'land')
          .map((cell) => (
            <LandLayers
              key={`land-${cell.cx}-${cell.cy}`}
              id={`land-${cell.cx}-${cell.cy}`}
              data={cell.uri}
              landVisible={landVisible}
              landOpacity={landOpacity}
              privateVisible={privateVisible}
              privateOpacity={privateOpacity}
              onPress={overlayPressEnabled ? handleLandPress : undefined}
            />
          ))}

        <GeoJSONSource
          id="blm-sma"
          data={BLM_PRIVATE_UNKNOWN_DATA}
          onPress={overlayPressEnabled ? handleBlmSmaPress : undefined}
        >
          <Layer
            id="blm-sma-fill-layer"
            type="fill"
            source="blm-sma"
            beforeId={PACK_ANCHORS.osm}
            layout={{ visibility: blmSmaVisible ? 'visible' : 'none' }}
            paint={{ 'fill-color': BLM_FILL_COLOR_EXPRESSION, 'fill-opacity': blmSmaOpacity * 0.4 }}
          />
          <Layer
            id="blm-sma-outline-layer"
            type="line"
            source="blm-sma"
            beforeId={PACK_ANCHORS.osm}
            layout={{ visibility: blmSmaVisible ? 'visible' : 'none' }}
            paint={{ 'line-color': BLM_FILL_COLOR_EXPRESSION, 'line-width': 1, 'line-dasharray': [1, 2] }}
          />
        </GeoJSONSource>

        {mountedPackCells
          .filter((cell) => cell.layer === 'osm')
          .map((cell) => (
            <OsmLayers
              key={`osm-${cell.cx}-${cell.cy}`}
              id={`osm-${cell.cx}-${cell.cy}`}
              data={cell.uri}
              visible={osmVisible}
              opacity={osmOpacity}
              showLabels={showLabels}
            />
          ))}

        <MvumLayers
          id="mvum"
          data={MVUM_DATA}
          visible={mvumVisible}
          opacity={mvumOpacity}
          onPress={overlayPressEnabled ? handleMvumPress : undefined}
        />
        {mountedPackCells
          .filter((cell) => cell.layer === 'mvum')
          .map((cell) => (
            <MvumLayers
              key={`mvum-${cell.cx}-${cell.cy}`}
              id={`mvum-${cell.cx}-${cell.cy}`}
              data={cell.uri}
              visible={mvumVisible}
              opacity={mvumOpacity}
              onPress={overlayPressEnabled ? handleMvumPress : undefined}
            />
          ))}

        {mountedPackCells
          .filter((cell) => cell.layer === 'trails')
          .map((cell) => (
            <TrailsLayers
              key={`trails-${cell.cx}-${cell.cy}`}
              id={`trails-${cell.cx}-${cell.cy}`}
              data={cell.uri}
              visible={overlayVisibility.usfsTrails}
              opacity={overlayOpacity.usfsTrails}
              showLabels={showLabels}
              onPress={overlayPressEnabled ? handleTrailPress : undefined}
            />
          ))}

        <HuntUnitLayers
          sources={huntSources}
          visible={overlayVisibility.huntUnits}
          opacity={overlayOpacity.huntUnits}
          showLabels={showLabels}
          onPress={overlayPressEnabled ? handleHuntUnitPress : undefined}
        />

        <WildfireLayers
          visible={overlayVisibility.wildfire}
          opacity={overlayOpacity.wildfire}
          showLabels={showLabels}
          onPress={overlayPressEnabled ? handleWildfirePress : undefined}
        />

        <PoiLayers
          id="poi"
          data={BUNDLED_POI_DATA}
          visibility={poiVisibility}
          showLabels={showLabels}
          onPress={overlayPressEnabled ? handlePoiPress : undefined}
        />
        {mountedPackCells
          .filter((cell) => cell.layer === 'poi')
          .map((cell) => (
            <PoiLayers
              key={`poi-${cell.cx}-${cell.cy}`}
              id={`poi-${cell.cx}-${cell.cy}`}
              data={cell.uri}
              visibility={poiVisibility}
              showLabels={showLabels}
              onPress={overlayPressEnabled ? handlePoiPress : undefined}
            />
          ))}

        <PinImages />

        {showUserLocation ? <UserLocation heading accuracy /> : null}

        {children}
      </Map>

      <View pointerEvents="none" style={styles.attribution}>
        <Text style={styles.attributionText}>{mapAttribution(overlayVisibility)}</Text>
      </View>

      <AutoLoadPill />

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

      {selected?.kind === 'likelyPrivate' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardEyebrow}>Likely private (inferred)</Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.cardTitle}>Not in public-land data</Text>
          <Text style={styles.cardRow}>
            No federal, state, local or district public land was found here, so it is shaded as
            likely private. That is an inference, not a parcel record: tribal land, land with
            missing or late-reported data, and easements can look the same.
          </Text>
          <Text style={styles.cardSource}>
            Public-land data: {PUBLIC_LAND_META.source}. For planning only — verify land status and
            access on the ground.
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

      {selected?.kind === 'mvum' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardEyebrow}>Forest road / trail</Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.cardTitle}>{selected.name ?? 'Unnamed'}</Text>
          <Text style={styles.cardRow}>{selected.vehicleClass}</Text>
          {selected.symbolName && <Text style={styles.cardRow}>{selected.symbolName}</Text>}
          {selected.miles != null && (
            <Text style={styles.cardRow}>{selected.miles.toFixed(1)} mi segment</Text>
          )}
          <Text style={styles.cardSource}>
            {MVUM_META.source} · fetched {MVUM_META.fetchedAt.slice(0, 10)}.
          </Text>
        </View>
      )}

      {selected?.kind === 'trail' && (
        <InfoCard
          eyebrow="USFS trail"
          title={selected.name ?? selected.trailNo ?? 'Unnamed trail'}
          rows={[
            selected.trailClass,
            selected.uses ? `Allowed uses: ${selected.uses}` : null,
            selected.trailNo ? `Trail no. ${selected.trailNo}` : null,
            [selected.surface, selected.width].filter(Boolean).join(' · ') || null,
            selected.miles != null ? `${selected.miles.toFixed(1)} mi segment` : null,
          ]}
          source="USFS National Forest System trails. Uses are the agency's recorded management, not a guarantee — check current closures with the forest."
          onClose={() => setSelected(null)}
        />
      )}

      <HuntUnitDisclaimerModal
        visible={huntVisible && (!huntDisclaimerAccepted || staleUnaccepted.length > 0)}
        showGeneral={!huntDisclaimerAccepted}
        notices={staleUnaccepted}
        onAccept={() => {
          acceptHuntDisclaimer();
          acceptStale(acceptanceFor(huntInfos));
        }}
        onDecline={() => setOverlayVisible('huntUnits', false)}
      />

      {selected?.kind === 'huntUnit' && (
        <InfoCard
          eyebrow={`${selected.state.name} · ${selected.setLabel}`}
          title={selected.title}
          rows={[selected.note, staleWarningFor(selected.state, selected.setId), huntUnitDisclaimer(selected.state.name)]}
          actions={[
            selected.url ? { label: selected.urlLabel ?? 'More information', url: selected.url } : null,
            selected.url2 ? { label: selected.url2Label ?? 'More information', url: selected.url2 } : null,
            { label: `${selected.state.name} hunting regulations`, url: selected.state.regsUrl },
          ]}
          source={huntUnitSourceNote(selected.state, selected.setId)}
          onClose={() => setSelected(null)}
        />
      )}

      {selected?.kind === 'wildfire' && (
        <InfoCard
          eyebrow={wildfireCategoryLabel(selected.category)}
          dotColor="#ef4444"
          title={selected.name}
          rows={[
            [formatAcres(selected.acres), formatContainment(selected.containment)].filter(Boolean).join(' · '),
            selected.place,
            selected.description,
            selected.discovered != null ? `Discovered ${formatDate(selected.discovered)}` : null,
            selected.updated != null ? `Perimeter mapped ${formatDate(selected.updated)}` : null,
            selected.cause ? `Cause: ${selected.cause}` : null,
          ]}
          source={`NIFC interagency perimeters${selected.fetchedAt != null ? ` · data fetched ${formatAge(selected.fetchedAt)}` : ''}. Perimeters are approximate and can lag the fire — check InciWeb or local officials.`}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  );
}

interface InfoCardProps {
  eyebrow: string;
  title: string;
  /** Lines under the title; empty/null entries are skipped. */
  rows: (string | null | undefined | false)[];
  /** Link buttons (opened in the phone's browser); null entries are skipped. */
  actions?: ({ label: string; url: string } | null)[];
  source?: string;
  dotColor?: string;
  onClose: () => void;
}

/** The tap card the newer overlays share (the older ones above predate it and inline the same markup). */
function InfoCard({ eyebrow, title, rows, actions = [], source, dotColor, onClose }: InfoCardProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {dotColor && <View style={[styles.dot, { backgroundColor: dotColor }]} />}
        <Text style={styles.cardEyebrow}>{eyebrow}</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      {rows.map((row) => (row ? <Text key={row} style={styles.cardRow}>{row}</Text> : null))}
      {actions.map((action) =>
        action ? (
          <Pressable
            key={action.url}
            style={styles.primaryButton}
            onPress={() => Linking.openURL(action.url).catch(() => undefined)}
          >
            <Text style={styles.primaryButtonText}>{action.label}</Text>
          </Pressable>
        ) : null
      )}
      {source && <Text style={styles.cardSource}>{source}</Text>}
    </View>
  );
}

/** Small "Loading map data…" chip while the as-you-pan loader is fetching cells for the view. */
function AutoLoadPill() {
  const styles = useThemedStyles(makeStyles);
  const pending = useAutoLoadStore((s) => s.pending);
  const active = useAutoLoadStore((s) => s.active);
  if (!active) return null;
  const remaining = pending + 1;
  return (
    <View pointerEvents="none" style={styles.loadPill}>
      <Text style={styles.loadPillText}>
        Loading map data… {remaining} {remaining === 1 ? 'area' : 'areas'} left
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    map: { flex: 1 },
    attribution: {
      position: 'absolute',
      bottom: 8,
      left: 8,
      maxWidth: '78%',
      backgroundColor: c.overlayFaint,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    attributionText: { fontSize: 10, color: c.textSecondary },
    loadPill: {
      position: 'absolute',
      top: 8,
      alignSelf: 'center',
      backgroundColor: c.overlay,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 14,
    },
    loadPillText: { fontSize: 12, color: c.textSecondary },
    card: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 100,
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 14,
      elevation: 4,
      shadowColor: c.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    cardEyebrow: { flex: 1, fontSize: 12, color: c.textMuted, textTransform: 'uppercase' },
    close: { fontSize: 16, color: c.textFaint, paddingHorizontal: 4 },
    cardTitle: { fontSize: 17, fontWeight: '700', marginTop: 4 },
    cardRow: { fontSize: 13, color: c.textSecondary, marginTop: 4 },
    cardSource: { fontSize: 11, color: c.textFaint, marginTop: 8 },
    primaryButton: {
      marginTop: 12,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    primaryButtonText: { color: c.onPrimary, fontWeight: '700' },
  });
