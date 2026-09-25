import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { flattenFolders } from '../../data/folderTree';
import { listFolders } from '../../data/foldersRepo';
import { listTags } from '../../data/tagsRepo';
import type { FeatureType, Folder, Tag } from '../../data/types';
import { FEATURE_COLOR_PALETTE } from '../../features/colorPalette';
import { useFiltersStore } from '../../state/useFiltersStore';
import { EMPTY_FILTERS, type Filters } from '../../state/types';
import { Text, TextInput, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';

type Category = 'types' | 'folders' | 'colors' | 'tags' | 'presets';

const TYPE_OPTIONS: { id: FeatureType; label: string }[] = [
  { id: 'point', label: 'Points' },
  { id: 'line', label: 'Lines' },
  { id: 'polygon', label: 'Areas' },
];

const CATEGORY_LABELS: Record<Category, string> = {
  types: 'Types',
  folders: 'Folders',
  colors: 'Colors',
  tags: 'Tags',
  presets: 'Presets',
};

/** Toggles `value` in a nullable filter list; an emptied list goes back to `null` ("all"). */
function toggled<T>(list: T[] | null, value: T): T[] | null {
  const current = list ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return next.length ? next : null;
}

function activeCount(filters: Filters, category: Category): number {
  switch (category) {
    case 'types':
      return filters.types?.length ?? 0;
    case 'folders':
      return filters.folderIds?.length ?? 0;
    case 'colors':
      return filters.colors?.length ?? 0;
    case 'tags':
      return filters.tagIds?.length ?? 0;
    default:
      return 0;
  }
}

/** How many filter categories (types, folders, colors, tags) currently narrow the map. */
export function countActiveFilterCategories(filters: Filters): number {
  return (['types', 'folders', 'colors', 'tags'] as const).reduce(
    (sum, category) => sum + (activeCount(filters, category) > 0 ? 1 : 0),
    0
  );
}

/**
 * The map's filter chip bar (§7.2): Types / Folders / Colors / Tags chips with
 * per-chip counts, a total-active badge, and saved presets. Each chip opens a
 * bottom sheet with that category's options. Filters live in useFiltersStore,
 * which the map turns into a MapLibre filter expression — so toggling here is
 * instant and never touches SQLite.
 */
export function FilterChipBar() {
  const db = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const filters = useFiltersStore((s) => s.filters);
  const setFilters = useFiltersStore((s) => s.setFilters);
  const resetFilters = useFiltersStore((s) => s.resetFilters);
  const presets = useFiltersStore((s) => s.presets);
  const savePreset = useFiltersStore((s) => s.savePreset);
  const applyPreset = useFiltersStore((s) => s.applyPreset);
  const deletePreset = useFiltersStore((s) => s.deletePreset);

  const [open, setOpen] = useState<Category | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [presetName, setPresetName] = useState('');

  const totalActive = countActiveFilterCategories(filters);

  const openCategory = useCallback(
    async (category: Category) => {
      // Folders/tags can change between openings (Items, imports), so reload rather than cache.
      const [folderRows, tagRows] = await Promise.all([listFolders(db), listTags(db)]);
      setFolders(folderRows);
      setTags(tagRows);
      setOpen(category);
    },
    [db]
  );

  function clearCategory(category: Category) {
    switch (category) {
      case 'types':
        setFilters({ ...filters, types: null });
        break;
      case 'folders':
        setFilters({ ...filters, folderIds: null });
        break;
      case 'colors':
        setFilters({ ...filters, colors: null });
        break;
      case 'tags':
        setFilters({ ...filters, tagIds: null });
        break;
    }
  }

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bar}
        contentContainerStyle={styles.barContent}
      >
        {(['types', 'folders', 'colors', 'tags', 'presets'] as const).map((category) => {
          const count = activeCount(filters, category);
          return (
            <Pressable
              key={category}
              style={[styles.chip, count > 0 && styles.chipActive]}
              onPress={() => openCategory(category)}
            >
              <Text style={[styles.chipText, count > 0 && styles.chipTextActive]}>
                {CATEGORY_LABELS[category]}
                {count > 0 ? ` · ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
        {totalActive > 0 && (
          <Pressable style={[styles.chip, styles.clearChip]} onPress={resetFilters}>
            <Text style={styles.clearChipText}>Clear {totalActive}</Text>
          </Pressable>
        )}
      </ScrollView>

      <BottomSheet visible={open !== null} onClose={() => setOpen(null)} maxHeight="75%">
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{open ? CATEGORY_LABELS[open] : ''}</Text>
          {open && open !== 'presets' && activeCount(filters, open) > 0 && (
            <Pressable onPress={() => clearCategory(open)} hitSlop={8}>
              <Text style={styles.sheetClear}>Clear</Text>
            </Pressable>
          )}
        </View>

        <ScrollView style={styles.sheetList}>
          {open === 'types' &&
            TYPE_OPTIONS.map((option) => {
              const on = filters.types?.includes(option.id) ?? false;
              return (
                <Pressable
                  key={option.id}
                  style={styles.row}
                  onPress={() => setFilters({ ...filters, types: toggled(filters.types, option.id) })}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn]} />
                  <Text style={styles.rowText}>{option.label}</Text>
                </Pressable>
              );
            })}

          {open === 'folders' &&
            (folders.length === 0 ? (
              <Text style={styles.empty}>No folders yet. Create one from My Content.</Text>
            ) : (
              <>
                <Text style={styles.empty}>Choosing a folder also shows what&apos;s in the folders inside it.</Text>
                {flattenFolders(folders).map(({ folder, depth }) => {
                  const on = filters.folderIds?.includes(folder.id) ?? false;
                  return (
                    <Pressable
                      key={folder.id}
                      style={[styles.row, { paddingLeft: depth * 20 }]}
                      onPress={() =>
                        setFilters({ ...filters, folderIds: toggled(filters.folderIds, folder.id) })
                      }
                    >
                      <View style={[styles.checkbox, on && styles.checkboxOn]} />
                      <View style={[styles.dot, { backgroundColor: folder.color ?? '#999' }]} />
                      <Text style={styles.rowText}>{folder.name}</Text>
                    </Pressable>
                  );
                })}
              </>
            ))}

          {open === 'colors' && (
            <View style={styles.swatchGrid}>
              {FEATURE_COLOR_PALETTE.map((color) => {
                const on = filters.colors?.includes(color) ?? false;
                return (
                  <Pressable
                    key={color}
                    style={[styles.swatch, { backgroundColor: color }, on && styles.swatchOn]}
                    onPress={() => setFilters({ ...filters, colors: toggled(filters.colors, color) })}
                  >
                    {on && <Text style={styles.swatchCheck}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>
          )}

          {open === 'tags' && (
            <>
              {tags.length === 0 ? (
                <Text style={styles.empty}>No tags yet. Add one from Items → Select → Tag.</Text>
              ) : (
                <>
                  <View style={styles.modeRow}>
                    {(['any', 'all'] as const).map((mode) => (
                      <Pressable
                        key={mode}
                        style={[styles.modeButton, filters.tagMode === mode && styles.modeButtonOn]}
                        onPress={() => setFilters({ ...filters, tagMode: mode })}
                      >
                        <Text style={filters.tagMode === mode ? styles.modeTextOn : styles.modeText}>
                          Match {mode}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {tags.map((tag) => {
                    const on = filters.tagIds?.includes(tag.id) ?? false;
                    return (
                      <Pressable
                        key={tag.id}
                        style={styles.row}
                        onPress={() =>
                          setFilters({ ...filters, tagIds: toggled(filters.tagIds, tag.id) })
                        }
                      >
                        <View style={[styles.checkbox, on && styles.checkboxOn]} />
                        <Text style={styles.rowText}>{tag.name}</Text>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </>
          )}

          {open === 'presets' && (
            <>
              <Text style={styles.hint}>
                Saves the current filters (types, folders, colors, tags) under a name.
              </Text>
              <View style={styles.presetInputRow}>
                <TextInput
                  style={styles.presetInput}
                  placeholder="Preset name…"
                  value={presetName}
                  onChangeText={setPresetName}
                />
                <Pressable
                  style={styles.presetSave}
                  onPress={() => {
                    if (!presetName.trim()) return;
                    savePreset(presetName.trim());
                    setPresetName('');
                  }}
                >
                  <Text style={styles.presetSaveText}>Save</Text>
                </Pressable>
              </View>
              {presets.length === 0 && <Text style={styles.empty}>No saved presets yet.</Text>}
              {presets.map((preset) => (
                <View key={preset.id} style={styles.row}>
                  <Text style={[styles.rowText, styles.presetName]}>{preset.name}</Text>
                  <Pressable
                    onPress={() => {
                      applyPreset(preset.id);
                      setOpen(null);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.presetAction}>Apply</Text>
                  </Pressable>
                  <Pressable onPress={() => deletePreset(preset.id)} hitSlop={8}>
                    <Text style={[styles.presetAction, styles.presetDelete]}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </>
          )}
        </ScrollView>

        <View style={styles.sheetFooter}>
          {open !== 'presets' && totalActive > 0 && (
            <Pressable
              onPress={() => setFilters({ ...EMPTY_FILTERS, text: filters.text })}
              hitSlop={8}
            >
              <Text style={styles.sheetClear}>Clear all</Text>
            </Pressable>
          )}
          <Pressable style={styles.doneButton} onPress={() => setOpen(null)}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Fills whatever room the host row leaves (FilterControl puts it beside the filter button).
    bar: { flex: 1 },
    barContent: { paddingHorizontal: 4, gap: 8, paddingVertical: 4 },
    chip: {
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 18,
      elevation: 2,
      shadowColor: c.shadow,
      shadowOpacity: 0.15,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
    chipActive: { backgroundColor: c.primary },
    chipText: { fontWeight: '600', fontSize: 13 },
    chipTextActive: { color: c.onPrimary },
    clearChip: { backgroundColor: c.dangerTint },
    clearChipText: { color: c.danger, fontWeight: '700', fontSize: 13 },

    sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
    sheetClear: { color: c.danger, fontWeight: '600' },
    sheetList: { flexGrow: 0 },
    sheetFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 12,
    },
    doneButton: {
      marginLeft: 'auto',
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingHorizontal: 22,
      paddingVertical: 10,
    },
    doneText: { color: c.onPrimary, fontWeight: '700' },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
    },
    rowText: { flex: 1, fontSize: 15 },
    checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: c.borderStrong },
    checkboxOn: { backgroundColor: c.primary, borderColor: c.primary },
    dot: { width: 12, height: 12, borderRadius: 6 },
    empty: { color: c.textFaint, paddingVertical: 16, textAlign: 'center' },
    hint: { color: c.textFaint, fontSize: 12, marginBottom: 8 },

    swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8 },
    swatch: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    swatchOn: { borderColor: c.selectionRing },
    swatchCheck: { color: 'white', fontWeight: '900', fontSize: 18 },

    modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    modeButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, backgroundColor: c.chip },
    modeButtonOn: { backgroundColor: c.primary },
    modeText: { fontWeight: '600' },
    modeTextOn: { fontWeight: '600', color: c.onPrimary },

    presetInputRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    presetInput: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: c.field,
    },
    presetSave: {
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: c.primary,
    },
    presetSaveText: { color: c.onPrimary, fontWeight: '700' },
    presetName: { fontWeight: '600' },
    presetAction: { color: c.primaryText, fontWeight: '700' },
    presetDelete: { color: c.danger },
  });
