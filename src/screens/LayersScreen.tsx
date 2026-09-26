import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Switch, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BASE_MAPS, groupedOverlays } from '../map/layerOptions';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { PUBLIC_LAND_META } from '../map/landSource';
import { MVUM_META } from '../map/mvumSource';
import { POI_CATEGORY_META, type PoiCategory } from '../map/poiSources';
import { formatAge } from '../map/wildfireSource';
import { useLayersStore } from '../state/useLayersStore';
import { usePoiStore } from '../state/usePoiStore';
import { useSavedViewsStore } from '../state/useSavedViewsStore';
import { useWildfireStore } from '../state/useWildfireStore';
import { Text, TextInput, useThemedStyles, type ThemeColors } from '../theme';

const POI_CATEGORIES = Object.keys(POI_CATEGORY_META) as PoiCategory[];
const GROUPS = groupedOverlays();

export function LayersScreen() {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const baseMap = useLayersStore((s) => s.baseMap);
  const setBaseMap = useLayersStore((s) => s.setBaseMap);
  const overlayVisibility = useLayersStore((s) => s.overlayVisibility);
  const overlayOpacity = useLayersStore((s) => s.overlayOpacity);
  const setOverlayVisible = useLayersStore((s) => s.setOverlayVisible);
  const setOverlayOpacity = useLayersStore((s) => s.setOverlayOpacity);
  const poiVisibility = usePoiStore((s) => s.visibility);
  const setPoiVisible = usePoiStore((s) => s.setVisible);
  const showLabels = useLayersStore((s) => s.showLabels);
  const setShowLabels = useLayersStore((s) => s.setShowLabels);
  const useOfflineMaps = useLayersStore((s) => s.useOfflineMaps);
  const setUseOfflineMaps = useLayersStore((s) => s.setUseOfflineMaps);
  const autoLoadOverlays = useLayersStore((s) => s.autoLoadOverlays);
  const setAutoLoadOverlays = useLayersStore((s) => s.setAutoLoadOverlays);
  const wildfireFetchedAt = useWildfireStore((s) => s.fetchedAt);
  const wildfireStatus = useWildfireStore((s) => s.status);
  const wildfireError = useWildfireStore((s) => s.error);
  const savedViews = useSavedViewsStore((s) => s.views);
  const saveCurrentAsView = useSavedViewsStore((s) => s.saveCurrentAsView);
  const applyView = useSavedViewsStore((s) => s.applyView);
  const deleteView = useSavedViewsStore((s) => s.deleteView);
  const [newViewName, setNewViewName] = useState('');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]}
    >
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

      <View style={styles.overlayRow}>
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayLabel}>Name labels</Text>
          <Switch value={showLabels} onValueChange={setShowLabels} />
        </View>
        <Text style={styles.poiSourceNote}>
          Shows the names of your pins, lines and areas (and road/trail names where downloaded).
          Drawn from fonts bundled with the app, so they work offline.
        </Text>
      </View>

      <View style={styles.overlayRow}>
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayLabel}>Load land data as I pan</Text>
          <Switch value={autoLoadOverlays} onValueChange={setAutoLoadOverlays} />
        </View>
        <Text style={styles.poiSourceNote}>
          While you&rsquo;re online, fetches public land, forest roads and USFS trails for the squares you
          look at and keeps them on the phone, so coverage isn&rsquo;t limited to the southwest Idaho
          starter region. It starts once you&rsquo;re zoomed in about as far as a county (zoom 9);
          farther out nothing loads. Anywhere you&rsquo;ve viewed works offline later. To have a whole
          state ready before you go, use Downloads → State overlays (or Pick an area for part of one). Only
          US land is covered.
        </Text>
      </View>

      {GROUPS.map(({ group, overlays }) => (
        <View key={group.id}>
          <Text style={styles.sectionTitle}>{group.label}</Text>
          <Text style={styles.groupBlurb}>{group.blurb}</Text>
          {overlays.map((overlay) => {
            const on = overlayVisibility[overlay.id] && !overlay.disabled;
            return (
              <View key={overlay.id} style={styles.overlayRow}>
                <View style={styles.overlayHeader}>
                  <Text style={styles.overlayLabel}>{overlay.label}</Text>
                  {overlay.onlineOnly && <Text style={styles.onlineTag}>online</Text>}
                  <Switch
                    value={on}
                    onValueChange={(v) => setOverlayVisible(overlay.id, v)}
                    disabled={overlay.disabled}
                  />
                </View>
                {overlay.note && <Text style={styles.poiSourceNote}>{overlay.note}</Text>}
                {overlay.downloadsLink && (
                  <Pressable accessibilityRole="link" style={styles.downloadsLink} onPress={() => navigation.navigate('Downloads')}>
                    <Text style={styles.downloadsLinkText}>{overlay.downloadsLink} →</Text>
                  </Pressable>
                )}
                {on && overlay.id === 'wildfire' && (
                  <Text style={styles.statusNote}>
                    {wildfireFetchedAt === null
                      ? wildfireStatus === 'error'
                        ? 'No data yet — could not reach NIFC.'
                        : 'Loading current perimeters…'
                      : wildfireStatus === 'error'
                        ? `Offline? Showing the copy from ${formatAge(wildfireFetchedAt)}.`
                        : `Updated ${formatAge(wildfireFetchedAt)}.`}
                    {wildfireStatus === 'error' && wildfireError ? ` (${wildfireError})` : ''}
                  </Text>
                )}
                {on && overlay.legend && (
                  <View style={styles.legendRow}>
                    {overlay.legend.map((entry) => (
                      <View key={entry.label} style={styles.legendItem}>
                        <View style={[styles.legendSwatch, { backgroundColor: entry.color }]} />
                        <Text style={styles.legendLabel}>{entry.label}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {on && (
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
            );
          })}
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
        From OpenStreetMap (© OpenStreetMap contributors) — not your own pins. Pre-loaded for the
        southwest Idaho starter region; for other states use Downloads → State overlays, or Pick an area.
      </Text>

      <Text style={styles.legendNote}>
        Public land legend: green = open access, amber (dashed) = restricted, red = closed,
        blue-gray = unknown access. Purple-tinted areas are not in public-land data — likely
        private (inferred), not verified; tribal land and land with missing data can be tinted too.
        Source:{' '}
        {PUBLIC_LAND_META.source}, fetched {PUBLIC_LAND_META.fetchedAt.slice(0, 10)} — federal (
        {PUBLIC_LAND_META.agencies.map((a) => a.replace('PADUS_', '')).join(', ')}) plus
        state/local/district public land. Tap a polygon for its manager and access.
      </Text>

      <Text style={styles.legendNote}>
        MVUM legend: green = passenger cars (maintenance level 3+), orange = high-clearance roads
        (level 2), purple = OHV/motorcycle trails only; dashed = seasonal. Tap a road for its MVUM
        designation — check the current MVUM for dates before relying on it. Source:{' '}
        {MVUM_META.source}, fetched {MVUM_META.fetchedAt.slice(0, 10)}.
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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 16, gap: 8 },
    sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 8 },
    baseMapRow: { flexDirection: 'row', gap: 8 },
    baseMapButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: c.chip,
      alignItems: 'center',
    },
    baseMapButtonActive: { backgroundColor: c.primary },
    baseMapButtonText: { fontWeight: '600' },
    baseMapButtonTextActive: { color: c.onPrimary },
    overlayRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border },
    overlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    overlayLabel: { fontSize: 15, flex: 1 },
    groupBlurb: { fontSize: 12, color: c.textFaint, marginTop: -4, marginBottom: 4 },
    onlineTag: { fontSize: 10, color: c.textFaint, textTransform: 'uppercase' },
    statusNote: { marginTop: 4, fontSize: 12, color: c.textMuted },
    legendRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 8 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendSwatch: {
      width: 12,
      height: 12,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
    },
    legendLabel: { fontSize: 12, color: c.textSecondary },
    poiDot: { width: 10, height: 10, borderRadius: 5 },
    poiSourceNote: { marginTop: 4, fontSize: 12, color: c.textFaint },
    downloadsLink: { marginTop: 6, alignSelf: 'flex-start' },
    downloadsLinkText: { fontSize: 13, fontWeight: '600', color: c.primaryText },
    opacityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
    opacityLabel: { flex: 1, color: c.textMuted },
    opacityButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    legendNote: { marginTop: 16, fontSize: 12, color: c.textMuted, lineHeight: 18 },
    newViewRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    newViewInput: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: c.field,
    },
    newViewButton: {
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: c.primary,
    },
    newViewButtonText: { color: c.onPrimary, fontWeight: '700' },
    savedViewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
    },
    savedViewName: { flex: 1, fontSize: 15 },
    savedViewAction: { color: c.primaryText, fontWeight: '600' },
    savedViewDelete: { color: c.danger },
  });
