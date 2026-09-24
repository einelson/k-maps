import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useSQLiteContext } from 'expo-sqlite';

import { listFeatures } from '../data/featuresRepo';
import { listFolders } from '../data/foldersRepo';
import { createBackup, exportFeatures, importFile } from '../data/importExport';
import type { ExportFormat } from '../data/importTypes';
import type { Folder } from '../data/types';
import { useFiltersStore } from '../state/useFiltersStore';

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'gpx', label: 'GPX' },
  { id: 'kml', label: 'KML' },
  { id: 'geojson', label: 'GeoJSON' },
];

export function ImportExportScreen() {
  const db = useSQLiteContext();
  const filters = useFiltersStore((s) => s.filters);
  const [format, setFormat] = useState<ExportFormat>('gpx');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listFolders(db).then(setFolders);
    }, [db])
  );

  async function runExport(label: string, load: () => Promise<Parameters<typeof exportFeatures>[0]>) {
    setBusy(true);
    try {
      const features = await load();
      await exportFeatures(features, format, label);
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/gpx+xml', 'application/vnd.google-earth.kml+xml', 'application/geo+json', 'application/json', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const asset = result.assets[0];
      const { count, folderName } = await importFile(db, asset.uri, asset.name);
      Alert.alert('Import complete', `Added ${count} item${count === 1 ? '' : 's'} to "${folderName}".`);
    } catch (err) {
      Alert.alert('Import failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleBackup() {
    setBusy(true);
    try {
      await createBackup(db);
    } catch (err) {
      Alert.alert('Backup failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Import</Text>
      <Pressable style={styles.button} onPress={handleImport} disabled={busy}>
        <Text style={styles.buttonText}>Import GPX / KML / GeoJSON…</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Export format</Text>
      <View style={styles.formatRow}>
        {FORMATS.map((f) => (
          <Pressable
            key={f.id}
            style={[styles.formatChip, format === f.id && styles.formatChipActive]}
            onPress={() => setFormat(f.id)}
          >
            <Text style={format === f.id ? styles.formatChipTextActive : styles.formatChipText}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Export</Text>
      <Pressable
        style={styles.button}
        disabled={busy}
        onPress={() => runExport('pins', () => listFeatures(db, { types: ['point'] }))}
      >
        <Text style={styles.buttonText}>Export pins (points only)…</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        disabled={busy}
        onPress={() =>
          runExport('filtered', () =>
            listFeatures(db, {
              folderIds: filters.folderIds,
              types: filters.types,
              colors: filters.colors,
              text: filters.text,
            })
          )
        }
      >
        <Text style={styles.buttonText}>Export current filter…</Text>
      </Pressable>

      <Text style={styles.subLabel}>Export by folder</Text>
      {folders.length === 0 ? (
        <Text style={styles.emptyNote}>No folders yet.</Text>
      ) : (
        folders.map((folder) => (
          <Pressable
            key={folder.id}
            style={styles.folderRow}
            disabled={busy}
            onPress={() => runExport(folder.name, () => listFeatures(db, { folderIds: [folder.id] }))}
          >
            <View style={[styles.colorDot, { backgroundColor: folder.color ?? '#999' }]} />
            <Text style={styles.folderName}>{folder.name}</Text>
          </Pressable>
        ))
      )}

      <Text style={styles.sectionTitle}>Backup</Text>
      <Pressable style={styles.button} disabled={busy} onPress={handleBackup}>
        <Text style={styles.buttonText}>Create full backup (DB + photos)…</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { padding: 16, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  subLabel: { fontSize: 12, color: '#888', marginTop: 12, textTransform: 'uppercase' },
  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#f0f0f0' },
  buttonText: { fontWeight: '600' },
  formatRow: { flexDirection: 'row', gap: 8 },
  formatChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#eee' },
  formatChipActive: { backgroundColor: '#2f6f4f' },
  formatChipText: { fontWeight: '600' },
  formatChipTextActive: { fontWeight: '600', color: 'white' },
  emptyNote: { color: '#888', fontSize: 13, marginTop: 4 },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
  },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  folderName: { fontSize: 15 },
});
