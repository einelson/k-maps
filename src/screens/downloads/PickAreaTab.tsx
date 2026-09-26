import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { ViewState } from '@maplibre/maplibre-react-native';
import { useSQLiteContext } from 'expo-sqlite';

import type { CoverageRow } from '../../data/types';
import {
  blockRangeInBounds,
  blockSizeForZoom,
  MAX_SELECTED_CELLS,
  selectCellsInView,
  selectionAreaKm2,
  toggleBlock,
} from '../../downloads/blockSelect';
import { lonLatToCell } from '../../downloads/cells';
import { US_COVERAGE } from '../../downloads/usCells';
import { DETAIL_OPTIONS, PACK_OPTIONS, TILE_LAYER_OPTIONS } from '../../downloads/downloadOptions';
import { estimateDownload, planDownload, tileBytesPerCell } from '../../downloads/downloadPlan';
import { formatBytes, formatWait } from '../../downloads/formatBytes';
import { freeDiskBytes } from '../../downloads/freeSpace';
import { startDownload } from '../../downloads/startDownload';
import { formatArea } from '../../features/formatUnits';
import { BlockGridOverlay, type BlockGridRange } from '../../map/BlockGridOverlay';
import { CELL_STATE_COLORS, CellsOverlay, type CellOverlayEntry } from '../../map/CellsOverlay';
import { MapScreenMap } from '../../map/MapView';
import type { LayerId } from '../../downloads/types';
import type { PackLayerId } from '../../packs/types';
import { useDownloadRunStore } from '../../state/useDownloadRunStore';
import { useDownloadStore } from '../../state/useDownloadStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { DownloadFooter } from './DownloadFooter';
import { DownloadHeaderButton } from './DownloadHeaderButton';

interface Props {
  coverage: CoverageRow[];
  reloadCoverage: () => Promise<void>;
  /** Where the map starts, so it stays where you left it when you switch tabs and back. */
  initialView: { center: [number, number]; zoom: number };
  onViewChange: (view: { center: [number, number]; zoom: number }) => void;
  onSeeReadyMade: () => void;
}

/** Won't start a download that needs more than this share of the phone's free space. */
const FREE_SPACE_SHARE = 0.9;
/** Only squares that hold US land can be picked. */
const isUsCell = ({ cx, cy }: { cx: number; cy: number }) => US_COVERAGE.hasLand(cx, cy);
/** Ask before starting anything bigger than this. */
const CONFIRM_BYTES = 1_000_000_000;

/**
 * Downloads -> "Pick an area": the map to choose squares on, what to save for them, and a footer that always
 * shows the total. The Download button sits at the right end of the screen's header, so the picklist keeps the room. A tap picks a block of squares sized to the zoom (blockSelect.ts),
 * so zooming out picks a whole region in a few taps.
 */
