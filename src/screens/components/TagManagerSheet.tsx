import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { createTag, deleteTag, listTagsWithCounts, renameTag, type TagWithCount } from '../../data/tagsRepo';
import { Text, TextInput, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';

interface TagManagerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after any add / rename / delete so the host can refresh its own lists. `deletedTagId` is set when a tag was removed. */
  onChanged: (change: { deletedTagId?: number }) => void;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Add, rename and delete tags. Deleting takes a tag off every item; the items themselves are never deleted. */
export function TagManagerSheet({ visible, onClose, onChanged }: TagManagerSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="85%">
      {/* Mounted only while open, so it reloads the tags (and clears any half-typed edit) each time. */}
      <TagManager onClose={onClose} onChanged={onChanged} />
    </BottomSheet>
  );
}

function TagManager({ onClose, onChanged }: Omit<TagManagerSheetProps, 'visible'>) {
  const db = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const [tags, setTags] = useState<TagWithCount[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => setTags(await listTagsWithCounts(db)), [db]);
  useEffect(() => {
    listTagsWithCounts(db)
      .then(setTags)
      .catch((err) => setError(errorMessage(err)));
  }, [db]);

  /** Runs a change, refreshes the list and tells the host; a thrown error (empty / duplicate name) is shown inline. */
  async function apply(change: () => Promise<{ deletedTagId?: number } | void>): Promise<boolean> {
    setError(null);
    try {
      const result = await change();
      await reload();
      onChanged(result ?? {});
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function add() {
    if (await apply(() => createTag(db, newName).then(() => undefined))) setNewName('');
  }

  async function saveRename(id: number) {
    if (await apply(() => renameTag(db, id, editName))) setEditingId(null);
  }

  function confirmDelete(tag: TagWithCount) {
    const effect =
      tag.count === 0
        ? 'No items use it.'
        : `It will be removed from ${tag.count} item${tag.count === 1 ? '' : 's'}. The items themselves are kept.`;
    Alert.alert(`Delete tag "${tag.name}"?`, effect, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (editingId === tag.id) setEditingId(null);
          apply(async () => {
            await deleteTag(db, tag.id);
            return { deletedTagId: tag.id };
          });
        },
      },
    ]);
  }

  return (
    <>
      <Text style={styles.title}>Tags</Text>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="New tag name…"
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={add}
          returnKeyType="done"
        />
        <Pressable style={styles.addButton} onPress={add}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {tags && tags.length === 0 && (
          <Text style={styles.empty}>No tags yet. Add one above, or tag items from My Content → Select → Tag.</Text>
        )}
        {tags?.map((tag) =>
          editingId === tag.id ? (
            <View key={tag.id} style={styles.row}>
              <TextInput
                style={[styles.input, styles.editInput]}
                value={editName}
                onChangeText={setEditName}
                onSubmitEditing={() => saveRename(tag.id)}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
              />
              <Pressable onPress={() => saveRename(tag.id)} hitSlop={6}>
                <Text style={styles.action}>Save</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setEditingId(null);
                  setError(null);
                }}
                hitSlop={6}
              >
                <Text style={styles.muted}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View key={tag.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.tagName}>{tag.name}</Text>
                <Text style={styles.count}>
                  {tag.count} item{tag.count === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setEditingId(tag.id);
                  setEditName(tag.name);
                  setError(null);
                }}
                hitSlop={6}
              >
                <Text style={styles.action}>Rename</Text>
              </Pressable>
              <Pressable onPress={() => confirmDelete(tag)} hitSlop={6}>
                <Text style={styles.danger}>Delete</Text>
              </Pressable>
            </View>
          )
        )}
      </ScrollView>

      <Pressable style={styles.done} onPress={onClose}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
    addRow: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: c.field },
    editInput: { paddingVertical: 6 },
    addButton: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 8, backgroundColor: c.primary },
    addButtonText: { color: c.onPrimary, fontWeight: '700' },
    error: { color: c.danger, fontSize: 13, marginTop: 8 },
    list: { flexGrow: 0, marginTop: 8 },
    empty: { color: c.textFaint, paddingVertical: 16, textAlign: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
    },
    rowText: { flex: 1 },
    tagName: { fontSize: 16, fontWeight: '600' },
    count: { fontSize: 12, color: c.textMuted, marginTop: 1 },
    action: { color: c.primaryText, fontWeight: '700' },
    muted: { color: c.textMuted, fontWeight: '600' },
    danger: { color: c.danger, fontWeight: '700' },
    done: { paddingVertical: 14, alignItems: 'center' },
    doneText: { color: c.primaryText, fontWeight: '700' },
  });
