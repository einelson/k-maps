import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { bulkDelete, bulkSetColor, bulkSetFolder, listFeatures } from '../data/featuresRepo';
import { childFolders, folderAndDescendantIds, folderPath, folderPathLabel } from '../data/folderTree';
import {
  createFolder,
  deleteFolder,
  folderItemCounts,
  listFolders,
  moveFolder,
  renameFolder,
} from '../data/foldersRepo';
import { addTagToFeature, getOrCreateTag, listTags } from '../data/tagsRepo';
import type { Feature, Folder, Tag } from '../data/types';
import { exportFeatures } from '../data/importExport';
import { FEATURE_COLOR_PALETTE } from '../features/colorPalette';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { pruneDeletedFromFilters } from '../state/pruneFilters';
import { useFiltersStore } from '../state/useFiltersStore';
import { Text, TextInput, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { BottomSheet } from './components/BottomSheet';
import { FolderPickerModal } from './components/FolderPickerModal';
import { Icon } from './components/Icon';
import { NameSheet } from './components/NameSheet';
import { PickerModal } from './components/PickerModal';
import { TagManagerSheet } from './components/TagManagerSheet';

function featureSubtitle(feature: Feature): string {
  if (feature.type === 'line' && feature.length_m != null) {
    return `Line · ${(feature.length_m / 1000).toFixed(2)} km`;
  }
  if (feature.type === 'polygon' && feature.area_m2 != null) {
    return `Area · ${(feature.area_m2 / 4046.86).toFixed(2)} ac`;
  }
  return 'Point';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type ActiveModal =
  | 'move'
  | 'color'
  | 'tag'
  | 'tags'
  | 'newFolder'
  | 'folderActions'
  | 'renameFolder'
  | 'moveFolder'
  | null;

type ListRow =
  | { kind: 'folder'; folder: Folder; itemCount: number; subfolderCount: number }
  | { kind: 'item'; item: Feature };

export function ItemsScreen() {
  const db = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const filters = useFiltersStore((s) => s.filters);
  const setFilters = useFiltersStore((s) => s.setFilters);

  const [items, setItems] = useState<Feature[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderCounts, setFolderCounts] = useState<Map<number, number>>(new Map());
  const [tags, setTags] = useState<Tag[]>([]);
  /** The folder being browsed; null = the top level. */
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  /** The folder a row menu / rename / move / delete is acting on. */
  const [targetFolder, setTargetFolder] = useState<Folder | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [newTagName, setNewTagName] = useState('');

  // Searching or filtering shows matches from every folder as one flat list; otherwise you browse folder by folder.
  const isFiltered =
    !!filters.text ||
    !!filters.folderIds?.length ||
    !!filters.types?.length ||
    !!filters.colors?.length ||
    !!filters.tagIds?.length;

  const reload = useCallback(async () => {
    const [folderRows, tagRows, counts] = await Promise.all([listFolders(db), listTags(db), folderItemCounts(db)]);
    // The folder being browsed can vanish (deleted elsewhere): fall back to the top level.
    const browsing = currentFolderId !== null && folderRows.some((f) => f.id === currentFolderId) ? currentFolderId : null;
    const rows = await listFeatures(
      db,
      isFiltered
        ? {
            folderIds: filters.folderIds,
            types: filters.types,
            colors: filters.colors,
            tagIds: filters.tagIds,
            text: filters.text,
          }
        : { inFolder: browsing }
    );
    setItems(rows);
    setFolders(folderRows);
    setFolderCounts(counts);
    setTags(tagRows);
    if (browsing !== currentFolderId) setCurrentFolderId(browsing);
  }, [db, filters, isFiltered, currentFolderId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    if (!isFiltered) {
      for (const folder of childFolders(folders, currentFolderId)) {
        const inside = folderAndDescendantIds(folders, folder.id);
        out.push({
          kind: 'folder',
          folder,
          itemCount: inside.reduce((sum, id) => sum + (folderCounts.get(id) ?? 0), 0),
          subfolderCount: inside.length - 1,
        });
      }
    }
    for (const item of items) out.push({ kind: 'item', item });
    return out;
  }, [isFiltered, folders, currentFolderId, folderCounts, items]);

  const crumbs = useMemo(() => folderPath(folders, currentFolderId), [folders, currentFolderId]);

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

  function openFolderActions(folder: Folder) {
    setTargetFolder(folder);
    setActiveModal('folderActions');
  }

  function confirmDeleteFolder(folder: Folder) {
    const directItems = folderCounts.get(folder.id) ?? 0;
    const directFolders = childFolders(folders, folder.id).length;
    const parentName = folder.parent_id === null ? 'the top level' : `"${folderPathLabel(folders, folder.parent_id)}"`;
    const moved = [directItems > 0 && plural(directItems, 'item'), directFolders > 0 && plural(directFolders, 'subfolder')]
      .filter(Boolean)
      .join(' and ');
    Alert.alert(
      `Delete folder "${folder.name}"?`,
      moved ? `Its ${moved} will move up to ${parentName}. Nothing else is deleted.` : 'The folder is empty.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteFolder(db, folder.id);
              pruneDeletedFromFilters({ folderId: folder.id });
              reload();
            } catch (err) {
              Alert.alert("Couldn't delete the folder", err instanceof Error ? err.message : String(err));
            }
          },
        },
      ]
    );
  }

  async function handleMoveFolder(newParentId: number | null) {
    if (!targetFolder) return;
    try {
      await moveFolder(db, targetFolder.id, newParentId);
      setActiveModal(null);
      reload();
    } catch (err) {
      Alert.alert("Couldn't move the folder", err instanceof Error ? err.message : String(err));
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
        <Pressable onPress={() => setActiveModal('tags')} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>Tags</Text>
        </Pressable>
        <Pressable
          onPress={() => (selecting ? exitSelection() : setSelecting(true))}
          style={styles.headerButton}
        >
          <Text style={styles.headerButtonText}>{selecting ? 'Done' : 'Select'}</Text>
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

      {isFiltered ? (
        <Text style={styles.filterNote}>Showing matches from every folder</Text>
      ) : (
        <View style={styles.crumbBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
            <Pressable onPress={() => setCurrentFolderId(null)} hitSlop={6}>
              <Text style={crumbs.length === 0 ? styles.crumbCurrent : styles.crumbLink}>All items</Text>
            </Pressable>
            {crumbs.map((crumb, i) => (
              <View key={crumb.id} style={styles.crumbSegment}>
                <Text style={styles.crumbSeparator}>›</Text>
                <Pressable onPress={() => setCurrentFolderId(crumb.id)} hitSlop={6}>
                  <Text style={i === crumbs.length - 1 ? styles.crumbCurrent : styles.crumbLink}>{crumb.name}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={() => setActiveModal('newFolder')} style={styles.newFolderButton} hitSlop={6}>
            <Text style={styles.headerButtonText}>+ Folder</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'folder' ? `folder-${row.folder.id}` : `item-${row.item.id}`)}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isFiltered
              ? 'Nothing matches.'
              : currentFolderId === null
                ? 'No items yet. Drop a pin on the map.'
                : 'This folder is empty.'}
          </Text>
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'folder') {
            const { folder, itemCount, subfolderCount } = row;
            const details = [plural(itemCount, 'item'), subfolderCount > 0 ? plural(subfolderCount, 'folder') : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                style={styles.row}
                onPress={() => setCurrentFolderId(folder.id)}
                onLongPress={() => openFolderActions(folder)}
              >
                <Icon name="folder" size={22} color={folder.color ?? colors.icon} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{folder.name}</Text>
                  <Text style={styles.rowSubtitle}>{details}</Text>
                </View>
                <Pressable onPress={() => openFolderActions(folder)} hitSlop={10} accessibilityLabel={`${folder.name} options`}>
                  <Text style={styles.menuDots}>⋯</Text>
                </Pressable>
              </Pressable>
            );
          }
          const { item } = row;
          return (
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
                <Text style={styles.rowSubtitle}>
                  {featureSubtitle(item)}
                  {isFiltered && item.folder_id != null ? ` · ${folderPathLabel(folders, item.folder_id)}` : ''}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      {selecting && selectedIds.size > 0 && (
        <View style={[styles.actionBar, { paddingBottom: 12 + insets.bottom }]}>
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
      <BottomSheet visible={activeModal === 'tag'} onClose={() => setActiveModal(null)}>
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
      </BottomSheet>

      <TagManagerSheet
        visible={activeModal === 'tags'}
        onClose={() => setActiveModal(null)}
        onChanged={({ deletedTagId }) => {
          if (deletedTagId !== undefined) pruneDeletedFromFilters({ tagId: deletedTagId });
          reload();
        }}
      />

      <NameSheet
        visible={activeModal === 'newFolder'}
        title={currentFolderId === null ? 'New folder' : `New folder in "${crumbs[crumbs.length - 1]?.name ?? ''}"`}
        placeholder="Folder name…"
        confirmLabel="Create"
        onSubmit={async (name) => {
          await createFolder(db, { name, parentId: currentFolderId });
          reload();
        }}
        onClose={() => setActiveModal(null)}
      />

      <BottomSheet visible={activeModal === 'folderActions'} onClose={() => setActiveModal(null)}>
        <Text style={styles.sheetTitle}>{targetFolder?.name}</Text>
        <Pressable style={styles.sheetRow} onPress={() => setActiveModal('renameFolder')}>
          <Text>Rename</Text>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={() => setActiveModal('moveFolder')}>
          <Text>Move to…</Text>
        </Pressable>
        <Pressable
          style={styles.sheetRow}
          onPress={() => {
            const folder = targetFolder;
            setActiveModal(null);
            if (folder) confirmDeleteFolder(folder);
          }}
        >
          <Text style={styles.actionButtonDanger}>Delete folder</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={() => setActiveModal(null)}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </BottomSheet>

      <NameSheet
        visible={activeModal === 'renameFolder'}
        title="Rename folder"
        placeholder="Folder name…"
        confirmLabel="Save"
        initialValue={targetFolder?.name}
        onSubmit={async (name) => {
          if (targetFolder) await renameFolder(db, targetFolder.id, name);
          reload();
        }}
        onClose={() => setActiveModal(null)}
      />

      <FolderPickerModal
        visible={activeModal === 'moveFolder'}
        title={`Move "${targetFolder?.name ?? ''}" to…`}
        noneLabel="Top level"
        excludeIds={targetFolder ? [targetFolder.id] : undefined}
        currentFolderId={targetFolder?.parent_id ?? null}
        folders={folders}
        onFoldersChanged={reload}
        onSelect={handleMoveFolder}
        onClose={() => setActiveModal(null)}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 12, marginTop: 12 },
    search: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: c.field,
    },
    headerButton: { paddingHorizontal: 8, paddingVertical: 8 },
    headerButtonText: { color: c.primaryText, fontWeight: '700' },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 12, marginTop: 10 },
    tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: c.chip },
    tagChipActive: { backgroundColor: c.primary },
    tagChipText: { fontSize: 12, fontWeight: '600' },
    tagChipTextActive: { fontSize: 12, fontWeight: '600', color: c.onPrimary },
    filterNote: { marginHorizontal: 16, marginTop: 10, marginBottom: 4, fontSize: 12, color: c.textMuted },
    crumbBar: { flexDirection: 'row', alignItems: 'center', marginLeft: 16, marginRight: 8, marginTop: 6 },
    crumbs: { alignItems: 'center', gap: 6, paddingVertical: 6, paddingRight: 8 },
    crumbSegment: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    crumbSeparator: { color: c.textFaint, fontSize: 16 },
    crumbLink: { color: c.primaryText, fontWeight: '600' },
    crumbCurrent: { fontWeight: '700' },
    newFolderButton: { paddingHorizontal: 8, paddingVertical: 6 },
    empty: { textAlign: 'center', color: c.textFaint, marginTop: 40 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
      gap: 12,
    },
    checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: c.borderStrong },
    checkboxChecked: { backgroundColor: c.primary, borderColor: c.primary },
    colorDot: { width: 12, height: 12, borderRadius: 6 },
    colorSwatchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 16, fontWeight: '600' },
    rowSubtitle: { fontSize: 13, color: c.textMuted },
    menuDots: { fontSize: 22, color: c.textMuted, paddingHorizontal: 6, lineHeight: 22 },
    actionBar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    actionButton: { paddingHorizontal: 8, paddingVertical: 6 },
    actionButtonText: { color: c.primaryText, fontWeight: '700' },
    actionButtonDanger: { color: c.danger },
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
