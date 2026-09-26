import type { Bounds, PackLayerId } from '../packs/types';
import { CELL_WINDOW_MIN_ZOOM } from '../map/cellWindow';
import {
  AUTO_LOAD_MAX_CELLS,
  AUTO_LOAD_MAX_CONSECUTIVE_FAILURES,
  AUTO_LOAD_MIN_ZOOM,
  AUTO_LOAD_PAUSE_MS,
  AUTO_LOAD_RETRY_MS,
  AutoLoader,
  planAutoLoad,
  type AutoLoadState,
  type AutoLoadTarget,
} from './autoLoad';
import { cellBounds } from './cells';

const NONE_COVERED = () => false;

/** A view exactly covering the given block of cells, centered on `center` (defaults to the block's middle). */
function viewOf(cx0: number, cy0: number, cx1: number, cy1: number) {
  const nw = cellBounds(cx0, cy0);
  const se = cellBounds(cx1, cy1);
  const bounds: Bounds = [nw[0], se[1], se[2], nw[3]];
  const center: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  return { bounds, center };
}

const plan = (over: Partial<Parameters<typeof planAutoLoad>[0]> = {}) =>
  planAutoLoad({
    ...viewOf(190, 373, 191, 374),
    zoom: 11,
    layers: ['land'],
    isCovered: NONE_COVERED,
    ...over,
  });

describe('planAutoLoad', () => {
  it('starts fetching at the zoom the map starts drawing downloaded cells, so nothing is fetched that cannot be shown', () => {
    expect(AUTO_LOAD_MIN_ZOOM).toBe(CELL_WINDOW_MIN_ZOOM);
  });

  it('waits until the user has zoomed in on something', () => {
    expect(plan({ zoom: AUTO_LOAD_MIN_ZOOM - 0.01 })).toEqual([]);
    expect(plan({ zoom: AUTO_LOAD_MIN_ZOOM }).length).toBeGreaterThan(0);
  });

  it('plans nothing when no cell-based overlay is switched on', () => {
    expect(plan({ layers: [] })).toEqual([]);
  });

  it('never plans the slow Overpass-backed layers, even if asked', () => {
    const targets = plan({ layers: ['osm', 'poi', 'land'] as PackLayerId[] });
    expect(targets.every((t) => t.layer === 'land')).toBe(true);
  });

  it('plans every uncovered cell in view, land before mvum before trails within a cell', () => {
    const targets = plan({ layers: ['trails', 'land', 'mvum'] });
    expect(targets).toHaveLength(4 * 3); // 2x2 cells
    expect(targets.slice(0, 3).map((t) => t.layer)).toEqual(['land', 'mvum', 'trails']);
    const cells = new Set(targets.map((t) => `${t.cx}:${t.cy}`));
    expect(cells).toEqual(new Set(['190:373', '191:373', '190:374', '191:374']));
  });

  it('skips cells the device already has, per layer', () => {
    const covered = new Set(['land:190:373', 'mvum:191:374']);
    const targets = plan({
      layers: ['land', 'mvum'],
      isCovered: (layer, cx, cy) => covered.has(`${layer}:${cx}:${cy}`),
    });
    expect(targets.map((t) => `${t.layer}:${t.cx}:${t.cy}`)).not.toContain('land:190:373');
    expect(targets.map((t) => `${t.layer}:${t.cx}:${t.cy}`)).not.toContain('mvum:191:374');
    expect(targets).toHaveLength(8 - 2);
  });

  it('returns nothing when everything in view is covered', () => {
    expect(plan({ isCovered: () => true })).toEqual([]);
  });

  it('orders cells nearest the center first', () => {
    // A 3x3 block centered on cell (191,374).
    const { bounds } = viewOf(190, 373, 192, 375);
    const center = cellBounds(191, 374);
    const targets = plan({ bounds, center: [(center[0] + center[2]) / 2, (center[1] + center[3]) / 2] });
    expect(targets[0]).toMatchObject({ cx: 191, cy: 374 });
    // the four edge-adjacent cells come before the four corners
    const order = targets.map((t) => `${t.cx}:${t.cy}`);
    for (const edge of ['190:374', '192:374', '191:373', '191:375']) {
      for (const corner of ['190:373', '192:373', '190:375', '192:375']) {
        expect(order.indexOf(edge)).toBeLessThan(order.indexOf(corner));
      }
    }
  });

  it('caps a huge view to the cells closest to the center', () => {
    const { bounds, center } = viewOf(180, 365, 195, 380); // 16x16 = 256 cells
    const targets = plan({ bounds, center });
    expect(targets).toHaveLength(AUTO_LOAD_MAX_CELLS);
    const nearest = Math.max(...targets.map((t) => Math.hypot(t.cx - 187.5, t.cy - 372.5)));
    expect(nearest).toBeLessThan(4); // all from the middle of the block, not a corner
  });
});

