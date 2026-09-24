import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View, Pressable } from 'react-native';

import { PUBLIC_LAND_META } from '../map/landSource';
import type { BaseMapMode } from '../map/usgsSources';
import { POI_CATEGORY_META, type PoiCategory } from '../map/poiSources';
import { useLayersStore, type OverlayLayerId } from '../state/useLayersStore';
import { usePoiStore } from '../state/usePoiStore';
import { useSavedViewsStore } from '../state/useSavedViewsStore';

const POI_CATEGORIES = Object.keys(POI_CATEGORY_META) as PoiCategory[];

const BASE_MAPS: { id: BaseMapMode; label: string }[] = [
  { id: 'topo', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
];

const OVERLAYS: { id: OverlayLayerId; label: string; note?: string }[] = [
  { id: 'land', label: 'Public land' },
  { id: 'shadedRelief', label: 'Shaded relief' },
  { id: 'osm', label: 'Roads & trails (OSM)' },
  { id: 'mvum', label: 'MVUM forest roads', note: 'Not implemented yet — no data source wired up.' },
  {
    id: 'blmSma',
    label: 'BLM cross-check (private/unknown)',
    note: 'Second opinion on "not public" from BLM, not a parcel-level ownership record.',
  },
];

export function LayersScreen() {
  const baseMap = useLayersStore((s) => s.baseMap);
  const setBaseMap = useLayersStore((s) => s.setBaseMap);
  const overlayVisibility = useLayersStore((s) => s.overlayVisibility);
  const overlayOpacity = useLayersStore((s) => s.overlayOpacity);
  const setOverlayVisible = useLayersStore((s) => s.setOverlayVisible);
  const setOverlayOpacity = useLayersStore((s) => s.setOverlayOpacity);
  const poiVisibility = usePoiStore((s) => s.visibility);
  const setPoiVisible = usePoiStore((s) => s.setVisible);
  const useOfflineMaps = useLayersStore((s) => s.useOfflineMaps);
  const setUseOfflineMaps = useLayersStore((s) => s.setUseOfflineMaps);
  const savedViews = useSavedViewsStore((s) => s.views);
  const saveCurrentAsView = useSavedViewsStore((s) => s.saveCurrentAsView);
  const applyView = useSavedViewsStore((s) => s.applyView);
  const deleteView = useSavedViewsStore((s) => s.deleteView);
  const [newViewName, setNewViewName] = useState('');

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

      <View style={styles.overlayRow}>
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayLabel}>Use downloaded maps (offline)</Text>
          <Switch value={useOfflineMaps} onValueChange={setUseOfflineMaps} />
        </View>
        <Text style={styles.poiSourceNote}>
          Renders the {baseMap} layer from what you&rsquo;ve downloaded on the Downloads screen
          instead of live tiles — unverified outside the areas/zooms you&rsquo;ve downloaded,
          since this environment has had no device to test it on yet.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Overlays</Text>
      {OVERLAYS.map((overlay) => (
        <View key={overlay.id} style={styles.overlayRow}>
          <View style={styles.overlayHeader}>
            <Text style={styles.overlayLabel}>{overlay.label}</Text>
            <Switch
              value={overlayVisibility[overlay.id]}
              onValueChange={(v) => setOverlayVisible(overlay.id, v)}
              disabled={overlay.id === 'mvum'}
            />
          </View>
          {overlay.note && <Text style={styles.poiSourceNote}>{overlay.note}</Text>}
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

      <Text style={styles.sectionTitle}>Points of interest</Text>
      {POI_CATEGORIES.map((category) => (
        <View key={category} style={styles.overlayRow}>
          <View style={styles.overlayHeader}>
            <View style={[styles.poiDot, { backgroundColor: POI_CATEGORY_META[category].color }]} />
            <Text style={styles.overlayLabel}>{POI_CATEGORY_META[category].label}</Text>
            <Switch
              value={poiVisibility[category]}
              onValueChange={(v) => setPoiVisible(category, v)}
            />
          </View>
        </View>
      ))}
      <Text style={styles.poiSourceNote}>
        Pre-loaded from OpenStreetMap (© OpenStreetMap contributors) for the southwest Idaho
        starter region — not your own pins.
      </Text>

      <Text style={styles.legendNote}>
        Public land legend: green = open access, amber (dashed) = restricted, red = closed,
        blue-gray = unknown access. Unshaded areas are not in public-land data — likely private
        (inferred), not verified. Source: {PUBLIC_LAND_META.source}, fetched{' '}
        {PUBLIC_LAND_META.fetchedAt.slice(0, 10)} — federal agencies only
        ({PUBLIC_LAND_META.agencies.map((a) => a.replace('PADUS_', '')).join(', ')}), not full
        PAD-US.
      </Text>

      <Text style={styles.sectionTitle}>Saved views</Text>
      <Text style={styles.poiSourceNote}>
        Captures base map, overlays, POI toggles, and the current filter — e.g. &ldquo;Hunt: elk
        unit&rdquo; = satellite + land + orange pins only (§5.3).
      </Text>
      <View style={styles.newViewRow}>
        <TextInput
          style={styles.newViewInput}
          placeholder="Name this view…"
          value={newViewName}
          onChangeText={setNewViewName}
        />
        <Pressable
          style={styles.newViewButton}
          onPress={() => {
            if (!newViewName.trim()) return;
            saveCurrentAsView(newViewName.trim());
            setNewViewName('');
          }}
        >
          <Text style={styles.newViewButtonText}>Save</Text>
        </Pressable>
      </View>
      {savedViews.map((view) => (
        <View key={view.id} style={styles.savedViewRow}>
          <Text style={styles.savedViewName}>{view.name}</Text>
          <Pressable onPress={() => applyView(view.id)}>
            <Text style={styles.savedViewAction}>Apply</Text>
          </Pressable>
          <Pressable onPress={() => deleteView(view.id)}>
            <Text style={[styles.savedViewAction, styles.savedViewDelete]}>Delete</Text>
          </Pressable>
        </View>
      ))}
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
  overlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  overlayLabel: { fontSize: 15, flex: 1 },
  poiDot: { width: 10, height: 10, borderRadius: 5 },
  poiSourceNote: { marginTop: 4, fontSize: 12, color: '#888' },
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
  newViewRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  newViewInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  newViewButton: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#2f6f4f',
  },
  newViewButtonText: { color: 'white', fontWeight: '700' },
  savedViewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
  },
  savedViewName: { flex: 1, fontSize: 15 },
  savedViewAction: { color: '#2f6f4f', fontWeight: '600' },
  savedViewDelete: { color: '#c0392b' },
});
