import { cellBounds } from '../downloads/cells';
import { readPackCellText } from '../packs/packStorage';
import { overviewFilesExist, readOverviewMeta, writeOverviewBlock } from '../packs/overviewStorage';
import {
  OVERVIEW_LEVELS,
  overviewBlockKey,
  overviewFeatures,
  type OverviewLevel,
  type WantedBlock,
} from './landOverview';

/** Cells read and thinned between breaths handed back to the UI thread. */
const YIELD_EVERY = 6;
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const LEVELS = Object.keys(OVERVIEW_LEVELS) as OverviewLevel[];

/** Builds in flight, so two maps (the main one and the Downloads one) never build the same block twice. */
const inFlight = new Map<string, Promise<number | null>>();

async function build({ block, cells, stamp }: WantedBlock): Promise<number | null> {
  try {
    const features = { coarse: [], fine: [] } as Record<OverviewLevel, ReturnType<typeof overviewFeatures>>;
    for (let i = 0; i < cells.length; i++) {
      const { cx, cy } = cells[i];
      const text = await readPackCellText('land', cx, cy);
      if (text) {
        try {
          const collection = JSON.parse(text);
          const box = cellBounds(cx, cy);
          for (const level of LEVELS)
            features[level].push(...overviewFeatures(collection, box, OVERVIEW_LEVELS[level].tolerance));
        } catch {
          // A cell file that will not parse is left out; the detailed layer will not draw it either.
        }
      }
      if ((i + 1) % YIELD_EVERY === 0) await yieldToUi();
    }
    const builtAt = Date.now();
    const json = Object.fromEntries(
      LEVELS.map((level) => [level, JSON.stringify({ type: 'FeatureCollection', features: features[level] })])
    ) as Record<OverviewLevel, string>;
    writeOverviewBlock(block.bx, block.by, { stamp, builtAt }, json);
    return builtAt;
  } catch (err) {
    console.warn(`Could not build the land overview for block ${overviewBlockKey(block)}`, err);
    return null;
  }
}

/**
 * The build time of a block's overview files, making them first if they are missing or were built from different
 * cells than are on the phone now. Null when it could not be built. `onBuild` is called (once) when real work starts,
 * so the map can say "preparing".
 */
export async function ensureOverviewBlock(wanted: WantedBlock, onBuild?: () => void): Promise<number | null> {
  const { block, stamp } = wanted;
  const meta = await readOverviewMeta(block.bx, block.by);
  if (meta && meta.stamp === stamp && overviewFilesExist(block.bx, block.by, meta.builtAt)) return meta.builtAt;

  const key = `${overviewBlockKey(block)}:${stamp}`;
  const running = inFlight.get(key);
  if (running) return running;
  onBuild?.();
  const promise = build(wanted).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
