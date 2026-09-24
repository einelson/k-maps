import { useCallback, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';

import { bulkDelete, bulkSetColor, bulkSetFolder, listFeatures } from '../data/featuresRepo';
import { listFolders } from '../data/foldersRepo';
import { addTagToFeature, getOrCreateTag, listTags } from '../data/tagsRepo';
import type { Feature, Folder, Tag } from '../data/types';
import { exportFeatures } from '../data/importExport';
import { FEATURE_COLOR_PALETTE } from '../features/colorPalette';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useFiltersStore } from '../state/useFiltersStore';
import { FolderPickerModal } from './components/FolderPickerModal';
import { PickerModal } from './components/PickerModal';

function featureSubtitle(feature: Feature): string {
  if (feature.type === 'line' && feature.length_m != null) {
    return `Line · ${(feature.length_m / 1000).toFixed(2)} km`;
  }
  if (feature.type === 'polygon' && feature.area_m2 != null) {
    return `Area · ${(feature.area_m2 / 4046.86).toFixed(2)} ac`;
  }
  return 'Point';
}

type ActiveModal = 'move' | 'color' | 'tag' | null;

export function ItemsScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const filters = useFiltersStore((s) => s.filters);
  const setFilters = useFiltersStore((s) => s.setFilters);

  const [items, setItems] = useState<Feature[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [newTagName, setNewTagName] = useState('');

  const reload = useCallback(async () => {
    const [rows, folderRows, tagRows] = await Promise.all([
      listFeatures(db, {
        folderIds: filters.folderIds,
        types: filters.types,
        colors: filters.colors,
        tagIds: filters.tagIds,
        text: filters.text,
      }),
      listFolders(db),
      listTags(db),
    ]);
    setItems(rows);
    setFolders(folderRows);
    setTags(tagRows);
  }, [db, filters]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  function toggleTagFilter(tagId: number) {
    const current = filters.tagIds ?? [];
    const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
    setFilters({ ...filters, tagIds: next.length ? next : null });
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  async function handleMoveTo(folderId: number | null) {
    await bulkSetFolder(db, [...selectedIds], folderId);
    setActiveModal(null);
    exitSelection();
    reload();
  }

  async function handleRecolor(color: string) {
    await bulkSetColor(db, [...selectedIds], color);
    setActiveModal(null);
    exitSelection();
    reload();
  }

  async function handleTag(tag: Tag) {
    await Promise.all([...selectedIds].map((id) => addTagToFeature(db, id, tag.id)));
    setActiveModal(null);
    exitSelection();
    reload();
  }

  async function handleCreateTag(name: string) {
    if (!name.trim()) return;
    const tagId = await getOrCreateTag(db, name.trim());
    await Promise.all([...selectedIds].map((id) => addTagToFeature(db, id, tagId)));
    setActiveModal(null);
    exitSelection();
    reload();
  }

  function confirmBulkDelete() {
    Alert.alert('Delete items?', `Delete ${selectedIds.size} item(s)? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await bulkDelete(db, [...selectedIds]);
          exitSelection();
          reload();
        },
      },
    ]);
  }

  async function handleBulkExport() {
    const selected = items.filter((item) => selectedIds.has(item.id));
    try {
      await exportFeatures(selected, 'gpx', 'selected-items');
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search name or notes…"
          value={filters.text ?? ''}
          onChangeText={(text) => setFilters({ ...filters, text: text || undefined })}
        />
        <Pressable
          onPress={() => (selecting ? exitSelection() : setSelecting(true))}
          style={styles.selectToggle}
        >
          <Text style={styles.selectToggleText}>{selecting ? 'Done' : 'Select'}</Text>
        </Pressable>
      </View>

      {tags.length > 0 && (
        <View style={styles.tagRow}>
          {tags.map((tag) => {
            const active = (filters.tagIds ?? []).includes(tag.id);
            return (
              <Pressable
                key={tag.id}
                style={[styles.tagChip, active && styles.tagChipActive]}
                onPress={() => toggleTagFilter(tag.id)}
              >
                <Text style={active ? styles.tagChipTextActive : styles.tagChipText}>{tag.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={<Text style={styles.empty}>No items yet. Drop a pin on the map.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              selecting
                ? toggleSelected(item.id)
                : navigation.navigate('FeatureDetail', { featureId: item.id })
            }
            onLongPress={() => {
              setSelecting(true);
              toggleSelected(item.id);
            }}
          >
            {selecting && (
              <View style={[styles.checkbox, selectedIds.has(item.id) && styles.checkboxChecked]} />
            )}
            <View style={[styles.colorDot, { backgroundColor: item.color ?? '#999' }]} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.name || 'Untitled'}</Text>
              <Text style={styles.rowSubtitle}>{featureSubtitle(item)}</Text>
            </View>
          </Pressable>
        )}
      />

      {selecting && selectedIds.size > 0 && (
        <View style={styles.actionBar}>
          <Pressable style={styles.actionButton} onPress={() => setActiveModal('move')}>
            <Text style={styles.actionButtonText}>Move</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => setActiveModal('color')}>
            <Text style={styles.actionButtonText}>Recolor</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => setActiveModal('tag')}>
            <Text style={styles.actionButtonText}>Tag</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handleBulkExport}>
            <Text style={styles.actionButtonText}>Export</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={confirmBulkDelete}>
            <Text style={[styles.actionButtonText, styles.actionButtonDanger]}>Delete</Text>
          </Pressable>
        </View>
      )}

      <FolderPickerModal
        visible={activeModal === 'move'}
        folders={folders}
        onFoldersChanged={reload}
        onSelect={handleMoveTo}
        onClose={() => setActiveModal(null)}
      />
      <PickerModal
        visible={activeModal === 'color'}
        title="Recolor"
        items={FEATURE_COLOR_PALETTE}
        keyExtractor={(c) => c}
        renderLabel={(c) => (
          <View style={styles.colorSwatchRow}>
            <View style={[styles.colorDot, { backgroundColor: c }]} />
            <Text>{c}</Text>
          </View>
        )}
        onSelect={handleRecolor}
        onClose={() => setActiveModal(null)}
      />
      <Modal
        visible={activeModal === 'tag'}
        animationType="slide"
        transparent
        onRequestClose={() => setActiveModal(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setActiveModal(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Add tag</Text>
            <View style={styles.newTagRow}>
              <TextInput
                style={styles.newTagInput}
                placeholder="New tag name…"
                value={newTagName}
                onChangeText={setNewTagName}
                onSubmitEditing={() => {
                  handleCreateTag(newTagName);
                  setNewTagName('');
                }}
              />
              <Pressable
                style={styles.newTagButton}
                onPress={() => {
                  handleCreateTag(newTagName);
                  setNewTagName('');
                }}
              >
                <Text style={styles.newTagButtonText}>Add</Text>
              </Pressable>
            </View>
            {tags.map((tag) => (
              <Pressable key={tag.id} style={styles.sheetRow} onPress={() => handleTag(tag)}>
                <Text>{tag.name}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.cancelButton} onPress={() => setActiveModal(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 12 },
  search: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  selectToggle: { paddingHorizontal: 10, paddingVertical: 8 },
  selectToggleText: { color: '#2f6f4f', fontWeight: '700' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 12, marginTop: 10 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#eee' },
  tagChipActive: { backgroundColor: '#2f6f4f' },
  tagChipText: { fontSize: 12, fontWeight: '600' },
  tagChipTextActive: { fontSize: 12, fontWeight: '600', color: 'white' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
    gap: 12,
  },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#999' },
  checkboxChecked: { backgroundColor: '#2f6f4f', borderColor: '#2f6f4f' },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  colorSwatchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSubtitle: { fontSize: 13, color: '#666' },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: 'white',
  },
  actionButton: { paddingHorizontal: 8, paddingVertical: 6 },
  actionButtonText: { color: '#2f6f4f', fontWeight: '700' },
  actionButtonDanger: { color: '#c0392b' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '70%',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  sheetRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
  newTagRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  newTagInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  newTagButton: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#2f6f4f',
  },
  newTagButtonText: { color: 'white', fontWeight: '700' },
  cancelButton: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { color: '#c0392b', fontWeight: '600' },
});