export function PickAreaTab({ coverage, reloadCoverage, initialView, onViewChange, onSeeReadyMade }: Props) {
  const appDb = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const units = useSettingsStore((s) => s.units);
  const navigation = useNavigation();
  const runStatus = useDownloadRunStore((s) => s.status);

  const selectedCells = useDownloadStore((s) => s.selectedCells);
  const setSelectedCells = useDownloadStore((s) => s.setSelectedCells);
  const clearSelection = useDownloadStore((s) => s.clearSelection);
  const selectedLayers = useDownloadStore((s) => s.selectedLayers);
  const setSelectedLayers = useDownloadStore((s) => s.setSelectedLayers);
  const selectedPackLayers = useDownloadStore((s) => s.selectedPackLayers);
  const setSelectedPackLayers = useDownloadStore((s) => s.setSelectedPackLayers);
  const maxZoom = useDownloadStore((s) => s.maxZoom);
  const setMaxZoom = useDownloadStore((s) => s.setMaxZoom);

  const viewRef = useRef<ViewState | null>(null);
  const [blockSize, setBlockSize] = useState(() => blockSizeForZoom(initialView.zoom));
  const [grid, setGrid] = useState<BlockGridRange | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // What a tap picks and where the grid is drawn follow the zoom; both change only when the view crosses a block
  // boundary or a zoom step, so ordinary panning doesn't re-render the screen.
  const handleView = useCallback(
    (view: ViewState) => {
      viewRef.current = view;
      onViewChange({ center: view.center, zoom: view.zoom });
      const size = blockSizeForZoom(view.zoom);
      setBlockSize(size);
      const range = blockRangeInBounds(view.bounds, size);
      setGrid((prev) =>
        prev &&
        prev.size === size &&
        prev.bxMin === range.bxMin &&
        prev.bxMax === range.bxMax &&
        prev.byMin === range.byMin &&
        prev.byMax === range.byMax
          ? prev
          : { size, ...range }
      );
    },
    [onViewChange]
  );

  function handleMapPress(lngLat: [number, number]) {
    const size = blockSizeForZoom(viewRef.current?.zoom ?? initialView.zoom);
    const change = toggleBlock(selectedCells, lonLatToCell(lngLat[0], lngLat[1]), size, MAX_SELECTED_CELLS, isUsCell);
    applyChange(change);
  }

  function handleSelectView() {
    if (!viewRef.current) return;
    applyChange(selectCellsInView(selectedCells, viewRef.current.bounds, MAX_SELECTED_CELLS, isUsCell));
  }

  function applyChange(change: ReturnType<typeof toggleBlock>) {
    if (change.kind === 'too-many') {
      setNotice(
        `That would be ${change.wouldBe} squares — the most at once is ${MAX_SELECTED_CELLS}. ` +
          'Zoom in and pick a smaller area, or use Ready-made downloads for a whole state.'
      );
      return;
    }
    if (change.kind === 'no-land') {
      setNotice('There is no US land there — K-Maps only covers the United States.');
      return;
    }
    setNotice(null);
    setSelectedCells(change.cells);
  }

  // One outline per square: green if picked, otherwise blue when anything is fully downloaded, amber when only partly.
  const overlayCells = useMemo<CellOverlayEntry[]>(() => {
    const downloaded = new Map<string, CellOverlayEntry>();
    for (const row of coverage) {
      if (row.status !== 'complete' && row.status !== 'partial') continue;
      const key = `${row.cell_x}:${row.cell_y}`;
      if (downloaded.get(key)?.state === 'complete') continue;
      downloaded.set(key, { cx: row.cell_x, cy: row.cell_y, state: row.status });
    }
    return [
      ...downloaded.values(),
      ...selectedCells.map(({ cx, cy }): CellOverlayEntry => ({ cx, cy, state: 'selected' })),
    ];
  }, [coverage, selectedCells]);

  const plan = useMemo(
    () =>
      planDownload({
        cells: selectedCells,
        tileLayers: selectedLayers,
        packLayers: selectedPackLayers,
        maxZoom,
        coverage,
      }),
    [selectedCells, selectedLayers, selectedPackLayers, maxZoom, coverage]
  );
  const estimate = useMemo(() => estimateDownload(plan.jobs, maxZoom), [plan.jobs, maxZoom]);
  const areaKm2 = useMemo(() => selectionAreaKm2(selectedCells), [selectedCells]);
  const toggleTile = (id: LayerId) =>
    setSelectedLayers(selectedLayers.includes(id) ? selectedLayers.filter((l) => l !== id) : [...selectedLayers, id]);
  const togglePack = (id: PackLayerId) =>
    setSelectedPackLayers(
      selectedPackLayers.includes(id) ? selectedPackLayers.filter((l) => l !== id) : [...selectedPackLayers, id]
    );

  const nothingChosen = selectedLayers.length === 0 && selectedPackLayers.length === 0;
  const blocked = (() => {
    if (selectedCells.length === 0) return 'Tap the map to pick an area first.';
    if (nothingChosen) return 'Choose what to save under step 2.';
    if (plan.jobs.length === 0) return 'Everything you picked is already on this phone.';
    const free = freeDiskBytes(); // a cheap read, only reached once there is something to download
    if (free !== null && estimate.bytes > free * FREE_SPACE_SHARE) {
      return `Not enough space: this needs about ${formatBytes(estimate.bytes)} and the phone has ${formatBytes(free)} free.`;
    }
    return null;
  })();

  function beginDownload() {
    void startDownload({
      appDb,
      cells: selectedCells,
      tileLayers: selectedLayers,
      packLayers: selectedPackLayers,
      maxZoom,
    });
  }

  function handleDownload() {
    if (estimate.bytes < CONFIRM_BYTES) {
      beginDownload();
      return;
    }
    Alert.alert(
      'Large download',
      `This will use about ${formatBytes(estimate.bytes)} of storage${
        estimate.packSeconds > 0
          ? ` and take ${formatWait(estimate.packSeconds)} for the land and trail data alone`
          : ''
      }. Keep K-Maps open until it finishes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: beginDownload },
      ]
    );
  }

  // The header button always runs the latest handler without the header being rebuilt on every render.
  const downloadRef = useRef(handleDownload);
  useEffect(() => {
    downloadRef.current = handleDownload;
  });
  // A running (or just-finished, not yet dismissed) download owns the footer, so a second one can't be started.
  const downloadDisabled = blocked !== null || runStatus !== 'idle';
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <DownloadHeaderButton disabled={downloadDisabled} onPress={() => downloadRef.current()} />,
    });
  }, [navigation, downloadDisabled]);
  // The header belongs to the whole Downloads screen: take the button away when this tab goes.
  useLayoutEffect(() => () => navigation.setOptions({ headerRight: undefined }), [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.mapArea}>
        <MapScreenMap
          // Taps here pick squares — public land must not swallow them by opening its info card.
          overlayPressEnabled={false}
          onMapPress={handleMapPress}
          onViewStateChange={handleView}
          initialView={initialView}
          scaleBarBottom={30}
        >
          <BlockGridOverlay grid={grid} />
          <CellsOverlay cells={overlayCells} />
        </MapScreenMap>

        <View pointerEvents="none" style={styles.hintPill}>
          <Text style={styles.hintPillTitle}>
            {blockSize === 1 ? 'Each tap picks 1 square' : `Each tap picks ${blockSize} × ${blockSize} squares`}
          </Text>
          <Text style={styles.hintPillText}>
            {blockSize === 1
              ? 'Zoom out to pick more at once'
              : blockSize === 16
                ? 'Zoom in for smaller squares'
                : 'Zoom out for bigger, in for smaller'}
          </Text>
        </View>

        <View style={styles.mapButtons}>
          <Pressable style={styles.mapButton} onPress={handleSelectView} accessibilityRole="button">
            <Text style={styles.mapButtonText}>Pick everything in view</Text>
          </Pressable>
          {selectedCells.length > 0 && (
            <Pressable
              style={styles.mapButton}
              onPress={() => {
                clearSelection();
                setNotice(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.mapButtonText}>Clear</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.stepTitle}>1 · Pick the area</Text>
        {selectedCells.length === 0 ? (
          <Text style={styles.body}>
            Tap the map to pick squares (each is about {units === 'imperial' ? '18 miles' : '30 km'} across). Zoom out
            first to pick a whole region in a few taps. Need a whole state? Try{' '}
            <Text style={styles.link} onPress={onSeeReadyMade}>
              Ready-made downloads
            </Text>
            .
          </Text>
        ) : (
          <Text style={styles.selection}>
            {selectedCells.length} square{selectedCells.length === 1 ? '' : 's'} picked · about{' '}
            {formatArea(areaKm2, units)}
          </Text>
        )}
        {notice && <Text style={styles.warning}>{notice}</Text>}
        <View style={styles.legend}>
          <LegendDot color={CELL_STATE_COLORS.selected} label="Picked" />
          <LegendDot color={CELL_STATE_COLORS.complete} label="On your phone" />
          <LegendDot color={CELL_STATE_COLORS.partial} label="Partly on your phone" />
        </View>

        <Text style={styles.stepTitle}>2 · Choose what to save</Text>

        <Text style={styles.groupTitle}>Land &amp; trail data</Text>
        <Text style={styles.body}>
          Small files, so a big area is fine. This also loads by itself as you browse the main map online — download it
          here to have it offline before you leave.
        </Text>
        {PACK_OPTIONS.map((option) => {
          const active = selectedPackLayers.includes(option.id);
          return (
            <Pressable
              key={option.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              style={[styles.option, active && styles.optionActive]}
              onPress={() => togglePack(option.id)}
            >
              <View style={[styles.checkbox, active && styles.checkboxActive]}>
                {active && <Text style={styles.checkboxTick}>✓</Text>}
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionNote}>
                  {option.note} · about {formatBytes(option.estimateBytes)} per square
                </Text>
              </View>
            </Pressable>
          );
        })}

        <Text style={styles.groupTitle}>Offline map pictures</Text>
        <Text style={styles.body}>
          Lets the base map work with no signal. These are large — Maximum detail can be around 100 MB for every square.
        </Text>
        <View style={styles.chipRow}>
          {TILE_LAYER_OPTIONS.map((layer) => (
            <Chip
              key={layer.id}
              label={layer.label}
              active={selectedLayers.includes(layer.id)}
              onPress={() => toggleTile(layer.id)}
            />
          ))}
        </View>
        {selectedLayers.length > 0 && (
          <>
            <Text style={styles.subLabel}>Detail</Text>
            <View style={styles.chipRow}>
              {DETAIL_OPTIONS.map((detail) => (
                <Chip
                  key={detail.zoom}
                  label={detail.label}
                  active={maxZoom === detail.zoom}
                  onPress={() => setMaxZoom(detail.zoom)}
                />
              ))}
            </View>
            <Text style={styles.optionNote}>
              About {formatBytes(selectedLayers.reduce((sum, layer) => sum + tileBytesPerCell(layer, maxZoom), 0))} per
              square for what you picked, at zoom {maxZoom}.
            </Text>
          </>
        )}
      </ScrollView>

      <DownloadFooter
        blocked={blocked}
        jobCount={plan.jobs.length}
        skipped={plan.skipped}
        estimate={estimate}
        hasSelection={selectedCells.length > 0}
        onRetry={beginDownload}
        reloadCoverage={reloadCoverage}
      />
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={active ? styles.chipTextActive : styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    mapArea: { flex: 4 },
    hintPill: {
      position: 'absolute',
      top: 8,
      left: 8,
      maxWidth: '62%',
      backgroundColor: c.overlay,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
    },
    hintPillTitle: { fontSize: 13, fontWeight: '700' },
    hintPillText: { fontSize: 11, color: c.textSecondary },
    mapButtons: { position: 'absolute', right: 8, bottom: 24, alignItems: 'flex-end', gap: 6 },
    mapButton: {
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 18,
      elevation: 3,
      shadowColor: c.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
    mapButtonText: { fontSize: 13, fontWeight: '600' },
    panel: { flex: 5 },
    panelContent: { padding: 16, gap: 8 },
    stepTitle: { fontSize: 16, fontWeight: '700', marginTop: 6 },
    groupTitle: { fontSize: 14, fontWeight: '700', marginTop: 6 },
    subLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginTop: 4, textTransform: 'uppercase' },
    body: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    link: { color: c.primaryText, fontWeight: '600' },
    selection: { fontSize: 15, fontWeight: '600' },
    warning: { fontSize: 13, color: c.danger },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 11, height: 11, borderRadius: 3 },
    legendText: { fontSize: 12, color: c.textMuted },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 10,
      borderRadius: 10,
      backgroundColor: c.field,
    },
    optionActive: { backgroundColor: c.primaryTint },
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
    optionText: { flex: 1 },
    optionLabel: { fontWeight: '600', fontSize: 14 },
    optionNote: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: c.chip },
    chipActive: { backgroundColor: c.primary },
    chipText: { fontWeight: '600' },
    chipTextActive: { color: c.onPrimary, fontWeight: '700' },
  });
