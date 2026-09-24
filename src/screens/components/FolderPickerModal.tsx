import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { createFolder } from '../../data/foldersRepo';
import type { Folder } from '../../data/types';

interface FolderPickerModalProps {
  visible: boolean;
  folders: Folder[];
  onSelect: (folderId: number | null) => void;
  onFoldersChanged: () => void;
  onClose: () => void;
}

/** Folder picker with inline "+ new folder" — the one place folders get created in the UI. */
export function FolderPickerModal({
  visible,
  folders,
  onSelect,
  onFoldersChanged,
  onClose,
}: FolderPickerModalProps) {
  const db = useSQLiteContext();
  const [newFolderName, setNewFolderName] = useState('');

  async function handleCreate() {
    if (!newFolderName.trim()) return;
    const id = await createFolder(db, { name: newFolderName.trim() });
    setNewFolderName('');
    onFoldersChanged();
    onSelect(id);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Move to folder</Text>
          <View style={styles.newRow}>
            <TextInput
              style={styles.newInput}
              placeholder="New folder name…"
              value={newFolderName}
              onChangeText={setNewFolderName}
              onSubmitEditing={handleCreate}
            />
            <Pressable style={styles.newButton} onPress={handleCreate}>
              <Text style={styles.newButtonText}>Create</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list}>
            <Pressable style={styles.row} onPress={() => onSelect(null)}>
              <Text>None</Text>
            </Pressable>
            {folders.map((folder) => (
              <Pressable key={folder.id} style={styles.row} onPress={() => onSelect(folder.id)}>
                <View style={[styles.dot, { backgroundColor: folder.color ?? '#999' }]} />
                <Text>{folder.name}</Text>
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
  title: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  newRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  newInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f0f0f0' },
  newButton: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 8, backgroundColor: '#2f6f4f' },
  newButtonText: { color: 'white', fontWeight: '700' },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cancelButton: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { color: '#c0392b', fontWeight: '600' },
});
