import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import type { Position } from 'geojson';

import { deleteFeature, rebuildSearchIndex } from '../data/featuresRepo';
import { exportFeatures } from '../data/importExport';
import { folderPathLabel } from '../data/folderTree';
import { listFolders } from '../data/foldersRepo';
import {
  addTagToFeature,
  getOrCreateTag,
  listTags,
  listTagsForFeature,
  removeTagFromFeature,
} from '../data/tagsRepo';
import { getTrackData } from '../data/trackDataRepo';
import type { Feature, Folder, Tag } from '../data/types';
import { FEATURE_COLOR_PALETTE } from '../features/colorPalette';
import { formatCoordinate } from '../features/coordinates';
import { openDirections } from '../features/directions';
import { DEFAULT_PIN_COLOR, resolvePinStyle, type PinStyleId } from '../features/pinStyles';
import type { TrackSamples } from '../features/trackStats';
import { transportMode, type TransportId } from '../features/transport';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSettingsStore, type CoordinateFormat } from '../state/useSettingsStore';
import { Text, TextInput, useThemedStyles, type ThemeColors } from '../theme';
import { BottomSheet } from './components/BottomSheet';
import { FolderPickerModal } from './components/FolderPickerModal';
import { PhotoStrip } from './components/PhotoStrip';
import { PinStylePicker } from './components/PinStylePicker';
import { TrackDashboard } from './components/TrackDashboard';
import { TransportChips } from './components/TransportPicker';

/** GeoJSON coordinates are [lon, lat]; returns null for non-point geometry (or a Directions button doesn't apply). */
function parsePointLonLat(geometry: string): [number, number] | null {
  try {
    const parsed = JSON.parse(geometry) as { type: string; coordinates: unknown };
    return parsed.type === 'Point' ? (parsed.coordinates as [number, number]) : null;
  } catch {
    return null;
  }
}

/** The vertices of a line feature's geometry, or null for anything else. */
function parseLineCoordinates(geometry: string): Position[] | null {
  try {
    const parsed = JSON.parse(geometry) as { type: string; coordinates: Position[] };
    return parsed.type === 'LineString' ? parsed.coordinates : null;
  } catch {
    return null;
  }
}

/** Points show in the coordinate format chosen in Settings (§7.3); lines/areas just name their geometry type. */
function formatCoordinates(geometry: string, format: CoordinateFormat): string {
  const point = parsePointLonLat(geometry);
  if (point) return formatCoordinate(point[0], point[1], format);
  try {
    return (JSON.parse(geometry) as { type: string }).type;
  } catch {
    return 'Unknown geometry';
  }
}

