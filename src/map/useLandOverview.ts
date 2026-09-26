import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { overviewUri, pruneOverview } from '../packs/overviewStorage';
import type { MapView } from './cellWindow';
import {
  overviewBlockKey,
  overviewBlockOf,
  overviewBlocksFor,
  sameWanted,
  type LandCellRef,
  type OverviewLevel,
  type Wanted,
} from './landOverview';
import { ensureOverviewBlock } from './landOverviewBuild';

/** One block ready to mount: a GeoJSON file on disk for the level the current zoom uses. */
export interface ReadyOverviewBlock {
  /** Unique per build and level, so a rebuilt block remounts and re-reads its file. */
  id: string;
  uri: string;
  level: OverviewLevel;
}

interface Options {
  /** Whether a land layer (public land or likely private) is switched on. */
  enabled: boolean;
  /** Every downloaded (complete, non-bundled) land cell. */
  cells: readonly LandCellRef[];
}

interface BuiltEntry {
  stamp: string;
  builtAt: number;
}

const NONE: ReadyOverviewBlock[] = [];

/**
 * The wanted blocks that have been made, in wanted order, pointing at the level's file. A block whose cells changed
 * keeps showing its previous file until the rebuild finishes, rather than blinking out — it is a moment out of date,
 * not missing.
 */
function readyBlocks(wanted: Wanted, built: ReadonlyMap<string, BuiltEntry>): ReadyOverviewBlock[] {
  const ready: ReadyOverviewBlock[] = [];
  for (const { block } of wanted.blocks) {
    const key = overviewBlockKey(block);
    const entry = built.get(key);
    if (!entry) continue;
    ready.push({
      id: `land-ov-${key}-${entry.builtAt}-${wanted.level}`,
      uri: overviewUri(block.bx, block.by, entry.builtAt, wanted.level),
      level: wanted.level,
    });
  }
  return ready;
}

/**
 * The zoomed-out land overview for the map: which blocks the view wants (landOverview.ts), making their files when
 * they are missing or stale (landOverviewBuild.ts, one at a time, nearest the centre first), and the ones ready to
 * mount. State changes only when the wanted blocks do — panning within the same blocks re-renders nothing.
 */
export function useLandOverview({ enabled, cells }: Options): {
  blocks: ReadyOverviewBlock[];
  /** True while a block is being made for the first time or after its cells changed. */
  building: boolean;
  /** Tell it where the map is looking (call on every camera settle). */
  updateView: (view: MapView) => void;
} {
  const viewRef = useRef<MapView | null>(null);
  const cellsRef = useRef(cells);
  const enabledRef = useRef(enabled);
  /** Blocks made so far this session (block key -> what they were built from), read by the build loop. */
  const builtRef = useRef(new Map<string, BuiltEntry>());
  const [wanted, setWanted] = useState<Wanted | null>(null);
  // The same map as state, for rendering: replaced (not mutated) each time a block is finished.
  const [built, setBuilt] = useState<ReadonlyMap<string, BuiltEntry>>(() => new Map());
  // Which wanted list a build is running for — compared by identity, so a finished or superseded one never shows.
  const [buildingFor, setBuildingFor] = useState<Wanted | null>(null);

  const recompute = useCallback(() => {
    const view = viewRef.current;
    const next = enabledRef.current && view ? overviewBlocksFor(view, cellsRef.current) : null;
    setWanted((prev) => (sameWanted(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    cellsRef.current = cells;
    enabledRef.current = enabled;
    recompute();
  }, [cells, enabled, recompute]);

  // Files of blocks that no longer have any downloaded land (deleted from Downloads) are dead weight.
  useEffect(() => {
    try {
      pruneOverview(new Set(cells.map((cell) => overviewBlockKey(overviewBlockOf(cell.cx, cell.cy)))));
    } catch (err) {
      console.warn('Could not tidy the land overview files', err);
    }
  }, [cells]);

  // Make what is missing, nearest the centre first; each block shows up as soon as it is done.
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    (async () => {
      for (const want of wanted.blocks) {
        const key = overviewBlockKey(want.block);
        if (builtRef.current.get(key)?.stamp === want.stamp) continue;
        const builtAt = await ensureOverviewBlock(want, () => {
          if (!cancelled) setBuildingFor(wanted);
        });
        if (cancelled) return;
        if (builtAt !== null) {
          builtRef.current.set(key, { stamp: want.stamp, builtAt });
          setBuilt(new Map(builtRef.current));
        }
      }
      setBuildingFor((current) => (current === wanted ? null : current));
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  const blocks = useMemo(() => (wanted ? readyBlocks(wanted, built) : NONE), [wanted, built]);

  const updateView = useCallback(
    (view: MapView) => {
      viewRef.current = view;
      recompute();
    },
    [recompute]
  );

  return { blocks, building: wanted !== null && buildingFor === wanted, updateView };
}
