import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';

interface PickerModalProps<T> {
  visible: boolean;
  title: string;
  items: T[];
  keyExtractor: (item: T) => string;
  renderLabel: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  onClose: () => void;
}

/** Shared bottom-sheet-style list picker, used for folder/color/tag pickers in the Items multi-select bar. */
export function PickerModal<T>({
  visible,
  title,
  items,
  keyExtractor,
  renderLabel,
  onSelect,
  onClose,
}: PickerModalProps<T>) {
  const styles = useThemedStyles(makeStyles);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView style={styles.list}>
        {items.map((item) => (
          <Pressable key={keyExtractor(item)} style={styles.row} onPress={() => onSelect(item)}>
            {renderLabel(item)}
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
    list: { flexGrow: 0 },
    row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.divider },
    cancelButton: { paddingVertical: 14, alignItems: 'center' },
    cancelText: { color: c.danger, fontWeight: '600' },
  });
