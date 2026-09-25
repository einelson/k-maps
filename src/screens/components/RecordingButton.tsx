import { Pressable, StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration } from '../../features/formatUnits';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useTrackRecordingStore } from '../../state/useTrackRecordingStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { useNow } from './useNow';

interface RecordingButtonProps {
  onPress: () => void;
}

/**
 * The button that's on the map for as long as a track is being recorded: "● 12:34 · 1.23 mi", counting up
 * live. Tapping it opens the recording panel (full stats, delete, end and save).
 */
export function RecordingButton({ onPress }: RecordingButtonProps) {
  const styles = useThemedStyles(makeStyles);
  const units = useSettingsStore((s) => s.units);
  const startedAt = useTrackRecordingStore((s) => s.startedAt);
  const distanceM = useTrackRecordingStore((s) => s.distanceM);
  const interrupted = useTrackRecordingStore((s) => s.interrupted);
  const now = useNow();

  if (startedAt == null) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={interrupted ? 'Recording stopped — show track stats' : 'Recording a track — show track stats'}
      style={styles.pill}
      onPress={onPress}
    >
      <View style={[styles.dot, interrupted && styles.dotStopped]} />
      <Text style={styles.text}>
        {formatDuration(now - startedAt)} · {formatDistance(distanceM, units)}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      backgroundColor: c.surface,
      elevation: 3,
      shadowColor: c.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
    dotStopped: { backgroundColor: c.disabled },
    text: { fontWeight: '700', fontSize: 14 },
  });
