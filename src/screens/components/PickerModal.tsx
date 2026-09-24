import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

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
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: 'white', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '70%' },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  list: { flexGrow: 0 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
  cancelButton: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { color: '#c0392b', fontWeight: '600' },
});
