import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration } from '../../features/formatUnits';
import type { TrackSamples } from '../../features/trackStats';
import { transportLabel } from '../../features/transport';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useTrackRecordingStore } from '../../state/useTrackRecordingStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';
import { TrackDashboard } from './TrackDashboard';
import { useNow } from './useNow';

interface RecordingPanelProps {
  visible: boolean;
  /** Tap outside the panel. The recording carries on. */
  onClose: () => void;
  /** Save the track and stop recording. */
  onEnd: () => void;
  /** Throw the recording away (already confirmed with the user). */
  onDelete: () => void;
  /** An end or delete is in flight; both buttons wait. */
  busy?: boolean;
}

/**
 * What opens when you tap the recording button: the track so far (live time and distance, then the same
 * stats and charts a saved track shows) and the two ways to finish — Delete, or End & save.
 */
export function RecordingPanel({ visible, onClose, onEnd, onDelete, busy = false }: RecordingPanelProps) {
  const styles = useThemedStyles(makeStyles);
  const units = useSettingsStore((s) => s.units);
  const startedAt = useTrackRecordingStore((s) => s.startedAt);
  const transport = useTrackRecordingStore((s) => s.transport);
  const points = useTrackRecordingStore((s) => s.points);
  const times = useTrackRecordingStore((s) => s.times);
  const altitudes = useTrackRecordingStore((s) => s.altitudes);
  const distanceM = useTrackRecordingStore((s) => s.distanceM);
  const interrupted = useTrackRecordingStore((s) => s.interrupted);
  const resumedAfterGap = useTrackRecordingStore((s) => s.resumedAfterGap);
  // Only ticks while the panel is open: a Modal that isn't visible still keeps its children mounted.
  const now = useNow(visible ? 1000 : 60_000);
  const samples = useMemo<TrackSamples>(() => ({ times, elevations: altitudes }), [times, altitudes]);

  function confirmDelete() {
    Alert.alert(
      'Delete this recording?',
      `The ${formatDistance(distanceM, units)} recorded so far will be thrown away. This can't be undone.`,
      [
        { text: 'Keep recording', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="88%">
      <View style={styles.header}>
        <View style={[styles.dot, interrupted && styles.dotStopped]} />
        <Text style={styles.title}>
          {interrupted ? 'Recording stopped' : 'Recording track'}
          {transportLabel(transport) ? ` · ${transportLabel(transport)}` : ''}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.heroTime}>{startedAt == null ? '0:00' : formatDuration(now - startedAt)}</Text>
          <Text style={styles.heroDistance}>{formatDistance(distanceM, units)}</Text>
        </View>

        {interrupted && (
          <Text style={styles.warning}>
            Location updates stopped and couldn&apos;t be restarted, so nothing is being added. You can still save what
            was recorded, or delete it.
          </Text>
        )}

        {resumedAfterGap && !interrupted && (
          <Text style={styles.gapNote}>
            Recording stopped for a while (K-Maps was closed or the system paused it) and has been restarted. The
            track draws a straight line across that gap.
          </Text>
        )}

        <TrackDashboard coordinates={points} samples={samples} recorded live />
      </ScrollView>

      <View style={styles.buttons}>
        <Pressable style={[styles.button, styles.deleteButton, busy && styles.disabled]} onPress={confirmDelete} disabled={busy}>
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.endButton, busy && styles.disabled]} onPress={onEnd} disabled={busy}>
          <Text style={styles.endText}>End &amp; save</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
    dotStopped: { backgroundColor: c.disabled },
    title: { fontSize: 14, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase' },
    scroll: { flexShrink: 1 },
    scrollContent: { gap: 16, paddingBottom: 8 },
    hero: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    heroTime: { fontSize: 40, fontWeight: '800' },
    heroDistance: { fontSize: 24, fontWeight: '700', color: c.primaryText },
    gapNote: { fontSize: 13, color: c.textMuted, backgroundColor: c.field, borderRadius: 8, padding: 10 },
    warning: { fontSize: 13, color: c.danger, backgroundColor: c.dangerTint, borderRadius: 8, padding: 10 },
    buttons: { flexDirection: 'row', gap: 12, marginTop: 12 },
    button: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    deleteButton: { borderWidth: 1, borderColor: c.danger },
    deleteText: { color: c.danger, fontWeight: '700' },
    endButton: { backgroundColor: c.primary },
    endText: { color: c.onPrimary, fontWeight: '700' },
    disabled: { opacity: 0.5 },
  });