export function FeatureDetailScreen() {
  const db = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'FeatureDetail'>>();
  const { featureId } = route.params;
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);

  const [feature, setFeature] = useState<Feature | null>(null);
  const [samples, setSamples] = useState<TrackSamples | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<PinStyleId>(resolvePinStyle(null));
  const [folderId, setFolderId] = useState<number | null>(null);
  const [transport, setTransport] = useState<TransportId | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [featureTags, setFeatureTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const load = useCallback(async () => {
    const [row, folderRows, tagRows, allTagRows, trackSamples] = await Promise.all([
      db.getFirstAsync<Feature>('SELECT * FROM features WHERE id = ?', featureId),
      listFolders(db),
      listTagsForFeature(db, featureId),
      listTags(db),
      getTrackData(db, featureId),
    ]);
    setFeature(row);
    setSamples(trackSamples);
    setName(row?.name ?? '');
    setNotes(row?.notes ?? '');
    setColor(row?.color ?? null);
    setIcon(resolvePinStyle(row?.icon));
    setFolderId(row?.folder_id ?? null);
    setTransport(transportMode(row?.transport)?.id ?? null);
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
      'UPDATE features SET name = ?, notes = ?, color = ?, icon = ?, folder_id = ?, transport = ?, updated_at = ? WHERE id = ?',
      name || null,
      notes || null,
      color,
      // Only pins have a style; leave lines and areas' icon untouched (imports may carry one).
      feature?.type === 'point' ? icon : (feature?.icon ?? null),
      folderId,
      // Only tracks have a way of getting around; anything else keeps whatever it had.
      isTrack ? transport : (feature?.transport ?? null),
      Date.now(),
      featureId
    );
    await rebuildSearchIndex(db);
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

  const lineCoordinates = useMemo(() => (feature ? parseLineCoordinates(feature.geometry) : null), [feature]);
  // Recorded and imported lines are tracks that were travelled, so they get a way of getting around; a line drawn by hand doesn't.
  const isTrack = lineCoordinates != null && (feature?.source === 'track' || feature?.source === 'imported' || samples != null);

  async function handleExportGpx() {
    if (!feature) return;
    try {
      await exportFeatures([feature], 'gpx', name || 'track', db);
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
    }
  }

  if (!feature) {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  const unassignedTags = allTags.filter((t) => !featureTags.some((ft) => ft.id === t.id));
  const currentFolderLabel = folderPathLabel(folders, folderId);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]}
    >
      {/* Recorded and imported tracks lead with their stats; a plain drawn line has none to show. */}
      {lineCoordinates && (feature.source === 'track' || samples) && (
        <>
          <TrackDashboard coordinates={lineCoordinates} samples={samples} recorded={feature.source === 'track'} />
          <Pressable style={styles.exportButton} onPress={handleExportGpx}>
            <Text style={styles.directionsButtonText}>Export GPX (with time and elevation)</Text>
          </Pressable>
        </>
      )}

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Untitled" />

      {isTrack && (
        <>
          <Text style={styles.label}>Travelled by</Text>
          <TransportChips value={transport} onChange={setTransport} />
        </>
      )}

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <Text style={styles.label}>Folder</Text>
      <Pressable style={styles.folderButton} onPress={() => setFolderPickerOpen(true)}>
        <Text style={styles.folderButtonText}>{currentFolderLabel || 'None'}</Text>
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

      {feature.type === 'point' && (
        <>
          <Text style={styles.label}>Pin style</Text>
          <PinStylePicker value={icon} color={color ?? DEFAULT_PIN_COLOR} onChange={setIcon} />
        </>
      )}

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

      <Text style={styles.label}>Photos</Text>
      <PhotoStrip featureId={featureId} />

      <Text style={styles.label}>Coordinates</Text>
      <Text style={styles.readonlyValue}>{formatCoordinates(feature.geometry, coordinateFormat)}</Text>

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

      <Pressable
        style={styles.directionsButton}
        onPress={() => navigation.navigate('Map', { editFeatureId: featureId })}
      >
        <Text style={styles.directionsButtonText}>
          {feature.type === 'point' ? 'Move on map' : 'Edit shape on map'}
        </Text>
      </Pressable>

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

      <BottomSheet visible={tagPickerOpen} onClose={() => setTagPickerOpen(false)}>
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
      </BottomSheet>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 16, gap: 4 },
    label: { fontSize: 12, color: c.textFaint, marginTop: 12, textTransform: 'uppercase' },
    input: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      paddingVertical: 8,
      fontSize: 16,
    },
    notesInput: { minHeight: 80, textAlignVertical: 'top' },
    readonlyValue: { fontSize: 16, paddingVertical: 8 },
    folderButton: { paddingVertical: 8 },
    folderButtonText: { fontSize: 16, color: c.primaryText, fontWeight: '600' },
    colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 8 },
    swatch: { width: 28, height: 28, borderRadius: 14 },
    swatchSelected: { borderWidth: 3, borderColor: c.selectionRing },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
    tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: c.chip },
    tagChipText: { fontSize: 12, fontWeight: '600' },
    addTagChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.primaryText,
    },
    addTagChipText: { fontSize: 12, fontWeight: '600', color: c.primaryText },
    exportButton: {
      marginTop: 4,
      borderWidth: 1,
      borderColor: c.primaryText,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    saveButton: {
      marginTop: 24,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    saveButtonText: { color: c.onPrimary, fontWeight: '700' },
    directionsButton: {
      marginTop: 20,
      borderWidth: 1,
      borderColor: c.primaryText,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    directionsButtonText: { color: c.primaryText, fontWeight: '700' },
    deleteButton: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
    deleteButtonText: { color: c.danger, fontWeight: '600' },
    sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
    sheetRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.divider },
    newTagRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    newTagInput: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: c.field,
    },
    newTagButton: {
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: c.primary,
    },
    newTagButtonText: { color: c.onPrimary, fontWeight: '700' },
    cancelButton: { paddingVertical: 14, alignItems: 'center' },
    cancelText: { color: c.danger, fontWeight: '600' },
  });
