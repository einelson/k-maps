import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Keyboard, Pressable, StyleSheet, Vibration, View } from 'react-native';
import { GeoJSONSource, Layer, type CameraRef, type MapRef } from '@maplibre/maplibre-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useSQLiteContext } from 'expo-sqlite';
import type { Feature as GeoJSONFeature, Geometry, LineString, Point, Polygon } from 'geojson';

import { createFeature, createFeatureWithTags, updateFeatureGeometry } from '../data/featuresRepo';
import { listTags } from '../data/tagsRepo';
import type { Feature } from '../data/types';
import { formatCoordinate } from '../features/coordinates';
import { computeGeometryMetrics } from '../features/measure';
import { DEFAULT_PIN_COLOR, DEFAULT_PIN_STYLE } from '../features/pinStyles';
import { canRemoveVertex, geometryToVertices, verticesToGeometry } from '../features/vertexEdit';
import { discardTrackRecording, finishTrackRecording, startTrackRecording } from '../features/trackRecorder';
import { EditLayers } from '../map/EditLayers';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MapScreenMap } from '../map/MapView';
import { PinDraftLayers } from '../map/PinLayers';
import { SavedFeaturesLayers } from '../map/SavedFeaturesLayers';
import { useSavedFeatures } from '../map/useSavedFeatures';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useDrawStore } from '../state/useDrawStore';
import { useEditStore } from '../state/useEditStore';
import { useFiltersStore } from '../state/useFiltersStore';
import type { DrawTool } from '../state/types';
import { useLayersStore } from '../state/useLayersStore';
import { useSettingsStore } from '../state/useSettingsStore';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';
import { Text, useThemedStyles, type ThemeColors } from '../theme';
import { AddMenu } from './components/AddMenu';
import { BottomToolbar, type ToolbarItem } from './components/BottomToolbar';
import { CoordinateReadout } from './components/CoordinateReadout';
import { FilterControl } from './components/FilterControl';
import { LayersPanel } from './components/LayersPanel';
import { MAP_BUTTON_SIZE, MapButton } from './components/MapButton';
import { PinCard, type PinDraft } from './components/PinCard';
import { RecordingButton } from './components/RecordingButton';
import { RecordingPanel } from './components/RecordingPanel';

/** Which floating panel is open over the map. Only one at a time. */
type Panel = 'none' | 'layers' | 'add';

/** Gap between the floating buttons and the edges / each other. */
const EDGE = 12;
/** Top of the second button in the right-hand column (under the layers button). */
const SECOND_BUTTON_OFFSET = EDGE + MAP_BUTTON_SIZE + 8;
/** Tapping "my location" zooms in to at least this level (never zooms out from a closer view). */
const LOCATE_ZOOM = 16;
/** The new-pin card's height with the keyboard down (its fields scroll past ~42% of the screen, plus header and buttons). */
const PIN_CARD_CHROME = 140;
/** Height of the pin marker above its tip, so a revealed pin's head isn't clipped by the top buttons. */
const PIN_MARKER_HEIGHT = 44;
/** Bottom-left readouts (attribution, coordinates, scale bar) stack up to about here; cards and draft bars sit above it. */
const BOTTOM_STACK = 100;

