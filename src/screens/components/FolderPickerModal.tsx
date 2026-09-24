import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { createFolder } from '../../data/foldersRepo';
import type { Folder } from '../../data/types';
import { Text, TextInput, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';

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
  const styles = useThemedStyles(makeStyles);
  const [newFolderName, setNewFolderName] = useState('');

  async function handleCreate() {
    if (!newFolderName.trim()) return;
    const id = await createFolder(db, { name: newFolderName.trim() });
    setNewFolderName('');
    onFoldersChanged();
    onSelect(id);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
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
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
    newRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    newInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: c.field },
    newButton: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 8, backgroundColor: c.primary },
    newButtonText: { color: c.onPrimary, fontWeight: '700' },
    list: { flexGrow: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    cancelButton: { paddingVertical: 14, alignItems: 'center' },
    cancelText: { color: c.danger, fontWeight: '600' },
  });
