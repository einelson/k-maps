import { Pressable, StyleSheet, View } from 'react-native';

import { TRANSPORT_MODES, type TransportId } from '../../features/transport';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';

interface TransportChipsProps {
  value: TransportId | null;
  /** Called with the tapped mode, or null when the selected one is tapped again (unless `allowClear` is off). */
  onChange: (value: TransportId | null) => void;
  /** Tapping the selected chip clears it. Off where a choice is required. */
  allowClear?: boolean;
}

/** One chip per way of getting around, the selected one filled in. */
export function TransportChips({ value, onChange, allowClear = true }: TransportChipsProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      {TRANSPORT_MODES.map((mode) => {
        const selected = mode.id === value;
        return (
          <Pressable
            key={mode.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => onChange(selected && allowClear ? null : mode.id)}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{mode.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface TransportSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Picking a mode is what starts the recording, so there is no separate confirm step. */
  onSelect: (value: TransportId) => void;
}

/** What opens when you tap "Record track": how you're getting around decides how often the GPS is sampled. */
export function TransportSheet({ visible, onClose, onSelect }: TransportSheetProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>How are you getting around?</Text>
      <Text style={styles.hint}>Tap one to start recording. It sets how often your position is saved.</Text>
      <TransportChips value={null} allowClear={false} onChange={(id) => id && onSelect(id)} />
      <Pressable style={styles.cancel} onPress={onClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: c.chip },
    chipSelected: { backgroundColor: c.primary },
    chipText: { fontSize: 14, fontWeight: '600' },
    chipTextSelected: { color: c.onPrimary },
    title: { fontSize: 16, fontWeight: '700' },
    hint: { fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 8 },
    cancel: { paddingVertical: 14, alignItems: 'center' },
    cancelText: { color: c.danger, fontWeight: '600' },
  });
