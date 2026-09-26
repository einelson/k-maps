import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import type { CoverageRow } from '../../data/types';
import { LAYER_LABELS, packOption } from '../../downloads/downloadOptions';
import { formatBytes } from '../../downloads/formatBytes';
import { freeDiskBytes } from '../../downloads/freeSpace';
import { deletePackCells, deletePackData } from '../../downloads/packDownloader';
import { cellsToDelete, groupStorageByState, type LayerStorage, type StateStorage } from '../../downloads/stateStorage';
import type { PackLayerId } from '../../packs/types';
import { usePackStore } from '../../state/usePackStore';
import { useRegionPackStore } from '../../state/useRegionPackStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

interface Props {
  coverage: CoverageRow[];
  reloadCoverage: () => Promise<void>;
}

const ELSEWHERE_KEY = 'elsewhere';
const groupKey = (group: StateStorage) => group.state?.code ?? ELSEWHERE_KEY;
const squaresText = (count: number) => `${count} square${count === 1 ? '' : 's'}`;

/**
 * Downloads -> "On this phone": what is stored, split by state, with how much space it takes and a way to remove
 * overlay data a state at a time. Below that, the same data by layer, for removing a layer everywhere at once.
 */
export function OnDeviceTab({ coverage, reloadCoverage }: Props) {
  const appDb = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bumpPacks = usePackStore((s) => s.bump);
  const forgetRegionLayer = useRegionPackStore((s) => s.forgetRegionLayer);
  const forgetLayer = useRegionPackStore((s) => s.forgetLayer);
  /** Cards the user opened or folded by hand; the rest are open only when there is a single one. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => groupStorageByState(coverage), [coverage]);
  const groups = useMemo(
    () => (grouped.elsewhere ? [...grouped.states, grouped.elsewhere] : grouped.states),
    [grouped]
  );

  const byLayer = useMemo(() => {
    const map = new Map<string, { squares: number; bytes: number }>();
    for (const row of coverage) {
      if (row.status !== 'complete' && row.status !== 'partial') continue;
      const entry = map.get(row.layer) ?? { squares: 0, bytes: 0 };
      entry.squares += 1;
      entry.bytes += row.bytes ?? 0;
      map.set(row.layer, entry);
    }
    return [...map.entries()].sort(([a], [b]) => (LAYER_LABELS[a] ?? a).localeCompare(LAYER_LABELS[b] ?? b));
  }, [coverage]);
  const free = freeDiskBytes();

  async function afterDelete() {
    await reloadCoverage();
    bumpPacks();
  }

  /** Deletes some overlay layers of one state (or of the squares in no state), leaving squares a neighbour needs. */
  function confirmDeleteInState(group: StateStorage, layers: string[]) {
    const code = group.state?.code ?? null;
    const plans = layers.map((layer) => ({ layer, ...cellsToDelete(code, layer, coverage) }));
    const removing = plans.reduce((sum, plan) => sum + plan.remove.length, 0);
    const kept = plans.reduce((sum, plan) => sum + plan.kept, 0);
    const where = group.state?.name ?? 'squares outside any state';
    const what = layers.length === 1 ? (LAYER_LABELS[layers[0]] ?? layers[0]) : 'all overlay data';
    const keptNote =
      kept > 0
        ? ` ${squaresText(kept)} on the line with a neighbouring state stay, because that state still uses ${kept === 1 ? 'it' : 'them'}.`
        : '';

    if (removing === 0) {
      Alert.alert(`Nothing to delete for ${where}`, keptNote.trim() || 'There is nothing of that on this phone.');
      return;
    }
    Alert.alert(
      `Delete ${what} for ${where}?`,
      `${squaresText(removing)} ${removing === 1 ? 'is' : 'are'} removed from this phone. You can download ${removing === 1 ? 'it' : 'them'} again later, and they also reload by themselves as you browse the map online.${keptNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const { layer, remove } of plans) {
              await deletePackCells(appDb, layer as PackLayerId, remove);
              if (group.state) forgetRegionLayer(group.state.id, layer as PackLayerId);
            }
            await afterDelete();
          },
        },
      ]
    );
  }

  function confirmDeleteEverywhere(layer: string) {
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
            forgetLayer(layer as PackLayerId);
            await afterDelete();
          },
        },
      ]
    );
  }

  const canRemove = (layer: LayerStorage) => Boolean(packOption(layer.layer));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
    >
      <Text style={styles.lead}>
        {byLayer.length === 0
          ? 'Nothing is saved on this phone yet.'
          : `${formatBytes(grouped.totalBytes)} saved on this phone${free !== null ? ` · ${formatBytes(free)} free` : ''}`}
      </Text>

      {byLayer.length === 0 && (
        <Text style={styles.body}>
          Use Pick an area or Ready-made to save maps and data for offline use. Public land, forest roads and trails
          also save themselves as you browse the main map online.
        </Text>
      )}

      {groups.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>By state</Text>
          <Text style={styles.body}>
            Squares on a state line show under both states, so the sizes below can add up to more than the total.
          </Text>
        </>
      )}

      {groups.map((group) => {
        const key = groupKey(group);
        const open = expanded[key] ?? groups.length === 1;
        const removable = group.layers.filter(canRemove).map((layer) => layer.layer);
        return (
          <View key={key} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              style={styles.cardHeader}
              onPress={() => setExpanded((prev) => ({ ...prev, [key]: !open }))}
            >
              <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
              <Text style={styles.cardName}>{group.state?.name ?? 'Outside any state'}</Text>
              <Text style={styles.cardSummary}>{group.bytes > 0 ? formatBytes(group.bytes) : ''}</Text>
            </Pressable>
            {open &&
              group.layers.map((layer) => (
                <View key={layer.layer} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{LAYER_LABELS[layer.layer] ?? layer.layer}</Text>
                    <Text style={styles.rowNote}>
                      {group.state
                        ? `${layer.squares} of ${squaresText(group.totalSquares)}`
                        : squaresText(layer.squares)}
                      {layer.bytes > 0 ? ` · ${formatBytes(layer.bytes)}` : ''}
                    </Text>
                  </View>
                  {canRemove(layer) && (
                    <Pressable
                      onPress={() => confirmDeleteInState(group, [layer.layer])}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${LAYER_LABELS[layer.layer] ?? layer.layer} for ${group.state?.name ?? 'squares outside any state'}`}
                    >
                      <Text style={styles.delete}>Delete</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            {open && removable.length > 1 && (
              <Pressable onPress={() => confirmDeleteInState(group, removable)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.deleteAll}>Delete all overlay data for {group.state?.name ?? 'these squares'}</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {byLayer.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>By layer, everywhere</Text>
          {byLayer.map(([layer, { squares, bytes }]) => (
            <View key={layer} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{LAYER_LABELS[layer] ?? layer}</Text>
                <Text style={styles.rowNote}>
                  {squaresText(squares)}
                  {bytes > 0 ? ` · ${formatBytes(bytes)}` : ''}
                </Text>
              </View>
              {packOption(layer) && (
                <Pressable
                  onPress={() => confirmDeleteEverywhere(layer)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${LAYER_LABELS[layer] ?? layer} everywhere`}
                >
                  <Text style={styles.delete}>Delete</Text>
                </Pressable>
              )}
            </View>
          ))}
        </>
      )}

      {byLayer.some(([layer]) => !packOption(layer)) && (
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
    sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 10 },
    body: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    card: { gap: 4 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    chevron: { width: 16, color: c.textMuted },
    cardName: { flex: 1, fontWeight: '600', fontSize: 15 },
    cardSummary: { color: c.textMuted, fontSize: 12 },
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
    deleteAll: { color: c.danger, fontWeight: '600', fontSize: 13, paddingVertical: 6 },
  });
