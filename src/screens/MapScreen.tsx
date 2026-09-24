import { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Feature as GeoJSONFeature, LineString, Point, Polygon } from 'geojson';

import { createFeature } from '../data/featuresRepo';
import { computeGeometryMetrics } from '../features/measure';
import { startTrackRecording, stopTrackRecording } from '../features/trackRecorder';
import { MapScreenMap } from '../map/MapView';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useDrawStore } from '../state/useDrawStore';
import type { DrawTool } from '../state/types';
import { useLayersStore } from '../state/useLayersStore';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';

const DRAW_TOOLS: { id: DrawTool; label: string }[] = [
  { id: 'point', label: 'Point' },
  { id: 'line', label: 'Line' },
  { id: 'polygon', label: 'Area' },
  { id: 'measure', label: 'Measure' },
];

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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const activeTool = useDrawStore((s) => s.activeTool);
  const setActiveTool = useDrawStore((s) => s.setActiveTool);
  const draftVertices = useDrawStore((s) => s.draftVertices);
  const addVertex = useDrawStore((s) => s.addVertex);
  const undoVertex = useDrawStore((s) => s.undoVertex);
  const clearDraft = useDrawStore((s) => s.clearDraft);
  const showUserLocation = useLayersStore((s) => s.showUserLocation);
  const setShowUserLocation = useLayersStore((s) => s.setShowUserLocation);
  const trackRecording = useTrackRecordingStore((s) => s.recording);
  const trackPoints = useTrackRecordingStore((s) => s.points);

  const vertices = draftVertices as [number, number][];
  const metrics = useMemo(() => {
    if (vertices.length < 2) return null;
    if (activeTool === 'polygon' && vertices.length >= 3) {
      return computeGeometryMetrics({ type: 'Polygon', coordinates: [[...vertices, vertices[0]]] });
    }
    return computeGeometryMetrics({ type: 'LineString', coordinates: vertices });
  }, [vertices, activeTool]);

  async function handleMapPress(lngLat: [number, number]) {
    if (activeTool === 'none') return;

    if (activeTool === 'point') {
      await createFeature(db, { geometry: { type: 'Point', coordinates: lngLat }, source: 'manual' });
      setActiveTool('none');
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
    clearDraft();
    setActiveTool('none');
  }

  function handleCancel() {
    clearDraft();
    setActiveTool('none');
  }

  async function handleToggleTrack() {
    if (trackRecording) {
      const points = stopTrackRecording();
      if (points.length >= 2) {
        await createFeature(db, {
          name: `Track ${new Date().toLocaleString()}`,
          geometry: { type: 'LineString', coordinates: points },
          source: 'track',
        });
        Alert.alert('Track saved', `Saved a track with ${points.length} points.`);
      } else {
        Alert.alert('Track discarded', 'Not enough points were recorded to save a track.');
      }
      return;
    }

    const result = await startTrackRecording();
    if (!result.ok) Alert.alert('Cannot record track', result.reason);
  }

  return (
    <View style={styles.container}>
      <MapScreenMap onMapPress={handleMapPress}>
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

      <View style={styles.topBar}>
        <Pressable style={styles.chip} onPress={() => navigation.navigate('Layers')}>
          <Text style={styles.chipText}>Layers</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => navigation.navigate('Items')}>
          <Text style={styles.chipText}>Items</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => navigation.navigate('Downloads')}>
          <Text style={styles.chipText}>Downloads</Text>
        </Pressable>
      </View>

      <View style={styles.topRightBar}>
        <Pressable
          style={[styles.iconChip, showUserLocation && styles.iconChipActive]}
          onPress={() => setShowUserLocation(!showUserLocation)}
        >
          <Text style={styles.chipText}>◎</Text>
        </Pressable>
        <Pressable
          style={[styles.iconChip, trackRecording && styles.iconChipRecording]}
          onPress={handleToggleTrack}
        >
          <Text style={styles.chipText}>{trackRecording ? '■' : '●'}</Text>
        </Pressable>
        <Pressable style={styles.iconChip} onPress={() => navigation.navigate('ImportExport')}>
          <Text style={styles.chipText}>⇅</Text>
        </Pressable>
        <Pressable style={styles.iconChip} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.chipText}>⚙</Text>
        </Pressable>
      </View>

      {activeTool !== 'none' && (
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

      <View style={styles.drawToolbar}>
        {DRAW_TOOLS.map((tool) => (
          <Pressable
            key={tool.id}
            style={[styles.toolButton, activeTool === tool.id && styles.toolButtonActive]}
            onPress={() => {
              clearDraft();
              setActiveTool(activeTool === tool.id ? 'none' : tool.id);
            }}
          >
            <Text style={styles.toolButtonText}>{tool.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  topRightBar: {
    position: 'absolute',
    top: 104,
    left: 12,
    flexDirection: 'row',
    gap: 8,
  },
  iconChip: {
    backgroundColor: 'white',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  iconChipActive: { backgroundColor: '#dbe9e0' },
  iconChipRecording: { backgroundColor: '#f6d5d5' },
  chip: {
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  chipText: { fontWeight: '600' },
  draftBar: {
    position: 'absolute',
    bottom: 100,
    left: 12,
    right: 12,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    elevation: 3,
  },
  draftReadout: { fontWeight: '700', marginBottom: 6 },
  draftButtons: { flexDirection: 'row', justifyContent: 'space-around' },
  draftButtonText: { color: '#2f6f4f', fontWeight: '700' },
  draftCancel: { color: '#c0392b' },
  draftDone: { color: '#2f6f4f' },
  drawToolbar: {
    position: 'absolute',
    bottom: 32,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'white',
    borderRadius: 24,
    paddingVertical: 10,
    elevation: 2,
  },
  toolButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  toolButtonActive: { backgroundColor: '#2f6f4f' },
  toolButtonText: { fontWeight: '600' },
});
