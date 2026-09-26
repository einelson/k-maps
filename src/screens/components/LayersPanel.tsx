import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';

import { BASE_MAPS, groupedOverlays, type OverlayGroupId } from '../../map/layerOptions';
import { useLayersStore } from '../../state/useLayersStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

interface LayersPanelProps {
  /** Distance from the top of the map area — sits just under the layers button. */
  top: number;
  /** Space to leave clear below the panel (toolbar, coordinate readout). */
  bottomClearance: number;
  /** Opens the full Layers screen (opacity, POIs, offline maps, saved views, legends). */
  onOpenAdvanced: () => void;
  /** Opens the Downloads screen — for overlays (hunting units) whose other regions are downloaded there. */
  onOpenDownloads: () => void;
}

const GROUPS = groupedOverlays();

/**
 * Quick layer controls that drop down from the map's layers button: pick the base map and switch
 * overlays like public land on and off while watching the map change underneath. Overlays are
 * sorted into groups (land, roads & trails, water & terrain, hazards) that fold away; a group opens
 * with its first section or whenever one of its layers is on. Everything finer-grained stays on the
 * full Layers screen.
 */
export function LayersPanel({ top, bottomClearance, onOpenAdvanced, onOpenDownloads }: LayersPanelProps) {
  const styles = useThemedStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const baseMap = useLayersStore((s) => s.baseMap);
  const setBaseMap = useLayersStore((s) => s.setBaseMap);
  const overlayVisibility = useLayersStore((s) => s.overlayVisibility);
  const setOverlayVisible = useLayersStore((s) => s.setOverlayVisible);

  // Which groups are folded away. Starts with only the groups that have something switched on (and the first) open.
  const [collapsed, setCollapsed] = useState<Record<OverlayGroupId, boolean>>(() => {
    const initial = {} as Record<OverlayGroupId, boolean>;
    GROUPS.forEach(({ group, overlays }, index) => {
      initial[group.id] = index > 0 && !overlays.some((o) => overlayVisibility[o.id]);
    });
    return initial;
  });

  return (
    <View
      style={[
        styles.panel,
        { top, width: Math.min(340, width - 24), maxHeight: Math.max(200, height - top - bottomClearance) },
      ]}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Map type</Text>
        <View style={styles.baseMapRow}>
          {BASE_MAPS.map((mode) => {
            const selected = baseMap === mode.id;
            return (
              <Pressable
                key={mode.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.baseMapButton, selected && styles.baseMapButtonActive]}
                onPress={() => setBaseMap(mode.id)}
              >
                <Text style={[styles.baseMapText, selected && styles.baseMapTextActive]}>{mode.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, styles.layersLabel]}>Layers</Text>
        {GROUPS.map(({ group, overlays }) => {
          const isCollapsed = collapsed[group.id];
          const activeCount = overlays.filter((o) => overlayVisibility[o.id] && !o.disabled).length;
          return (
            <View key={group.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: !isCollapsed }}
                accessibilityLabel={`${group.label}, ${activeCount} on`}
                style={styles.groupHeader}
                onPress={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
              >
                <Text style={styles.groupChevron}>{isCollapsed ? '▸' : '▾'}</Text>
                <Text style={styles.groupLabel}>{group.label}</Text>
                {activeCount > 0 && (
                  <View style={styles.groupBadge}>
                    <Text style={styles.groupBadgeText}>{activeCount} on</Text>
                  </View>
                )}
              </Pressable>
              {!isCollapsed &&
                overlays.map((overlay) => (
                  <View key={overlay.id} style={styles.overlayItem}>
                    <View style={styles.overlayRow}>
                      <Text style={styles.overlayLabel}>{overlay.label}</Text>
                      {overlay.onlineOnly && <Text style={styles.onlineTag}>online</Text>}
                      <Switch
                        value={overlayVisibility[overlay.id] && !overlay.disabled}
                        onValueChange={(visible) => setOverlayVisible(overlay.id, visible)}
                        disabled={overlay.disabled}
                      />
                    </View>
                    {overlay.downloadsLink && (
                      <Pressable accessibilityRole="link" style={styles.downloadsLink} onPress={onOpenDownloads}>
                        <Text style={styles.downloadsLinkText}>{overlay.downloadsLink} →</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
            </View>
          );
        })}

        <Pressable style={styles.moreRow} onPress={onOpenAdvanced}>
          <Text style={styles.moreText}>More layer options…</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    panel: {
      position: 'absolute',
      right: 12,
      backgroundColor: c.surface,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 6,
      elevation: 6,
      shadowColor: c.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 },
    layersLabel: { marginTop: 14, marginBottom: 2 },
    baseMapRow: { flexDirection: 'row', gap: 8 },
    baseMapButton: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: c.chip, alignItems: 'center' },
    baseMapButtonActive: { backgroundColor: c.primary },
    baseMapText: { fontWeight: '600', fontSize: 13 },
    baseMapTextActive: { color: c.onPrimary },
    overlayItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.divider },
    overlayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    downloadsLink: { paddingBottom: 8, alignSelf: 'flex-start' },
    downloadsLinkText: { fontSize: 12, fontWeight: '600', color: c.primaryText },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    groupChevron: { width: 14, fontSize: 12, color: c.textMuted },
    groupLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: c.primaryText },
    groupBadge: { backgroundColor: c.primaryTint, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 1 },
    groupBadgeText: { fontSize: 11, fontWeight: '600', color: c.primaryText },
    overlayLabel: { flex: 1, fontSize: 14 },
    onlineTag: { fontSize: 10, color: c.textFaint, textTransform: 'uppercase' },
    moreRow: { paddingVertical: 12, alignItems: 'center' },
    moreText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
  });
