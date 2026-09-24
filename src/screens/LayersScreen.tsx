import { ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';

import type { BaseMapMode } from '../map/usgsSources';
import { useLayersStore, type OverlayLayerId } from '../state/useLayersStore';

const BASE_MAPS: { id: BaseMapMode; label: string }[] = [
  { id: 'topo', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
];

const OVERLAYS: { id: OverlayLayerId; label: string }[] = [
  { id: 'land', label: 'Public land' },
  { id: 'shadedRelief', label: 'Shaded relief' },
  { id: 'osm', label: 'Roads & trails (OSM)' },
  { id: 'mvum', label: 'MVUM forest roads' },
  { id: 'blmSma', label: 'BLM surface management' },
];

export function LayersScreen() {
  const baseMap = useLayersStore((s) => s.baseMap);
  const setBaseMap = useLayersStore((s) => s.setBaseMap);
  const overlayVisibility = useLayersStore((s) => s.overlayVisibility);
  const overlayOpacity = useLayersStore((s) => s.overlayOpacity);
  const setOverlayVisible = useLayersStore((s) => s.setOverlayVisible);
  const setOverlayOpacity = useLayersStore((s) => s.setOverlayOpacity);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Base map</Text>
      <View style={styles.baseMapRow}>
        {BASE_MAPS.map((mode) => (
          <Pressable
            key={mode.id}
            style={[styles.baseMapButton, baseMap === mode.id && styles.baseMapButtonActive]}
            onPress={() => setBaseMap(mode.id)}
          >
            <Text
              style={[
                styles.baseMapButtonText,
                baseMap === mode.id && styles.baseMapButtonTextActive,
              ]}
            >
              {mode.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Overlays</Text>
      {OVERLAYS.map((overlay) => (
        <View key={overlay.id} style={styles.overlayRow}>
          <View style={styles.overlayHeader}>
            <Text style={styles.overlayLabel}>{overlay.label}</Text>
            <Switch
              value={overlayVisibility[overlay.id]}
              onValueChange={(v) => setOverlayVisible(overlay.id, v)}
            />
          </View>
          {overlayVisibility[overlay.id] && (
            <View style={styles.opacityRow}>
              <Text style={styles.opacityLabel}>
                Opacity {Math.round(overlayOpacity[overlay.id] * 100)}%
              </Text>
              <Pressable
                style={styles.opacityButton}
                onPress={() =>
                  setOverlayOpacity(overlay.id, Math.max(0, overlayOpacity[overlay.id] - 0.1))
                }
              >
                <Text>-</Text>
              </Pressable>
              <Pressable
                style={styles.opacityButton}
                onPress={() =>
                  setOverlayOpacity(overlay.id, Math.min(1, overlayOpacity[overlay.id] + 0.1))
                }
              >
                <Text>+</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      <Text style={styles.legendNote}>
        Public land legend: green = open, amber (dashed) = restricted, red = closed, blue-gray =
        unknown access. Unshaded areas are not in public-land data — likely private (inferred),
        not verified.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { padding: 16, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  baseMapRow: { flexDirection: 'row', gap: 8 },
  baseMapButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#eee',
    alignItems: 'center',
  },
  baseMapButtonActive: { backgroundColor: '#2f6f4f' },
  baseMapButtonText: { fontWeight: '600' },
  baseMapButtonTextActive: { color: 'white' },
  overlayRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  overlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  overlayLabel: { fontSize: 15 },
  opacityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  opacityLabel: { flex: 1, color: '#666' },
  opacityButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendNote: { marginTop: 16, fontSize: 12, color: '#666', lineHeight: 18 },
});
