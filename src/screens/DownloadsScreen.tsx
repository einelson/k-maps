import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { MapScreenMap } from '../map/MapView';
import { BASE_MAP_TILE_URLS, USGS_ATTRIBUTION } from '../map/usgsSources';
import { ESTIMATED_BYTES_PER_CELL, lonLatToCell } from '../downloads/cells';
import { downloadCell } from '../downloads/downloader';
import type { LayerId } from '../downloads/types';
import { useDownloadStore } from '../state/useDownloadStore';

const LAYER_OPTIONS: { id: LayerId; label: string }[] = [
  { id: 'topo', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

export function DownloadsScreen() {
  const appDb = useSQLiteContext();
  const selectedCells = useDownloadStore((s) => s.selectedCells);
  const selectCell = useDownloadStore((s) => s.selectCell);
  const deselectCell = useDownloadStore((s) => s.deselectCell);
  const selectedLayers = useDownloadStore((s) => s.selectedLayers);
  const setSelectedLayers = useDownloadStore((s) => s.setSelectedLayers);
  const maxZoom = useDownloadStore((s) => s.maxZoom);
  const setMaxZoom = useDownloadStore((s) => s.setMaxZoom);

  const [progress, setProgress] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);

  const estimate = ESTIMATED_BYTES_PER_CELL[maxZoom as 14 | 15 | 16 | 17];
  const estimatedTotalBytes = useMemo(() => {
    if (!estimate) return null;
    const perCellBytes = selectedLayers.reduce((sum, layer) => {
      const [low, high] =
        layer === 'satellite' ? estimate.imagery : estimate.topo; // hybrid/land/osm sized like topo for now
      return sum + (low + high) / 2;
    }, 0);
    return perCellBytes * selectedCells.length;
  }, [estimate, selectedLayers, selectedCells.length]);

  function toggleLayer(id: LayerId) {
    setSelectedLayers(
      selectedLayers.includes(id)
        ? selectedLayers.filter((l) => l !== id)
        : [...selectedLayers, id]
    );
  }

  async function startDownload() {
    setRunning(true);
    for (const cell of selectedCells) {
      for (const layer of selectedLayers) {
        // Vector packs (land/OSM) come from hosted packs (§6), not USGS raster tiles.
        if (layer !== 'topo' && layer !== 'satellite' && layer !== 'hybrid') continue;
        const key = `${layer}:${cell.cx}:${cell.cy}`;
        await downloadCell({
          appDb,
          layer,
          cx: cell.cx,
          cy: cell.cy,
          maxZoom,
          tileUrlTemplate: BASE_MAP_TILE_URLS[layer],
          attribution: USGS_ATTRIBUTION,
          onProgress: (done, total) =>
            setProgress((p) => ({ ...p, [key]: done / total })),
        });
      }
    }
    setRunning(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        <MapScreenMap
          onMapPress={(lngLat) => {
            const { cx, cy } = lonLatToCell(lngLat[0], lngLat[1]);
            const isSelected = selectedCells.some((c) => c.cx === cx && c.cy === cy);
            if (isSelected) deselectCell(cx, cy);
            else selectCell(cx, cy);
          }}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.hint}>Tap the map to select z10 download cells (~28x28 km each).</Text>

        <Text style={styles.sectionTitle}>Layers</Text>
        <View style={styles.layerRow}>
          {LAYER_OPTIONS.map((layer) => (
            <Pressable
              key={layer.id}
              style={[
                styles.layerChip,
                selectedLayers.includes(layer.id) && styles.layerChipActive,
              ]}
              onPress={() => toggleLayer(layer.id)}
            >
              <Text style={selectedLayers.includes(layer.id) ? styles.layerChipTextActive : undefined}>
                {layer.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Max zoom: {maxZoom}</Text>
        <View style={styles.layerRow}>
          {[14, 15, 16, 17].map((z) => (
            <Pressable
              key={z}
              style={[styles.layerChip, maxZoom === z && styles.layerChipActive]}
              onPress={() => setMaxZoom(z)}
            >
              <Text style={maxZoom === z ? styles.layerChipTextActive : undefined}>z{z}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.summary}>
          {selectedCells.length} cell{selectedCells.length === 1 ? '' : 's'} selected
          {estimatedTotalBytes != null && selectedCells.length > 0
            ? ` — est. ${formatBytes(estimatedTotalBytes)}`
            : ''}
        </Text>

        <Pressable
          style={[styles.startButton, (running || selectedCells.length === 0) && styles.startButtonDisabled]}
          disabled={running || selectedCells.length === 0}
          onPress={startDownload}
        >
          <Text style={styles.startButtonText}>{running ? 'Downloading…' : 'Start download'}</Text>
        </Pressable>

        <FlatList
          data={Object.entries(progress)}
          keyExtractor={([key]) => key}
          renderItem={({ item: [key, value] }) => (
            <Text style={styles.progressRow}>
              {key} — {Math.round(value * 100)}%
            </Text>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapContainer: { height: '45%' },
  panel: { flex: 1, padding: 16, gap: 8 },
  hint: { color: '#666', fontSize: 13 },
  sectionTitle: { fontWeight: '700', marginTop: 8 },
  layerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  layerChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#eee' },
  layerChipActive: { backgroundColor: '#2f6f4f' },
  layerChipTextActive: { color: 'white', fontWeight: '600' },
  summary: { marginTop: 8, fontWeight: '600' },
  startButton: {
    marginTop: 8,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  startButtonDisabled: { backgroundColor: '#aaa' },
  startButtonText: { color: 'white', fontWeight: '700' },
  progressRow: { fontSize: 12, color: '#666', paddingVertical: 2 },
});
