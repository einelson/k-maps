import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import type { CoverageRow } from '../../data/types';
import { LAYER_LABELS, packOption } from '../../downloads/downloadOptions';
import { formatBytes } from '../../downloads/formatBytes';
import { freeDiskBytes } from '../../downloads/freeSpace';
import { deletePackData } from '../../downloads/packDownloader';
import type { PackLayerId } from '../../packs/types';
import { usePackStore } from '../../state/usePackStore';
import { useRegionPackStore } from '../../state/useRegionPackStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

interface Props {
  coverage: CoverageRow[];
  reloadCoverage: () => Promise<void>;
}

/** Downloads -> "On this phone": what is stored, how much space it takes, and a way to remove overlay data. */
export function OnDeviceTab({ coverage, reloadCoverage }: Props) {
  const appDb = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bumpPacks = usePackStore((s) => s.bump);
  const forgetRegionLayer = useRegionPackStore((s) => s.forgetLayer);

  const storage = useMemo(() => {
    const byLayer = new Map<string, { squares: number; bytes: number }>();
    for (const row of coverage) {
      if (row.status !== 'complete' && row.status !== 'partial') continue;
      const entry = byLayer.get(row.layer) ?? { squares: 0, bytes: 0 };
      entry.squares += 1;
      entry.bytes += row.bytes ?? 0;
      byLayer.set(row.layer, entry);
    }
    return [...byLayer.entries()].sort(([a], [b]) => (LAYER_LABELS[a] ?? a).localeCompare(LAYER_LABELS[b] ?? b));
  }, [coverage]);
  const totalBytes = storage.reduce((sum, [, { bytes }]) => sum + bytes, 0);
  const free = freeDiskBytes();

  function confirmDelete(layer: string) {
    Alert.alert(
      `Delete ${LAYER_LABELS[layer] ?? layer}?`,
      'It is removed from this phone. You can download it again later, and it also reloads by itself as you browse the map online.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePackData(appDb, layer as PackLayerId);
            forgetRegionLayer(layer as PackLayerId);
            await reloadCoverage();
            bumpPacks();
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
    >
      <Text style={styles.lead}>
        {storage.length === 0
          ? 'Nothing is saved on this phone yet.'
          : `${formatBytes(totalBytes)} saved on this phone${free !== null ? ` · ${formatBytes(free)} free` : ''}`}
      </Text>

      {storage.length === 0 && (
        <Text style={styles.body}>
          Use Pick an area or Ready-made to save maps and data for offline use. Public land, forest roads and trails
          also save themselves as you browse the main map online.
        </Text>
      )}

      {storage.map(([layer, { squares, bytes }]) => (
        <View key={layer} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{LAYER_LABELS[layer] ?? layer}</Text>
            <Text style={styles.rowNote}>
              {squares} square{squares === 1 ? '' : 's'}
              {bytes > 0 ? ` · ${formatBytes(bytes)}` : ''}
            </Text>
          </View>
          {packOption(layer) && (
            <Pressable onPress={() => confirmDelete(layer)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.delete}>Delete</Text>
            </Pressable>
          )}
        </View>
      ))}

      {storage.some(([layer]) => !packOption(layer)) && (
        <Text style={styles.body}>Offline map pictures can&rsquo;t be removed one square at a time yet.</Text>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 16, gap: 8 },
    lead: { fontSize: 15, fontWeight: '600' },
    body: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    rowText: { flex: 1 },
    rowLabel: { fontWeight: '600', fontSize: 14 },
    rowNote: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    delete: { color: c.danger, fontWeight: '600' },
  });
