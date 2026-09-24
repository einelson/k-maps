import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';

import { deleteFeature } from '../data/featuresRepo';
import { listFolders } from '../data/foldersRepo';
import {
  addTagToFeature,
  getOrCreateTag,
  listTags,
  listTagsForFeature,
  removeTagFromFeature,
} from '../data/tagsRepo';
import type { Feature, Folder, Tag } from '../data/types';
import { FEATURE_COLOR_PALETTE } from '../features/colorPalette';
import { openDirections } from '../features/directions';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { FolderPickerModal } from './components/FolderPickerModal';

/** GeoJSON coordinates are [lon, lat]; returns null for non-point geometry (or a Directions button doesn't apply). */
function parsePointLonLat(geometry: string): [number, number] | null {
  try {
    const parsed = JSON.parse(geometry) as { type: string; coordinates: unknown };
    return parsed.type === 'Point' ? (parsed.coordinates as [number, number]) : null;
  } catch {
    return null;
  }
}

/** Decimal degrees for now (§7.3 wants DMS/UTM too). */
function formatCoordinates(geometry: string): string {
  const point = parsePointLonLat(geometry);
  if (point) {
    const [lon, lat] = point;
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  try {
    return (JSON.parse(geometry) as { type: string }).type;
  } catch {
    return 'Unknown geometry';
  }
}

export function FeatureDetailScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'FeatureDetail'>>();
  const { featureId } = route.params;

  const [feature, setFeature] = useState<Feature | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [featureTags, setFeatureTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const load = useCallback(async () => {
    const [row, folderRows, tagRows, allTagRows] = await Promise.all([
      db.getFirstAsync<Feature>('SELECT * FROM features WHERE id = ?', featureId),
      listFolders(db),
      listTagsForFeature(db, featureId),
      listTags(db),
    ]);
    setFeature(row);
    setName(row?.name ?? '');
    setNotes(row?.notes ?? '');
    setColor(row?.color ?? null);
    setFolderId(row?.folder_id ?? null);
    setFolders(folderRows);
    setFeatureTags(tagRows);
    setAllTags(allTagRows);
  }, [db, featureId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function save() {
    await db.runAsync(
      'UPDATE features SET name = ?, notes = ?, color = ?, folder_id = ?, updated_at = ? WHERE id = ?',
      name || null,
      notes || null,
      color,
      folderId,
      Date.now(),
      featureId
    );
    navigation.goBack();
  }

  async function handleAddTag(tag: Tag) {
    await addTagToFeature(db, featureId, tag.id);
    setTagPickerOpen(false);
    load();
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    const tagId = await getOrCreateTag(db, newTagName.trim());
    await addTagToFeature(db, featureId, tagId);
    setNewTagName('');
    setTagPickerOpen(false);
    load();
  }

  async function handleRemoveTag(tagId: number) {
    await removeTagFromFeature(db, featureId, tagId);
    load();
  }

  function confirmDelete() {
    Alert.alert('Delete item?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteFeature(db, featureId);
          navigation.goBack();
        },
      },
    ]);
  }

  if (!feature) {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  const unassignedTags = allTags.filter((t) => !featureTags.some((ft) => ft.id === t.id));
  const currentFolder = folders.find((f) => f.id === folderId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Untitled" />

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <Text style={styles.label}>Folder</Text>
      <Pressable style={styles.folderButton} onPress={() => setFolderPickerOpen(true)}>
        <Text style={styles.folderButtonText}>{currentFolder?.name ?? 'None'}</Text>
      </Pressable>

      <Text style={styles.label}>Color</Text>
      <View style={styles.colorRow}>
        {FEATURE_COLOR_PALETTE.map((c) => (
          <Pressable
            key={c}
            style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchSelected]}
            onPress={() => setColor(c)}
          />
        ))}
      </View>

      <Text style={styles.label}>Tags</Text>
      <View style={styles.tagRow}>
        {featureTags.map((tag) => (
          <Pressable key={tag.id} style={styles.tagChip} onPress={() => handleRemoveTag(tag.id)}>
            <Text style={styles.tagChipText}>{tag.name} ✕</Text>
          </Pressable>
        ))}
        <Pressable style={styles.addTagChip} onPress={() => setTagPickerOpen(true)}>
          <Text style={styles.addTagChipText}>+ Add tag</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Coordinates</Text>
      <Text style={styles.readonlyValue}>{formatCoordinates(feature.geometry)}</Text>

      <Text style={styles.label}>Type</Text>
      <Text style={styles.readonlyValue}>{feature.type}</Text>

      {feature.type === 'point' &&
        (() => {
          const point = parsePointLonLat(feature.geometry);
          if (!point) return null;
          const [lon, lat] = point;
          return (
            <Pressable
              style={styles.directionsButton}
              onPress={() => openDirections(lat, lon, feature.name)}
            >
              <Text style={styles.directionsButtonText}>Get Directions</Text>
            </Pressable>
          );
        })()}

      <Pressable style={styles.saveButton} onPress={save}>
        <Text style={styles.saveButtonText}>Save</Text>
      </Pressable>

      <Pressable style={styles.deleteButton} onPress={confirmDelete}>
        <Text style={styles.deleteButtonText}>Delete</Text>
      </Pressable>

      <FolderPickerModal
        visible={folderPickerOpen}
        folders={folders}
        onFoldersChanged={load}
        onSelect={(id) => {
          setFolderId(id);
          setFolderPickerOpen(false);
        }}
        onClose={() => setFolderPickerOpen(false)}
      />

      <Modal visible={tagPickerOpen} animationType="slide" transparent onRequestClose={() => setTagPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setTagPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Add tag</Text>
            <View style={styles.newTagRow}>
              <TextInput
                style={styles.newTagInput}
                placeholder="New tag name…"
                value={newTagName}
                onChangeText={setNewTagName}
                onSubmitEditing={handleCreateTag}
              />
              <Pressable style={styles.newTagButton} onPress={handleCreateTag}>
                <Text style={styles.newTagButtonText}>Add</Text>
              </Pressable>
            </View>
            {unassignedTags.map((tag) => (
              <Pressable key={tag.id} style={styles.sheetRow} onPress={() => handleAddTag(tag)}>
                <Text>{tag.name}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.cancelButton} onPress={() => setTagPickerOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { padding: 16, gap: 4 },
  label: { fontSize: 12, color: '#888', marginTop: 12, textTransform: 'uppercase' },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    paddingVertical: 8,
    fontSize: 16,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  readonlyValue: { fontSize: 16, paddingVertical: 8 },
  folderButton: { paddingVertical: 8 },
  folderButtonText: { fontSize: 16, color: '#2f6f4f', fontWeight: '600' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  swatchSelected: { borderWidth: 3, borderColor: '#333' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#eee' },
  tagChipText: { fontSize: 12, fontWeight: '600' },
  addTagChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2f6f4f',
  },
  addTagChipText: { fontSize: 12, fontWeight: '600', color: '#2f6f4f' },
  saveButton: {
    marginTop: 24,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: { color: 'white', fontWeight: '700' },
  directionsButton: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  directionsButtonText: { color: '#2f6f4f', fontWeight: '700' },
  deleteButton: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  deleteButtonText: { color: '#c0392b', fontWeight: '600' },
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