describe('AutoLoader', () => {
  const T = (layer: PackLayerId, cx: number, cy = 373): AutoLoadTarget => ({ layer, cx, cy });
  /** Lets the loader's promise chain run. */
  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  function harness(behaviour: (t: AutoLoadTarget, signal: AbortSignal) => Promise<void> = async () => undefined) {
    let now = 1_000_000;
    const done: string[] = [];
    const states: AutoLoadState[] = [];
    const download = jest.fn(async (t: AutoLoadTarget, signal: AbortSignal) => {
      await behaviour(t, signal);
      done.push(`${t.layer}:${t.cx}`);
    });
    const loader = new AutoLoader({ download, now: () => now, onChange: (s) => states.push({ ...s }) });
    return { loader, download, done, states, advance: (ms: number) => (now += ms) };
  }

  it('downloads the plan one cell at a time, in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const h = harness(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
    });
    h.loader.update([T('land', 1), T('land', 2), T('mvum', 2)]);
    await flush();
    expect(h.done).toEqual(['land:1', 'land:2', 'mvum:2']);
    expect(maxInFlight).toBe(1); // gentle on the shared public servers (§4.4)
  });

  it('reports what it is doing, then goes idle', async () => {
    const h = harness();
    h.loader.update([T('land', 1), T('land', 2)]);
    await flush();
    expect(h.states.some((s) => s.active?.cx === 1 && s.pending === 1)).toBe(true);
    expect(h.states[h.states.length - 1]).toEqual({ pending: 0, active: null, paused: false });
  });

  it('a newer plan replaces what was still waiting (the user panned on) but not the fetch in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness((t) => (t.cx === 1 ? gate : Promise.resolve()));
    h.loader.update([T('land', 1), T('land', 2), T('land', 3)]);
    await flush();
    expect(h.download).toHaveBeenCalledTimes(1); // cell 1 is running, 2 and 3 wait
    h.loader.update([T('land', 1), T('land', 9)]); // moved: 1 is still wanted (and running), 2 and 3 no longer are
    release();
    await flush();
    expect(h.done).toEqual(['land:1', 'land:9']);
  });

  it('does not re-queue the cell that is being fetched right now', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness(() => gate);
    h.loader.update([T('land', 1)]);
    await flush();
    h.loader.update([T('land', 1)]);
    release();
    await flush();
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed cell for 5 minutes, then does', async () => {
    let fail = true;
    const h = harness(async () => {
      if (fail) throw new Error('HTTP 500');
    });
    h.loader.update([T('land', 1)]);
    await flush();
    expect(h.download).toHaveBeenCalledTimes(1);

    h.advance(AUTO_LOAD_RETRY_MS - 1);
    h.loader.update([T('land', 1)]);
    await flush();
    expect(h.download).toHaveBeenCalledTimes(1); // still backing off

    fail = false;
    h.advance(1);
    h.loader.update([T('land', 1)]);
    await flush();
    expect(h.download).toHaveBeenCalledTimes(2);
    expect(h.done).toEqual(['land:1']);
  });

  it('one bad cell does not stop the rest of the queue', async () => {
    const h = harness(async (t) => {
      if (t.cx === 1) throw new Error('boom');
    });
    h.loader.update([T('land', 1), T('land', 2), T('land', 3)]);
    await flush();
    expect(h.done).toEqual(['land:2', 'land:3']);
  });

  it(`assumes it is offline after ${AUTO_LOAD_MAX_CONSECUTIVE_FAILURES} failures in a row: drops the queue and pauses`, async () => {
    const h = harness(async () => {
      throw new Error('Network request failed');
    });
    h.loader.update([T('land', 1), T('land', 2), T('land', 3), T('land', 4)]);
    await flush();
    expect(h.download).toHaveBeenCalledTimes(AUTO_LOAD_MAX_CONSECUTIVE_FAILURES); // did not hammer through all four
    expect(h.loader.state.paused).toBe(true);

    h.loader.update([T('land', 5)]); // panning while paused does nothing
    await flush();
    expect(h.download).toHaveBeenCalledTimes(AUTO_LOAD_MAX_CONSECUTIVE_FAILURES);

    h.advance(AUTO_LOAD_PAUSE_MS + 1); // back online, some time later
    h.loader.update([T('land', 5)]);
    await flush();
    expect(h.download).toHaveBeenCalledTimes(AUTO_LOAD_MAX_CONSECUTIVE_FAILURES + 1);
    expect(h.loader.state.paused).toBe(false);
  });

  it('a success in between resets the failure streak, so scattered errors never trigger the pause', async () => {
    const h = harness(async (t) => {
      if (t.cx % 2 === 1) throw new Error('flaky');
    });
    h.loader.update([T('land', 1), T('land', 2), T('land', 3), T('land', 4), T('land', 5)]);
    await flush();
    expect(h.done).toEqual(['land:2', 'land:4']);
    expect(h.loader.state.paused).toBe(false);
  });

  it('stop aborts the fetch in flight and ignores later plans', async () => {
    let signal!: AbortSignal;
    const h = harness((_t, s) => {
      signal = s;
      return new Promise(() => undefined); // never settles on its own
    });
    h.loader.update([T('land', 1), T('land', 2)]);
    await flush();
    h.loader.stop();
    expect(signal.aborted).toBe(true);
    h.loader.update([T('land', 3)]);
    await flush();
    expect(h.download).toHaveBeenCalledTimes(1);
    expect(h.loader.state.pending).toBe(0);
  });

  it('an empty plan just drains and idles', async () => {
    const h = harness();
    h.loader.update([]);
    await flush();
    expect(h.download).not.toHaveBeenCalled();
    expect(h.loader.state).toEqual({ pending: 0, active: null, paused: false });
  });
});
