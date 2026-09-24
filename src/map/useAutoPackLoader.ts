import { useCallback, useEffect, useRef } from 'react';
import type { ViewState } from '@maplibre/maplibre-react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { AutoLoader, planAutoLoad } from '../downloads/autoLoad';
import { listCoverage } from '../downloads/coverageRepo';
import { downloadPackCell } from '../downloads/packDownloader';
import { isCellBundled } from '../packs/region';
import type { PackLayerId } from '../packs/types';
import { useAutoLoadStore } from '../state/useAutoLoadStore';
import { usePackStore } from '../state/usePackStore';

/** Wait for the camera to stop moving before deciding what to fetch — a fling shouldn't queue a dozen cells. */
const SETTLE_MS = 700;

interface Options {
  /** Master switch (Layers -> "Load data as I pan"). Off = the loader stops and nothing is fetched. */
  enabled: boolean;
  /** Vector packs whose overlay is currently on; anything else isn't fetched. */
  layers: readonly PackLayerId[];
}

/**
 * Keeps the per-cell vector packs (public land, MVUM, USFS trails) filled in for wherever the map is
 * looking, not just the bundled starter region. Returns the callback to feed camera changes into
 * (`onViewStateChange`); it holds the latest view in a ref, so panning never re-renders anything here.
 */
export function useAutoPackLoader({ enabled, layers }: Options): (view: ViewState) => void {
  const db = useSQLiteContext();
  const viewRef = useRef<ViewState | null>(null);
  const loaderRef = useRef<AutoLoader | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layersKey = layers.join(',');
  // The planner reads the latest layers when it fires (after the camera settles), not the ones from when it was scheduled.
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  const plan = useCallback(async () => {
    const loader = loaderRef.current;
    const view = viewRef.current;
    if (!loader || !view) return;
    const rows = await listCoverage(db);
    const complete = new Set(rows.filter((r) => r.status === 'complete').map((r) => `${r.layer}:${r.cell_x}:${r.cell_y}`));
    loader.update(
      planAutoLoad({
        bounds: view.bounds,
        center: view.center,
        zoom: view.zoom,
        layers: layersRef.current,
        isCovered: (layer, cx, cy) => isCellBundled(layer, cx, cy) || complete.has(`${layer}:${cx}:${cy}`),
      })
    );
  }, [db]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      plan().catch((err) => console.warn('Auto-load planning failed', err));
    }, SETTLE_MS);
  }, [plan]);

  useEffect(() => {
    if (!enabled) return;
    const loader = new AutoLoader({
      download: async (target, signal) => {
        await downloadPackCell({ appDb: db, layer: target.layer, cx: target.cx, cy: target.cy, signal });
        usePackStore.getState().bump(); // the map picks the new cell up straight away
      },
      onChange: (state) => useAutoLoadStore.setState(state),
    });
    loaderRef.current = loader;
    schedule(); // plan for the view we already have (a layer was just switched on)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      loader.stop();
      loaderRef.current = null;
    };
  }, [db, enabled, layersKey, schedule]);

  return useCallback(
    (view: ViewState) => {
      viewRef.current = view;
      if (loaderRef.current) schedule();
    },
    [schedule]
  );
}
