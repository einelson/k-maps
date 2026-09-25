import { cellBounds } from '../downloads/cells';
import {
  CELL_WINDOW_MARGIN,
  CELL_WINDOW_MAX_CELLS_PER_LAYER,
  CELL_WINDOW_MIN_ZOOM,
  cellWindowOf,
  pickWindowCells,
  sameCellWindow,
  type CellWindow,
} from './cellWindow';

/** A view covering the given cell rectangle, inset a hair so float round-off can't pull in a neighbouring cell. */
function viewOver(cxMin: number, cyMin: number, cxMax: number, cyMax: number, zoom = 10) {
  const inset = 1e-4;
  const [w, , , n] = cellBounds(cxMin, cyMin);
  const [, s, e] = cellBounds(cxMax, cyMax);
  const bounds: [number, number, number, number] = [w + inset, s + inset, e - inset, n - inset];
  return { bounds, center: [(w + e) / 2, (s + n) / 2] as [number, number], zoom };
}

const cell = (layer: string, cx: number, cy: number) => ({ layer, cx, cy });
const window = (over: Partial<CellWindow> = {}): CellWindow => ({ cxMin: 10, cxMax: 12, cyMin: 20, cyMax: 21, centerCx: 11, centerCy: 20, ...over });

describe('cellWindowOf', () => {
  it('is the cell rectangle the view covers, plus the center cell', () => {
    const win = cellWindowOf(viewOver(180, 370, 182, 372))!;
    expect(win).toMatchObject({ cxMin: 180, cxMax: 182, cyMin: 370, cyMax: 372, centerCx: 181, centerCy: 371 });
  });

  it('is null when zoomed out past the minimum', () => {
    expect(cellWindowOf(viewOver(180, 370, 182, 372, CELL_WINDOW_MIN_ZOOM - 0.1))).toBeNull();
    expect(cellWindowOf(viewOver(180, 370, 182, 372, CELL_WINDOW_MIN_ZOOM))).not.toBeNull();
  });
});

describe('sameCellWindow', () => {
  it('compares by value, treating null as its own value', () => {
    expect(sameCellWindow(window(), window())).toBe(true);
    expect(sameCellWindow(window(), window({ cxMax: 13 }))).toBe(false);
    expect(sameCellWindow(window(), window({ centerCy: 21 }))).toBe(false);
    expect(sameCellWindow(null, null)).toBe(true);
    expect(sameCellWindow(null, window())).toBe(false);
    expect(sameCellWindow(window(), null)).toBe(false);
  });
});

describe('pickWindowCells', () => {
  it('mounts nothing without a window (zoomed out or view not known yet)', () => {
    expect(pickWindowCells([cell('land', 11, 20)], null)).toEqual([]);
  });

  it('keeps cells in the view and one cell beyond it, drops the rest', () => {
    const inView = cell('land', 11, 20);
    const margin = cell('land', 10 - CELL_WINDOW_MARGIN, 20);
    const far = cell('land', 10 - CELL_WINDOW_MARGIN - 1, 20);
    const picked = pickWindowCells([far, margin, inView], window());
    expect(picked).toContain(inView);
    expect(picked).toContain(margin);
    expect(picked).not.toContain(far);
  });

  it('puts in-view cells before margin cells, nearest the center first', () => {
    const cells = [cell('land', 9, 20) /* margin */, cell('land', 12, 21), cell('land', 11, 20), cell('land', 10, 20)];
    expect(pickWindowCells(cells, window()).map((c) => `${c.cx},${c.cy}`)).toEqual(['11,20', '10,20', '12,21', '9,20']);
  });

  it('caps each layer separately, dropping the farthest margin cells first', () => {
    const wide = window({ cxMin: 0, cxMax: 100, cyMin: 0, cyMax: 100, centerCx: 50, centerCy: 50 });
    const grid = Array.from({ length: 50 }, (_, i) => cell('mvum', 40 + (i % 10), 45 + Math.floor(i / 10)));
    const land = [cell('land', 50, 50)];
    const picked = pickWindowCells([...grid, ...land], wide);
    expect(picked.filter((c) => c.layer === 'mvum')).toHaveLength(CELL_WINDOW_MAX_CELLS_PER_LAYER);
    expect(picked.filter((c) => c.layer === 'land')).toHaveLength(1); // a busy layer doesn't crowd out another
    // the ones kept are the nearest to the center (50, 50)
    const distance = (c: { cx: number; cy: number }) => (c.cx - 50) ** 2 + (c.cy - 50) ** 2;
    const kept = picked.filter((c) => c.layer === 'mvum');
    const dropped = grid.filter((c) => !kept.includes(c));
    expect(Math.max(...kept.map(distance))).toBeLessThanOrEqual(Math.min(...dropped.map(distance)));
  });

  it('is deterministic for the same input', () => {
    const cells = [cell('land', 11, 20), cell('land', 10, 20), cell('mvum', 12, 21)];
    expect(pickWindowCells(cells, window())).toEqual(pickWindowCells([...cells].reverse(), window()));
  });

  it('a whole state installed still mounts a bounded number of cells', () => {
    const state = Array.from({ length: 330 }, (_, i) => cell('land', 179 + (i % 18), 351 + Math.floor(i / 18)));
    const win = cellWindowOf(viewOver(184, 364, 185, 367))!; // a phone-sized view at z10
    const mounted = pickWindowCells(state, win);
    expect(mounted.length).toBeLessThanOrEqual(30);
    expect(mounted.length).toBeGreaterThan(0);
  });
});
