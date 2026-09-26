import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import type { CoverageRow } from '../data/types';
import { LAYER_LABELS } from '../downloads/downloadOptions';
import { listCoverage } from '../downloads/coverageRepo';
import { US_STATE_CELLS, viewFitting } from '../downloads/stateCells';
import { useRegionManifest } from '../downloads/useRegionManifest';
import { US_STATES } from '../packs/usStates';
import { useCameraStore } from '../state/useCameraStore';
import { useDownloadStore } from '../state/useDownloadStore';
import { usePackStore } from '../state/usePackStore';
import { Text, useThemedStyles, type ThemeColors } from '../theme';
import { OnDeviceTab } from './downloads/OnDeviceTab';
import { PickAreaTab } from './downloads/PickAreaTab';
import { HuntUnitsSection } from './components/HuntUnitsSection';
import { RegionPacksSection } from './components/RegionPacksSection';
import { SegmentedTabs } from './components/SegmentedTabs';

type TabId = 'pick' | 'overlays' | 'device';
type MapView = { center: [number, number]; zoom: number };

const TABS: { id: TabId; label: string }[] = [
  { id: 'pick', label: 'Pick an area' },
  { id: 'overlays', label: 'State overlays' },
  { id: 'device', label: 'On this phone' },
];

/** About the size of the Pick an area map on a phone — for framing a state before that map has been measured. */
const PICK_MAP_SIZE = { width: 360, height: 260 };

/**
 * Three jobs, three tabs, instead of one long scroll:
 *  - Pick an area: choose squares — or a whole state — on the map and what to save for them (the general way, works
 *    anywhere, and the only one that can save offline map pictures).
 *  - State overlays: a state's land, trail and hunt-unit data in a few taps, from packs built ahead of time. Overlays
 *    only — no base map — so the tab says so up front and links each state over to Pick an area for map pictures.
 *  - On this phone: what is stored, split by state, and removing it.
 */
export function DownloadsScreen() {
  const appDb = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bumpPacks = usePackStore((s) => s.bump);
  const { manifest, retry: retryManifest } = useRegionManifest(); // one fetch, shared by the two State overlays sections

  const [tab, setTab] = useState<TabId>('pick');
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  // The Pick an area map is unmounted while you look at another tab, so its view is kept here to come back to.
  // It starts where the main map is looking; `mapView` follows the live map and is copied into state on tab change
  // (a ref can't be read while rendering).
  const [pickView, setPickView] = useState<MapView>(() => {
    const { center, zoom } = useCameraStore.getState();
    return { center, zoom };
  });
  const mapView = useRef<MapView>(pickView);

  const reloadCoverage = useCallback(async () => setCoverage(await listCoverage(appDb)), [appDb]);
  useFocusEffect(
    useCallback(() => {
      void reloadCoverage();
    }, [reloadCoverage])
  );
  const onRegionPacksChanged = useCallback(async () => {
    await reloadCoverage();
    bumpPacks(); // the map picks the newly installed squares up straight away
  }, [reloadCoverage, bumpPacks]);
  const onViewChange = useCallback((view: MapView) => {
    mapView.current = view;
  }, []);
  function changeTab(next: TabId) {
    if (tab === 'pick') setPickView(mapView.current);
    setTab(next);
  }
  /** State overlays covers overlay data only; this carries a state over to Pick an area, where map pictures can be added too. */
  function pickStateForMapPictures(regionId: string) {
    const state = US_STATES.find((candidate) => candidate.id === regionId);
    if (!state) return;
    const { selectedCells, setSelectedCells } = useDownloadStore.getState();
    setSelectedCells(US_STATE_CELLS.addState(selectedCells, state.code));
    const bounds = US_STATE_CELLS.boundsOf(state.code);
    if (bounds) {
      const view = viewFitting(bounds, PICK_MAP_SIZE);
      mapView.current = view;
      setPickView(view);
    }
    setTab('pick');
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs tabs={TABS} value={tab} onChange={changeTab} />
      </View>

      {tab === 'pick' && (
        <PickAreaTab
          coverage={coverage}
          manifest={manifest}
          reloadCoverage={reloadCoverage}
          initialView={pickView}
          onViewChange={onViewChange}
          onSeeOverlays={() => changeTab('overlays')}
        />
      )}

      {tab === 'overlays' && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
          <View style={styles.callout}>
            <Text style={styles.calloutTitle}>Overlays only — not the map itself</Text>
            <Text style={styles.lead}>
              These packs draw public land, roads, trails and hunt units on top of the map. The base map underneath
              still needs a signal unless you also save its pictures under{' '}
              <Text style={styles.link} onPress={() => changeTab('pick')}>
                Pick an area
              </Text>{' '}
              (each state below links there too).
            </Text>
          </View>
          <Text style={styles.lead}>
            A whole state&rsquo;s overlay data in a few taps — much quicker than picking squares by hand. K-Maps covers
            the United States only.
          </Text>
          <RegionPacksSection
            manifest={manifest}
            onRetry={retryManifest}
            coverage={coverage}
            labels={LAYER_LABELS}
            onChanged={onRegionPacksChanged}
            onPickMapPictures={pickStateForMapPictures}
          />
          <HuntUnitsSection manifest={manifest} onRetry={retryManifest} />
        </ScrollView>
      )}

      {tab === 'device' && <OnDeviceTab coverage={coverage} reloadCoverage={reloadCoverage} />}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    tabs: { paddingHorizontal: 16, paddingVertical: 10 },
    content: { padding: 16, gap: 12 },
    lead: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    callout: { gap: 4, padding: 12, borderRadius: 10, backgroundColor: c.primaryTint },
    calloutTitle: { fontSize: 14, fontWeight: '700' },
    link: { color: c.primaryText, fontWeight: '600' },
  });
