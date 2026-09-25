import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import type { CoverageRow } from '../data/types';
import { CellsOverlay, type CellOverlayEntry } from '../map/CellsOverlay';
import { MapScreenMap } from '../map/MapView';
import { BASE_MAP_TILE_URLS, USGS_ATTRIBUTION, USGS_MAX_NATIVE_ZOOM } from '../map/usgsSources';
import { ESTIMATED_BYTES_PER_CELL, lonLatToCell } from '../downloads/cells';
import { listCoverage } from '../downloads/coverageRepo';
import { downloadCell } from '../downloads/downloader';
import { formatBytes } from '../downloads/formatBytes';
import { deletePackData, downloadPackCell } from '../downloads/packDownloader';
import { useRegionManifest } from '../downloads/useRegionManifest';
import type { LayerId } from '../downloads/types';
import type { PackLayerId } from '../packs/types';
import { useDownloadStore } from '../state/useDownloadStore';
import { usePackStore } from '../state/usePackStore';
import { useRegionPackStore } from '../state/useRegionPackStore';
import { Text, useThemedStyles, type ThemeColors } from '../theme';
import { HuntUnitsSection } from './components/HuntUnitsSection';
import { RegionPacksSection } from './components/RegionPacksSection';

const TILE_LAYER_OPTIONS: { id: LayerId; label: string }[] = [
  { id: 'topo', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
];

/** Vector overlay datasets fetched straight from their public services, one cell at a time (region packs are the bulk route). */
const PACK_OPTIONS: { id: PackLayerId; label: string; note: string; estimateBytes: number }[] = [
  {
    id: 'land',
    label: 'Public land + private shading',
    note: 'USGS PAD-US (federal, state, local) and the inferred "likely private" tint',
    estimateBytes: 300_000,
  },
  {
    id: 'mvum',
    label: 'Forest roads (MVUM)',
    note: 'USFS motor vehicle use map — where your vehicle is allowed',
    estimateBytes: 500_000,
  },
  {
    id: 'trails',
    label: 'USFS trails',
    note: 'National Forest hiking, horse, bike and motorized trails from the same USFS data warehouse as MVUM',
    estimateBytes: 200_000,
  },
  {
    id: 'poi',
    label: 'POI pins',
    note: 'Boat launches, campsites and trailheads from OpenStreetMap',
    estimateBytes: 60_000,
  },
  {
    id: 'osm',
    label: 'Roads & trails (OSM)',
    note: 'OpenStreetMap roads, tracks and trails with names — dense cities reach ~7 MB, and the free Overpass servers are often slow: expect minutes per cell',
    estimateBytes: 4_000_000,
  },
];

const PACK_LABELS: Record<string, string> = {
  topo: 'Topo',
  satellite: 'Satellite',
  hybrid: 'Hybrid',
  ...Object.fromEntries(PACK_OPTIONS.map((o) => [o.id, o.label])),
};

/** USGS tiles don't exist past this (they 404), so offering more would just spam the shared servers. */
const ZOOM_OPTIONS = [14, 15, USGS_MAX_NATIVE_ZOOM];

export function DownloadsScreen() {
  const appDb = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const selectedCells = useDownloadStore((s) => s.selectedCells);
  const selectCell = useDownloadStore((s) => s.selectCell);
  const deselectCell = useDownloadStore((s) => s.deselectCell);
  const clearSelection = useDownloadStore((s) => s.clearSelection);
  const selectedLayers = useDownloadStore((s) => s.selectedLayers);
  const setSelectedLayers = useDownloadStore((s) => s.setSelectedLayers);
  const selectedPackLayers = useDownloadStore((s) => s.selectedPackLayers);
  const setSelectedPackLayers = useDownloadStore((s) => s.setSelectedPackLayers);
  const maxZoom = useDownloadStore((s) => s.maxZoom);
  const setMaxZoom = useDownloadStore((s) => s.setMaxZoom);
  const bumpPacks = usePackStore((s) => s.bump);
  const { manifest, retry: retryManifest } = useRegionManifest(); // one fetch, shared by the two pack sections
  const forgetRegionLayer = useRegionPackStore((s) => s.forgetLayer);

  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const reloadCoverage = useCallback(async () => setCoverage(await listCoverage(appDb)), [appDb]);
  useFocusEffect(
    useCallback(() => {
      reloadCoverage();
    }, [reloadCoverage])
  );
  const onRegionPacksChanged = useCallback(async () => {
    await reloadCoverage();
    bumpPacks(); // the map picks the newly installed cells up straight away
  }, [reloadCoverage, bumpPacks]);

  // One outline per cell: green if picked, otherwise blue when any layer is complete, amber when only partial.
  const overlayCells = useMemo<CellOverlayEntry[]>(() => {
    const downloaded = new Map<string, CellOverlayEntry>();
    for (const row of coverage) {
      if (row.status !== 'complete' && row.status !== 'partial') continue;
      const key = `${row.cell_x}:${row.cell_y}`;
      const existing = downloaded.get(key);
      if (existing?.state === 'complete') continue;
      downloaded.set(key, { cx: row.cell_x, cy: row.cell_y, state: row.status });
    }
    return [
      ...downloaded.values(),
      ...selectedCells.map(({ cx, cy }): CellOverlayEntry => ({ cx, cy, state: 'selected' })),
    ];
  }, [coverage, selectedCells]);

  const estimate = ESTIMATED_BYTES_PER_CELL[maxZoom as 14 | 15 | 16 | 17];
  const estimatedTotalBytes = useMemo(() => {
    const tileBytes = estimate
      ? selectedLayers.reduce((sum, layer) => {
          const [low, high] = layer === 'satellite' ? estimate.imagery : estimate.topo; // hybrid sized like topo
          return sum + (low + high) / 2;
        }, 0)
      : 0;
    const packBytes = selectedPackLayers.reduce(
      (sum, id) => sum + (PACK_OPTIONS.find((o) => o.id === id)?.estimateBytes ?? 0),
      0
    );
    return (tileBytes + packBytes) * selectedCells.length;
  }, [estimate, selectedLayers, selectedPackLayers, selectedCells.length]);

  /** Per-layer totals for the storage list. */
  const storage = useMemo(() => {
    const byLayer = new Map<string, { cells: number; bytes: number }>();
    for (const row of coverage) {
      if (row.status !== 'complete' && row.status !== 'partial') continue;
      const entry = byLayer.get(row.layer) ?? { cells: 0, bytes: 0 };
      entry.cells += 1;
      entry.bytes += row.bytes ?? 0;
      byLayer.set(row.layer, entry);
    }
    return [...byLayer.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [coverage]);

  function toggleLayer(id: LayerId) {
    setSelectedLayers(
      selectedLayers.includes(id) ? selectedLayers.filter((l) => l !== id) : [...selectedLayers, id]
    );
  }

  function togglePackLayer(id: PackLayerId) {
    setSelectedPackLayers(
      selectedPackLayers.includes(id)
        ? selectedPackLayers.filter((l) => l !== id)
        : [...selectedPackLayers, id]
    );
  }

  async function startDownload() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setErrors([]);
    const failures: string[] = [];

    for (const cell of selectedCells) {
      if (controller.signal.aborted) break;

      for (const layer of selectedLayers) {
        if (controller.signal.aborted) break;
        const key = `${layer}:${cell.cx}:${cell.cy}`;
        try {
          await downloadCell({
            appDb,
            layer,
            cx: cell.cx,
            cy: cell.cy,
            maxZoom: Math.min(maxZoom, USGS_MAX_NATIVE_ZOOM),
            tileUrlTemplate: BASE_MAP_TILE_URLS[layer as keyof typeof BASE_MAP_TILE_URLS],
            attribution: USGS_ATTRIBUTION,
            signal: controller.signal,
            onProgress: (done, total) => setProgress((p) => ({ ...p, [key]: done / total })),
          });
        } catch (err) {
          failures.push(`${PACK_LABELS[layer]} ${cell.cx},${cell.cy}: ${errorMessage(err)}`);
        }
      }

      for (const layer of selectedPackLayers) {
        if (controller.signal.aborted) break;
        const key = `${layer}:${cell.cx}:${cell.cy}`;
        try {
          await downloadPackCell({
            appDb,
            layer,
            cx: cell.cx,
            cy: cell.cy,
            signal: controller.signal,
            onProgress: (fraction) => setProgress((p) => ({ ...p, [key]: fraction })),
          });
          bumpPacks(); // the map picks the new cell up immediately
        } catch (err) {
          if (!controller.signal.aborted) {
            failures.push(`${PACK_LABELS[layer]} ${cell.cx},${cell.cy}: ${errorMessage(err)}`);
          }
        }
      }
    }

    await reloadCoverage();
    bumpPacks();
    setErrors(failures);
    setRunning(false);
    abortRef.current = null;
  }

  function confirmDeleteLayer(layer: string) {
    Alert.alert(
      `Delete downloaded ${PACK_LABELS[layer] ?? layer}?`,
      'The data is removed from this device. You can download it again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePackData(appDb, layer as PackLayerId);
            forgetRegionLayer(layer as PackLayerId);
            await reloadCoverage();
            bumpPacks();
          },
        },
      ]
    );
  }

  const nothingSelected = selectedLayers.length === 0 && selectedPackLayers.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        <MapScreenMap
          // Taps here pick download cells — public land must not swallow them by opening its info card.
          overlayPressEnabled={false}
          onMapPress={(lngLat) => {
            const { cx, cy } = lonLatToCell(lngLat[0], lngLat[1]);
            const isSelected = selectedCells.some((c) => c.cx === cx && c.cy === cy);
            if (isSelected) deselectCell(cx, cy);
            else selectCell(cx, cy);
          }}
        >
          <CellsOverlay cells={overlayCells} />
        </MapScreenMap>
      </View>

      <ScrollView
        style={styles.panel}
        contentContainerStyle={[styles.panelContent, { paddingBottom: 24 + insets.bottom }]}
      >
        <Text style={styles.hint}>
          Tap the map to select z10 download cells (~28x28 km each). Green = selected, blue =
          downloaded, amber = partial.
        </Text>

        <RegionPacksSection
          manifest={manifest}
          onRetry={retryManifest}
          coverage={coverage}
          labels={PACK_LABELS}
          onChanged={onRegionPacksChanged}
        />

        <HuntUnitsSection manifest={manifest} onRetry={retryManifest} />

        <Text style={styles.sectionTitle}>Map tiles</Text>
        <View style={styles.layerRow}>
          {TILE_LAYER_OPTIONS.map((layer) => (
            <Pressable
              key={layer.id}
              style={[styles.layerChip, selectedLayers.includes(layer.id) && styles.layerChipActive]}
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
          {ZOOM_OPTIONS.map((z) => (
            <Pressable
              key={z}
              style={[styles.layerChip, maxZoom === z && styles.layerChipActive]}
              onPress={() => setMaxZoom(z)}
            >
              <Text style={maxZoom === z ? styles.layerChipTextActive : undefined}>z{z}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Overlay data</Text>
        <Text style={styles.hint}>
          Fetched straight from the public services for each selected cell, so land, forest roads,
          trails, POIs and roads/trails work anywhere in the US. Region packs above are the quick
          way to get a whole region. The southwest Idaho starter region is already built in, and
          land, forest roads and trails also load on their own as you pan the main map while online
          (Layers → &ldquo;Load land data as I pan&rdquo;).
        </Text>
        {PACK_OPTIONS.map((option) => {
          const active = selectedPackLayers.includes(option.id);
          return (
            <Pressable
              key={option.id}
              style={[styles.packRow, active && styles.packRowActive]}
              onPress={() => togglePackLayer(option.id)}
            >
              <View style={[styles.checkbox, active && styles.checkboxActive]}>
                {active && <Text style={styles.checkboxTick}>✓</Text>}
              </View>
              <View style={styles.packText}>
                <Text style={styles.packLabel}>{option.label}</Text>
                <Text style={styles.packNote}>
                  {option.note} · ~{formatBytes(option.estimateBytes)}/cell
                </Text>
              </View>
            </Pressable>
          );
        })}

        <Text style={styles.summary}>
          {selectedCells.length} cell{selectedCells.length === 1 ? '' : 's'} selected
          {estimatedTotalBytes > 0 && selectedCells.length > 0
            ? ` — est. ${formatBytes(estimatedTotalBytes)}`
            : ''}
        </Text>

        <View style={styles.actionRow}>
          <Pressable
            style={[
              styles.startButton,
              styles.actionMain,
              (running || selectedCells.length === 0 || nothingSelected) && styles.startButtonDisabled,
            ]}
            disabled={running || selectedCells.length === 0 || nothingSelected}
            onPress={startDownload}
          >
            <Text style={styles.startButtonText}>{running ? 'Downloading…' : 'Start download'}</Text>
          </Pressable>
          {running ? (
            <Pressable style={styles.cancelButton} onPress={() => abortRef.current?.abort()}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          ) : (
            selectedCells.length > 0 && (
              <Pressable style={styles.cancelButton} onPress={clearSelection}>
                <Text style={styles.cancelButtonText}>Clear</Text>
              </Pressable>
            )
          )}
        </View>

        {Object.entries(progress).map(([key, value]) => (
          <Text key={key} style={styles.progressRow}>
            {progressLabel(key)} — {Math.round(value * 100)}%
          </Text>
        ))}
        {errors.map((message) => (
          <Text key={message} style={styles.errorRow}>
            {message}
          </Text>
        ))}

        {storage.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Downloaded on this device</Text>
            {storage.map(([layer, { cells, bytes }]) => (
              <View key={layer} style={styles.storageRow}>
                <View style={styles.packText}>
                  <Text style={styles.packLabel}>{PACK_LABELS[layer] ?? layer}</Text>
                  <Text style={styles.packNote}>
                    {cells} cell{cells === 1 ? '' : 's'}
                    {bytes > 0 ? ` · ${formatBytes(bytes)}` : ''}
                  </Text>
                </View>
                {PACK_OPTIONS.some((o) => o.id === layer) && (
                  <Pressable onPress={() => confirmDeleteLayer(layer)} hitSlop={8}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function progressLabel(key: string): string {
  const [layer, cx, cy] = key.split(':');
  return `${PACK_LABELS[layer] ?? layer} ${cx},${cy}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    mapContainer: { height: '40%' },
    panel: { flex: 1 },
    panelContent: { padding: 16, gap: 8 },
    hint: { color: c.textMuted, fontSize: 13 },
    sectionTitle: { fontWeight: '700', marginTop: 8 },
    layerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    layerChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: c.chip },
    layerChipActive: { backgroundColor: c.primary },
    layerChipTextActive: { color: c.onPrimary, fontWeight: '600' },
    packRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 10,
      borderRadius: 10,
      backgroundColor: c.field,
    },
    packRowActive: { backgroundColor: c.primaryTint },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxActive: { backgroundColor: c.primary, borderColor: c.primary },
    checkboxTick: { color: c.onPrimary, fontWeight: '700', fontSize: 14 },
    packText: { flex: 1 },
    packLabel: { fontWeight: '600', fontSize: 14 },
    packNote: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    summary: { marginTop: 8, fontWeight: '600' },
    actionRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
    actionMain: { flex: 1 },
    startButton: {
      marginTop: 8,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    startButtonDisabled: { backgroundColor: c.disabled },
    startButtonText: { color: c.onPrimary, fontWeight: '700' },
    cancelButton: {
      marginTop: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.danger,
      paddingHorizontal: 16,
      justifyContent: 'center',
    },
    cancelButtonText: { color: c.danger, fontWeight: '700' },
    progressRow: { fontSize: 12, color: c.textMuted, paddingVertical: 1 },
    errorRow: { fontSize: 12, color: c.danger, paddingVertical: 1 },
    storageRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    deleteText: { color: c.danger, fontWeight: '600' },
  });
