import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { flattenFolders } from '../../data/folderTree';
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
  title?: string;
  /** What the "no folder" row is called ("None" for a pin, "Top level" for a folder being moved). */
  noneLabel?: string;
  /** Folders (and everything inside them) that can't be picked — the folder being moved can't go inside itself. */
  excludeIds?: number[];
  /** Marked with a check, so you can see where the item is now. */
  currentFolderId?: number | null;
}

/** Folder picker showing the nested structure, with inline "+ new folder" (created at the top level). */
export function FolderPickerModal({
  visible,
  folders,
  onSelect,
  onFoldersChanged,
  onClose,
  title = 'Move to folder',
  noneLabel = 'None',
  excludeIds,
  currentFolderId,
}: FolderPickerModalProps) {
  const db = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => flattenFolders(folders, excludeIds), [folders, excludeIds]);

  async function handleCreate() {
    try {
      const id = await createFolder(db, { name: newFolderName });
      setNewFolderName('');
      setError(null);
      onFoldersChanged();
      onSelect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
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
      {error && <Text style={styles.error}>{error}</Text>}
      <ScrollView style={styles.list}>
        <Pressable style={styles.row} onPress={() => onSelect(null)}>
          <Text style={styles.label}>{noneLabel}</Text>
          {currentFolderId === null && <Text style={styles.check}>✓</Text>}
        </Pressable>
        {rows.map(({ folder, depth }) => (
          <Pressable
            key={folder.id}
            style={[styles.row, { paddingLeft: depth * 20 }]}
            onPress={() => onSelect(folder.id)}
          >
            <View style={[styles.dot, { backgroundColor: folder.color ?? '#999' }]} />
            <Text style={styles.label}>{folder.name}</Text>
            {currentFolderId === folder.id && <Text style={styles.check}>✓</Text>}
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
    error: { color: c.danger, fontSize: 13, marginBottom: 8 },
    list: { flexGrow: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
    },
    label: { flex: 1 },
    check: { color: c.primaryText, fontWeight: '700' },
    dot: { width: 10, height: 10, borderRadius: 5 },
    cancelButton: { paddingVertical: 14, alignItems: 'center' },
    cancelText: { color: c.danger, fontWeight: '600' },
  });