/** Live vertex/preview overlay for the active draw tool, rendered as children of MapScreenMap. */
function DraftOverlay({ vertices, closed }: { vertices: [number, number][]; closed: boolean }) {
  if (vertices.length === 0) return null;

  const pointsFc: GeoJSONFeature<Point>[] = vertices.map((coordinates) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates },
  }));

  const lineGeometry: LineString | Polygon | null =
    vertices.length < 2
      ? null
      : closed
        ? { type: 'Polygon', coordinates: [[...vertices, vertices[0]]] }
        : { type: 'LineString', coordinates: vertices };

  return (
    <>
      <GeoJSONSource id="draft-vertices" data={{ type: 'FeatureCollection', features: pointsFc }}>
        <Layer
          id="draft-vertices-layer"
          type="circle"
          source="draft-vertices"
          paint={{ 'circle-radius': 5, 'circle-color': '#2f6f4f', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' }}
        />
      </GeoJSONSource>
      {lineGeometry && (
        <GeoJSONSource
          id="draft-line"
          data={{ type: 'Feature', properties: {}, geometry: lineGeometry }}
        >
          {lineGeometry.type === 'Polygon' && (
            <Layer
              id="draft-fill-layer"
              type="fill"
              source="draft-line"
              paint={{ 'fill-color': '#2f6f4f', 'fill-opacity': 0.15 }}
            />
          )}
          <Layer
            id="draft-line-layer"
            type="line"
            source="draft-line"
            paint={{ 'line-color': '#2f6f4f', 'line-width': 3 }}
          />
        </GeoJSONSource>
      )}
    </>
  );
}

export function MapScreen() {
  const db = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RootStackParamList, 'Map'>>();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const activeTool = useDrawStore((s) => s.activeTool);
  const setActiveTool = useDrawStore((s) => s.setActiveTool);
  const draftVertices = useDrawStore((s) => s.draftVertices);
  const addVertex = useDrawStore((s) => s.addVertex);
  const undoVertex = useDrawStore((s) => s.undoVertex);
  const clearDraft = useDrawStore((s) => s.clearDraft);
  const showUserLocation = useLayersStore((s) => s.showUserLocation);
  const setShowUserLocation = useLayersStore((s) => s.setShowUserLocation);
  const trackRecording = useTrackRecordingStore((s) => s.recording);
  const [recordingPanelOpen, setRecordingPanelOpen] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const trackPoints = useTrackRecordingStore((s) => s.points);
  const showLabels = useLayersStore((s) => s.showLabels);
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);
  const filters = useFiltersStore((s) => s.filters);
  const editingId = useEditStore((s) => s.featureId);
  const editType = useEditStore((s) => s.type);
  const editVertices = useEditStore((s) => s.vertices);
  const editSelected = useEditStore((s) => s.selected);
  const editHistoryLength = useEditStore((s) => s.history.length);
  const editing = editingId != null;
  const { data: savedFeatures, reload: reloadSavedFeatures } = useSavedFeatures();
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  /** The pin being created in the bottom card — only saved when the card's Save is pressed. */
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  /** Existing tag names, offered as suggestions in the pin card. */
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [panel, setPanel] = useState<Panel>('none');

  // The "+" button only exists while nothing else owns the bottom of the map.
  const canAdd = !editing && activeTool === 'none' && !pinDraft;
  const openPanel: Panel = panel === 'add' && !canAdd ? 'none' : panel;

  const vertices = draftVertices as [number, number][];
  const metrics = useMemo(() => {
    if (vertices.length < 2) return null;
    if (activeTool === 'polygon' && vertices.length >= 3) {
      return computeGeometryMetrics({ type: 'Polygon', coordinates: [[...vertices, vertices[0]]] });
    }
    return computeGeometryMetrics({ type: 'LineString', coordinates: vertices });
  }, [vertices, activeTool]);

  // Opened from a feature's detail screen with "Edit shape on map".
  const requestedEditId = route.params?.editFeatureId;
  useEffect(() => {
    if (requestedEditId == null) return;
    let cancelled = false;
    (async () => {
      const row = await db.getFirstAsync<Feature>('SELECT * FROM features WHERE id = ?', requestedEditId);
      if (cancelled) return;
      navigation.setParams({ editFeatureId: undefined });
      const parsed = row ? geometryToVertices(JSON.parse(row.geometry) as Geometry) : null;
      if (!row || !parsed) {
        Alert.alert('Cannot edit shape', 'This item has a geometry the editor does not support.');
        return;
      }
      useDrawStore.getState().clearDraft();
      useDrawStore.getState().setActiveTool('none');
      useEditStore.getState().begin(row.id, parsed.type, parsed.vertices);
      if (parsed.type === 'point') {
        cameraRef.current?.easeTo({ center: parsed.vertices[0], zoom: 16, duration: 500 });
      } else if (row.min_lon != null && row.min_lat != null && row.max_lon != null && row.max_lat != null) {
        cameraRef.current?.fitBounds([row.min_lon, row.min_lat, row.max_lon, row.max_lat], {
          padding: { top: 220, right: 60, bottom: 220, left: 60 },
          duration: 600,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedEditId, db, navigation]);

  async function handleEditSave() {
    const { featureId, type, vertices } = useEditStore.getState();
    if (featureId == null || !type) return;
    await updateFeatureGeometry(db, featureId, verticesToGeometry(type, vertices));
    useEditStore.getState().end();
    reloadSavedFeatures();
  }

  function handleEditCancel() {
    useEditStore.getState().end();
  }

  function handleEditMoveToCrosshair() {
    const { selected, move } = useEditStore.getState();
    if (selected != null) move(selected, center);
  }

  /**
   * If `lngLat` would sit behind the pin card (or under the top buttons), pan the map so the pin
   * ends up in the clear strip between them. A no-op when it's already visible.
   */
  async function revealPin(lngLat: [number, number]) {
    const map = mapRef.current;
    if (!map || mapSize.height === 0) return;
    const minY = insets.top + SECOND_BUTTON_OFFSET + MAP_BUTTON_SIZE + PIN_MARKER_HEIGHT;
    const maxY = mapSize.height - Math.round(mapSize.height * 0.42) - PIN_CARD_CHROME - 12;
    try {
      const [, y] = await map.project(lngLat);
      if (y >= minY && y <= maxY) return;
      const targetY = (minY + Math.max(minY, maxY)) / 2;
      const center = await map.unproject([mapSize.width / 2, mapSize.height / 2 + (y - targetY)]);
      cameraRef.current?.easeTo({ center, duration: 300 });
    } catch {
      // Revealing is a nicety; the pin is still placed if the map can't project yet.
    }
  }

  /** Opens the new-pin card for `lngLat`. Nothing is saved until the card's Save. */
  function beginPin(lngLat: [number, number]) {
    setPanel('none');
    setPinDraft({
      lngLat,
      name: '',
      notes: '',
      color: DEFAULT_PIN_COLOR,
      icon: DEFAULT_PIN_STYLE,
      tags: [],
    });
    listTags(db)
      .then((tags) => setKnownTags(tags.map((tag) => tag.name)))
      .catch(() => {});
    revealPin(lngLat);
  }

  /** Long-press drops a pin exactly where the finger is (only when no draw tool or editor owns the map). */
  function handleMapLongPress(lngLat: [number, number]) {
    if (editing || activeTool !== 'none') return;
    Vibration.vibrate(25);
    if (pinDraft) {
      // Already filling in a pin: a second long-press moves it rather than starting over.
      setPinDraft({ ...pinDraft, lngLat });
      revealPin(lngLat);
      return;
    }
    beginPin(lngLat);
  }

  async function handlePinSave(tags: string[]) {
    if (!pinDraft || savingPin) return;
    setSavingPin(true);
    try {
      await createFeatureWithTags(
        db,
        {
          geometry: { type: 'Point', coordinates: pinDraft.lngLat },
          name: pinDraft.name.trim() || null,
          notes: pinDraft.notes.trim() || null,
          color: pinDraft.color,
          icon: pinDraft.icon,
          source: 'manual',
        },
        tags
      );
      // Wait for the reload so the saved pin is on the map before the draft preview disappears.
      await reloadSavedFeatures();
      Keyboard.dismiss();
      setPinDraft(null);
    } catch (err) {
      Alert.alert('Could not save pin', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPin(false);
    }
  }

  function handlePinCancel() {
    Keyboard.dismiss();
    setPinDraft(null);
  }

  /** Zooms to the device's position, asking for location permission (and switching the marker on) first. */
  async function handleLocate() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Location permission needed', 'Allow location access for K-Maps in system settings to see and zoom to your position.');
      return;
    }
    setShowUserLocation(true);
    try {
      const position =
        (await Location.getLastKnownPositionAsync({ maxAge: 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.LocationAccuracy.Balanced }));
      cameraRef.current?.easeTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: Math.max(zoomRef.current, LOCATE_ZOOM),
        duration: 600,
      });
    } catch {
      Alert.alert('Cannot find your location', 'Make sure location services are turned on, then try again.');
    }
  }

  async function handleMapPress(lngLat: [number, number]) {
    if (editing) {
      useEditStore.getState().select(null);
      return;
    }
    if (pinDraft) {
      // Taps only dismiss the keyboard while the card is open; long-press repositions the pin.
      Keyboard.dismiss();
      return;
    }
    if (activeTool === 'none') return;

    if (activeTool === 'point') {
      setActiveTool('none');
      beginPin(lngLat);
      return;
    }

    addVertex(lngLat);
  }

  async function handleDone() {
    if (activeTool === 'line' && vertices.length >= 2) {
      await createFeature(db, { geometry: { type: 'LineString', coordinates: vertices }, source: 'manual' });
    } else if (activeTool === 'polygon' && vertices.length >= 3) {
      await createFeature(db, {
        geometry: { type: 'Polygon', coordinates: [[...vertices, vertices[0]]] },
        source: 'manual',
      });
    } else if (activeTool === 'measure') {
      // Measure never saves (§7.3) — Done just clears the ruler.
    } else {
      Alert.alert('Not enough points', activeTool === 'polygon' ? 'An area needs at least 3 points.' : 'A line needs at least 2 points.');
      return;
    }
    reloadSavedFeatures();
    clearDraft();
    setActiveTool('none');
  }

  function handleCancel() {
    clearDraft();
    setActiveTool('none');
  }

  async function handleToggleTrack() {
    // While recording, the "+" menu's record item opens the panel instead of ending the track outright.
    if (trackRecording) {
      setRecordingPanelOpen(true);
      return;
    }
    const result = await startTrackRecording(db);
    if (!result.ok) Alert.alert('Cannot record track', result.reason);
  }

  async function handleEndRecording() {
    setRecordingBusy(true);
    try {
      // Saved from the database (where every fix has been stored, including any recorded while the app was
      // closed) and only cleared once the track is safely saved. The dashboard it opens on is where the
      // track gets a proper name, folder and tags.
      const featureId = await finishTrackRecording(db);
      setRecordingPanelOpen(false);
      if (featureId == null) {
        Alert.alert('Track discarded', 'Not enough points were recorded to save a track.');
      } else {
        reloadSavedFeatures();
        navigation.navigate('FeatureDetail', { featureId });
      }
    } catch (err) {
      Alert.alert('Could not save the track', err instanceof Error ? err.message : String(err));
    } finally {
      setRecordingBusy(false);
    }
  }

  async function handleDeleteRecording() {
    setRecordingBusy(true);
    try {
      await discardTrackRecording(db);
      setRecordingPanelOpen(false);
    } catch (err) {
      Alert.alert('Could not delete the recording', err instanceof Error ? err.message : String(err));
    } finally {
      setRecordingBusy(false);
    }
  }

  function handleSelectTool(tool: Exclude<DrawTool, 'none'>) {
    clearDraft();
    setActiveTool(activeTool === tool ? 'none' : tool);
    setPanel('none');
  }

  function togglePanel(target: Exclude<Panel, 'none'>) {
    setPanel(openPanel === target ? 'none' : target);
  }

  // Everything that used to be a row of chips along the top of the map. The last two slots are
  // provisional (Downloads and Import/Export were already top-level) — swap them freely.
  const toolbarItems: ToolbarItem[] = [
    { key: 'content', label: 'My Content', icon: 'list', onPress: () => navigation.navigate('Items') },
    { key: 'downloads', label: 'Downloads', icon: 'download', onPress: () => navigation.navigate('Downloads') },
    { key: 'import-export', label: 'Import/Export', icon: 'swap', onPress: () => navigation.navigate('ImportExport') },
    { key: 'settings', label: 'Settings', icon: 'settings', onPress: () => navigation.navigate('Settings') },
  ];

  return (
    <View style={styles.container}>
      {/* The map and everything floating over it live in their own box above the toolbar, so the
          map ends where the toolbar begins and never runs under the system navigation bar. */}
      <View
        style={styles.mapArea}
        onLayout={(event) => setMapSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      >
        <MapScreenMap
          autoLoad
          onMapPress={handleMapPress}
          onMapLongPress={handleMapLongPress}
          // While a draw tool is active or a pin card is open, taps must not open land/road/pin cards or saved items.
          overlayPressEnabled={activeTool === 'none' && !editing && !pinDraft}
          onViewStateChange={(viewState) => {
            setCenter(viewState.center);
            zoomRef.current = viewState.zoom;
          }}
          scaleBarBottom={72}
          compassTop={insets.top + SECOND_BUTTON_OFFSET + MAP_BUTTON_SIZE + 8}
          cameraRef={cameraRef}
          mapRef={mapRef}
        >
          <SavedFeaturesLayers
            data={savedFeatures}
            filters={filters}
            showLabels={showLabels}
            hiddenFeatureId={editingId}
            onPressFeature={
              activeTool === 'none' && !editing && !pinDraft
                ? (featureId) => navigation.navigate('FeatureDetail', { featureId })
                : undefined
            }
            onZoomTo={(target, zoom) => cameraRef.current?.easeTo({ center: target, zoom, duration: 450 })}
          />
          <EditLayers />
          <PinDraftLayers lngLat={pinDraft?.lngLat ?? null} color={pinDraft?.color} style={pinDraft?.icon ?? DEFAULT_PIN_STYLE} />
          <DraftOverlay vertices={vertices} closed={activeTool === 'polygon'} />
          {trackRecording && trackPoints.length >= 2 && (
            <GeoJSONSource
              id="live-track"
              data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trackPoints } }}
            >
              <Layer id="live-track-layer" type="line" source="live-track" paint={{ 'line-color': '#c0392b', 'line-width': 3 }} />
            </GeoJSONSource>
          )}
        </MapScreenMap>

        <View pointerEvents="none" style={styles.crosshair}>
          <View style={styles.crosshairH} />
          <View style={styles.crosshairV} />
        </View>

        <View style={styles.coordinateReadout}>
          <CoordinateReadout lon={center[0]} lat={center[1]} />
        </View>

        {editing && (
          <View style={styles.draftBar}>
            <Text style={styles.draftReadout}>
              {editType === 'point'
                ? 'Drag the orange handle, or pan the map and tap "Move here"'
                : editSelected != null
                  ? `Vertex ${editSelected + 1} of ${editVertices.length} — drag it, or pan and tap "Move here"`
                  : 'Tap a vertex to select it, or tap a ○ to add one'}
            </Text>
            <View style={styles.draftButtons}>
              <Pressable onPress={useEditStore.getState().undo} disabled={editHistoryLength === 0}>
                <Text style={[styles.draftButtonText, editHistoryLength === 0 && styles.draftButtonDisabled]}>Undo</Text>
              </Pressable>
              <Pressable onPress={handleEditMoveToCrosshair} disabled={editSelected == null}>
                <Text style={[styles.draftButtonText, editSelected == null && styles.draftButtonDisabled]}>Move here</Text>
              </Pressable>
              {editType && editType !== 'point' && (
                <Pressable
                  onPress={() => editSelected != null && useEditStore.getState().remove(editSelected)}
                  disabled={editSelected == null || !canRemoveVertex(editType, editVertices)}
                >
                  <Text
                    style={[
                      styles.draftCancel,
                      styles.draftButtonText,
                      (editSelected == null || !canRemoveVertex(editType, editVertices)) && styles.draftButtonDisabled,
                    ]}
                  >
                    Delete pt
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.draftButtons, styles.editSecondRow]}>
              <Pressable onPress={handleEditCancel}>
                <Text style={[styles.draftButtonText, styles.draftCancel]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleEditSave}>
                <Text style={[styles.draftButtonText, styles.draftDone]}>Save shape</Text>
              </Pressable>
            </View>
          </View>
        )}

        {activeTool !== 'none' && !editing && (
          <View style={styles.draftBar}>
            <Text style={styles.draftReadout}>
              {activeTool === 'polygon' && metrics?.areaM2 != null
                ? `${(metrics.areaM2 / 4046.86).toFixed(2)} ac`
                : metrics?.lengthM != null
                  ? `${(metrics.lengthM / 1000).toFixed(2)} km`
                  : 'Tap the map to add points'}
            </Text>
            <View style={styles.draftButtons}>
              <Pressable onPress={undoVertex} disabled={vertices.length === 0}>
                <Text style={styles.draftButtonText}>Undo</Text>
              </Pressable>
              <Pressable onPress={handleCancel}>
                <Text style={[styles.draftButtonText, styles.draftCancel]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleDone}>
                <Text style={[styles.draftButtonText, styles.draftDone]}>
                  {activeTool === 'measure' ? 'Clear' : 'Done'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Tapping anywhere else on the map closes whichever panel is open. */}
        {openPanel !== 'none' && (
          <Pressable
            accessibilityLabel="Close"
            style={StyleSheet.absoluteFill}
            onPress={() => setPanel('none')}
          />
        )}

        {/* box-none throughout: these wrappers span the width but must not swallow map pans. */}
        <View
          pointerEvents="box-none"
          style={[styles.filterControl, { top: insets.top + EDGE, right: EDGE + MAP_BUTTON_SIZE + 8 }]}
        >
          <FilterControl />
        </View>

        <View pointerEvents="box-none" style={[styles.rightColumn, { top: insets.top + EDGE }]}>
          <MapButton
            icon="layers"
            label="Layers"
            active={openPanel === 'layers'}
            onPress={() => togglePanel('layers')}
          />
          <MapButton
            icon="locate"
            label="Zoom to my location (long-press to hide it)"
            active={showUserLocation}
            onPress={handleLocate}
            onLongPress={() => setShowUserLocation(false)}
          />
          {trackRecording && <RecordingButton onPress={() => setRecordingPanelOpen(true)} />}
        </View>

        {openPanel === 'layers' && (
          <LayersPanel
            top={insets.top + SECOND_BUTTON_OFFSET}
            bottomClearance={BOTTOM_STACK}
            onOpenAdvanced={() => {
              setPanel('none');
              navigation.navigate('Layers');
            }}
          />
        )}

        {pinDraft && (
          <PinCard
            draft={pinDraft}
            onChange={(patch) => setPinDraft((draft) => (draft ? { ...draft, ...patch } : draft))}
            knownTags={knownTags}
            coordinateText={formatCoordinate(pinDraft.lngLat[0], pinDraft.lngLat[1], coordinateFormat)}
            onSave={handlePinSave}
            onCancel={handlePinCancel}
            saving={savingPin}
          />
        )}

        <RecordingPanel
          visible={trackRecording && recordingPanelOpen}
          onClose={() => setRecordingPanelOpen(false)}
          onEnd={handleEndRecording}
          onDelete={handleDeleteRecording}
          busy={recordingBusy}
        />

        {canAdd && (
          <AddMenu
            open={openPanel === 'add'}
            onToggle={() => togglePanel('add')}
            activeTool={activeTool}
            recording={trackRecording}
            onSelectTool={handleSelectTool}
            onToggleTrack={() => {
              setPanel('none');
              handleToggleTrack();
            }}
          />
        )}
      </View>

      <BottomToolbar items={toolbarItems} bottomInset={insets.bottom} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Matches the toolbar so the strip under the system navigation bar blends into it.
    container: { flex: 1, backgroundColor: c.surface },
    mapArea: { flex: 1 },
    // Right edge is set at render time: it stops short of the layers button.
    filterControl: { position: 'absolute', left: EDGE },
    rightColumn: { position: 'absolute', right: EDGE, gap: 8, alignItems: 'flex-end' },
    crosshair: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: 0,
      height: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The crosshair is drawn on the map tiles, which stay light in every theme.
    crosshairH: { position: 'absolute', width: 22, height: 2, backgroundColor: 'rgba(0,0,0,0.55)' },
    crosshairV: { position: 'absolute', width: 2, height: 22, backgroundColor: 'rgba(0,0,0,0.55)' },
    coordinateReadout: { position: 'absolute', bottom: 34, left: EDGE },
    draftBar: {
      position: 'absolute',
      bottom: BOTTOM_STACK,
      left: 12,
      right: 12,
      backgroundColor: c.surface,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      elevation: 3,
    },
    draftReadout: { fontWeight: '700', marginBottom: 6 },
    draftButtons: { flexDirection: 'row', justifyContent: 'space-around' },
    draftButtonText: { color: c.primaryText, fontWeight: '700' },
    draftCancel: { color: c.danger },
    draftButtonDisabled: { opacity: 0.35 },
    editSecondRow: { marginTop: 10 },
    draftDone: { color: c.primaryText },
  });
