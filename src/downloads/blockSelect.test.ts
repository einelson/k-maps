import {
  blockBounds,
  blockGridLines,
  blockOf,
  blockPickState,
  blockRangeInBounds,
  blockSizeForZoom,
  cellAreaKm2,
  cellCenter,
  cellsInBlock,
  MAX_SELECTED_CELLS,
  selectCellsInView,
  selectionAreaKm2,
  TARGET_BLOCK_DP,
  toggleBlock,
  type Cell,
} from './blockSelect';
import { cellBounds, lonLatToCell } from './cells';

const cell = (cx: number, cy: number): Cell => ({ cx, cy });
const keys = (cells: readonly Cell[]) => cells.map((c) => `${c.cx}:${c.cy}`).sort();

describe('blockSizeForZoom', () => {
  it('is one cell from about zoom 7 in — where a square is already a comfortable target', () => {
    for (const zoom of [18, 12, 10, 9.5, 9, 8, 7.2]) expect(blockSizeForZoom(zoom)).toBe(1);
  });

  it('doubles each zoom level out, so zooming out selects more at once', () => {
    expect(blockSizeForZoom(6.6)).toBe(2);
    expect(blockSizeForZoom(5.6)).toBe(4);
    expect(blockSizeForZoom(4.6)).toBe(8);
    expect(blockSizeForZoom(3.6)).toBe(16);
  });

  it('stops at 16 x 16 cells however far out the map is', () => {
    expect(blockSizeForZoom(2)).toBe(16);
    expect(blockSizeForZoom(0)).toBe(16);
    expect(blockSizeForZoom(-2)).toBe(16);
  });

  it('never gets smaller as the view zooms out', () => {
    let previous = 0;
    for (let zoom = 14; zoom >= 2; zoom -= 0.25) {
      const size = blockSizeForZoom(zoom);
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
  });

  it('keeps a block a finger-friendly size on screen (68-136 dp) at every zoom from 7.5 out to 3.6', () => {
    // At MapLibre zoom z one cell is 512 * 2^(z - 10) dp wide.
    for (let zoom = 7.5; zoom >= 3.6; zoom -= 0.05) {
      const dp = blockSizeForZoom(zoom) * 512 * 2 ** (zoom - 10);
      expect(dp).toBeGreaterThanOrEqual(TARGET_BLOCK_DP / Math.SQRT2 - 1);
      expect(dp).toBeLessThanOrEqual(TARGET_BLOCK_DP * Math.SQRT2 + 1);
    }
  });

  it('picks single squares far sooner than when a square filled the phone (zoom 9.5)', () => {
    expect(blockSizeForZoom(8)).toBe(1);
    expect(blockSizeForZoom(7.5)).toBe(1);
  });

  it('falls back to a single cell for a zoom that is not a number', () => {
    expect(blockSizeForZoom(Number.NaN)).toBe(1);
  });
});

describe('blocks', () => {
  it('a block is aligned to the grid, so the same tap always lands in the same block', () => {
    expect(blockOf(cell(181, 373), 4)).toEqual({ bx: 45, by: 93 });
    expect(blockOf(cell(180, 372), 4)).toEqual({ bx: 45, by: 93 });
    expect(blockOf(cell(183, 375), 4)).toEqual({ bx: 45, by: 93 });
    expect(blockOf(cell(184, 375), 4)).toEqual({ bx: 46, by: 93 });
  });

  it('lists every cell of a block, and only those', () => {
    const cells = cellsInBlock(45, 93, 4);
    expect(cells).toHaveLength(16);
    expect(keys(cells)[0]).toBe('180:372');
    expect(keys(cells)).toContain('183:375');
    expect(keys(cells)).not.toContain('184:372');
  });

  it('a one-cell block is the cell itself', () => {
    expect(cellsInBlock(181, 373, 1)).toEqual([cell(181, 373)]);
  });

  it('stays inside the world at its edge', () => {
    const last = 1024 / 16 - 1;
    expect(cellsInBlock(last, last, 16)).toHaveLength(256);
    expect(Math.max(...cellsInBlock(last, last, 16).map((c) => c.cx))).toBe(1023);
  });

  it("block bounds are the union of the block's cells", () => {
    const [w, s, e, n] = blockBounds(45, 93, 4);
    expect(w).toBe(cellBounds(180, 372)[0]);
    expect(n).toBe(cellBounds(180, 372)[3]);
    expect(e).toBe(cellBounds(183, 375)[2]);
    expect(s).toBe(cellBounds(183, 375)[1]);
  });

  it('neighbouring blocks share an edge exactly, so the grid has no gaps', () => {
    expect(blockBounds(45, 93, 4)[2]).toBe(blockBounds(46, 93, 4)[0]);
    expect(blockBounds(45, 93, 4)[1]).toBe(blockBounds(45, 94, 4)[3]);
  });

  it('works out the range for the whole world without listing its cells', () => {
    const started = Date.now();
    const range = blockRangeInBounds([-180, -85, 180, 85], 16);
    expect(range).toEqual({ bxMin: 0, bxMax: 63, byMin: 0, byMax: 63 });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('keeps the margin inside the world at its edges', () => {
    expect(blockRangeInBounds([-179.9, 84, -179.5, 85], 4)).toMatchObject({ bxMin: 0, byMin: 0 });
    expect(blockRangeInBounds([179.5, -85, 179.9, -84], 4)).toMatchObject({ bxMax: 255, byMax: 255 });
  });

  it('the range for a view covers the blocks it touches plus one block of margin', () => {
    const boise: [number, number, number, number] = [-116.3, 43.5, -116.1, 43.7];
    const here = lonLatToCell(-116.2, 43.6);
    const { bx, by } = blockOf(here, 4);
    const range = blockRangeInBounds(boise, 4);
    expect(range.bxMin).toBeLessThanOrEqual(bx - 1);
    expect(range.bxMax).toBeGreaterThanOrEqual(bx + 1);
    expect(range.byMin).toBeLessThanOrEqual(by - 1);
    expect(range.byMax).toBeGreaterThanOrEqual(by + 1);
  });
});

describe('toggleBlock', () => {
  it('selects the whole block under the tap', () => {
    const result = toggleBlock([], cell(181, 373), 4);
    expect(result.kind).toBe('changed');
    expect(result.cells).toHaveLength(16);
    expect(result.kind === 'changed' && result.added).toBe(16);
  });

  it('tapping the same block again deselects it', () => {
    const first = toggleBlock([], cell(181, 373), 4);
    const second = toggleBlock(first.cells, cell(183, 375), 4); // a different cell of the same block
    expect(second.kind === 'changed' && second.removed).toBe(16);
    expect(second.cells).toEqual([]);
  });

  it('completes a partly selected block instead of clearing it', () => {
    const result = toggleBlock([cell(180, 372)], cell(181, 373), 4);
    expect(result.cells).toHaveLength(16);
    expect(result.kind === 'changed' && result.added).toBe(15);
  });

  it('leaves the rest of the selection alone when removing a block', () => {
    const other = cell(10, 10);
    const selected = [other, ...cellsInBlock(45, 93, 4)];
    const result = toggleBlock(selected, cell(181, 373), 4);
    expect(result.cells).toEqual([other]);
  });

  it('with blocks of one it is the old tap-a-cell behaviour', () => {
    const on = toggleBlock([], cell(5, 6), 1);
    expect(on.cells).toEqual([cell(5, 6)]);
    expect(toggleBlock(on.cells, cell(5, 6), 1).cells).toEqual([]);
  });

  it('refuses a block that would go past the cap and leaves the selection as it was', () => {
    const selected = Array.from({ length: 10 }, (_, i) => cell(i, 0));
    const result = toggleBlock(selected, cell(500, 500), 4, 20);
    expect(result.kind).toBe('too-many');
    expect(result.cells).toEqual(selected);
    expect(result.kind === 'too-many' && result.wouldBe).toBe(26);
  });

  it('does not count cells that are already selected against the cap', () => {
    const selected = cellsInBlock(45, 93, 4).slice(0, 15); // 15 of 16
    expect(toggleBlock(selected, cell(181, 373), 4, 16).kind).toBe('changed');
  });

  it('the default cap fits a big state (Idaho is 329 cells) but not two of the largest blocks', () => {
    expect(MAX_SELECTED_CELLS).toBeGreaterThanOrEqual(400);
    const one = toggleBlock([], cell(0, 0), 16); // 256 cells
    expect(one.kind).toBe('changed');
    expect(toggleBlock(one.cells, cell(16, 0), 16).kind).toBe('too-many'); // 512 > 500
  });
});

describe('selectCellsInView', () => {
  const view: [number, number, number, number] = [-116.4, 43.5, -115.9, 43.8];

  it('selects every cell the view touches', () => {
    const result = selectCellsInView([], view);
    expect(result.kind).toBe('changed');
    expect(keys(result.cells)).toContain(`${lonLatToCell(-116.2, 43.6).cx}:${lonLatToCell(-116.2, 43.6).cy}`);
    expect(result.cells.length).toBeGreaterThan(0);
  });

  it('adds to what is already selected without duplicating', () => {
    const once = selectCellsInView([], view);
    const twice = selectCellsInView(once.cells, view);
    expect(twice.cells).toHaveLength(once.cells.length);
    expect(twice.kind === 'changed' && twice.added).toBe(0);
  });

  it('refuses the whole world instantly instead of listing its million cells', () => {
    const started = Date.now();
    const result = selectCellsInView([], [-180, -85, 180, 85]);
    expect(result.kind).toBe('too-many');
    expect(result.kind === 'too-many' && result.wouldBe).toBeGreaterThan(1_000_000);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('refuses a view so big it would go past the cap', () => {
    const wholeUs: [number, number, number, number] = [-125, 24, -66, 50];
    const result = selectCellsInView([], wholeUs, 500);
    expect(result.kind).toBe('too-many');
    expect(result.cells).toEqual([]);
  });
});

describe('selection size', () => {
  it('a cell in Idaho is about 30 km across, roughly 700-900 km²', () => {
    const area = cellAreaKm2(lonLatToCell(-116.2, 43.6));
    expect(area).toBeGreaterThan(700);
    expect(area).toBeLessThan(950);
  });

  it('cells shrink toward the north', () => {
    expect(cellAreaKm2(lonLatToCell(-100, 30))).toBeGreaterThan(cellAreaKm2(lonLatToCell(-100, 48)));
  });

  it('adds up', () => {
    const a = lonLatToCell(-116.2, 43.6);
    expect(selectionAreaKm2([a, a])).toBeCloseTo(2 * cellAreaKm2(a));
    expect(selectionAreaKm2([])).toBe(0);
  });

  it('finds the centre of a cell', () => {
    const c = lonLatToCell(-116.2, 43.6);
    const [lon, lat] = cellCenter(c);
    expect(lonLatToCell(lon, lat)).toEqual(c);
  });
});

describe('blockGridLines', () => {
  const range = { bxMin: 44, bxMax: 46, byMin: 92, byMax: 93 };

  it('draws one line per block edge — a 3 x 2 range has 4 meridians and 3 parallels', () => {
    const { features } = blockGridLines(range, 4);
    expect(features).toHaveLength(4 + 3);
  });

  it('runs meridians and parallels through the block edges, so the grid matches where taps land', () => {
    const [firstMeridian] = blockGridLines(range, 4).features;
    const [w, , , n] = blockBounds(44, 92, 4);
    expect(firstMeridian.geometry.coordinates[0]).toEqual([w, n]);
    // The last parallel is the range's south edge.
    const parallels = blockGridLines(range, 4).features.slice(4);
    const southEdge = blockBounds(46, 93, 4)[1];
    expect(parallels[parallels.length - 1].geometry.coordinates[0][1]).toBe(southEdge);
  });

  it('draws nothing for an empty range', () => {
    expect(blockGridLines({ bxMin: 0, bxMax: -1, byMin: 0, byMax: -1 }, 4).features).toEqual([]);
  });
});

describe('picking only cells that pass a filter (the US)', () => {
  // Land is the west half of the block that holds 181,373 at size 4 (cells 180-183): only cx 180 and 181 count.
  const land = (c: Cell) => c.cx <= 181;

  it('picks just the eligible cells of a block', () => {
    const result = toggleBlock([], cell(181, 373), 4, MAX_SELECTED_CELLS, land);
    expect(result.kind).toBe('changed');
    expect(result.cells).toHaveLength(8); // cx 180-181 by cy 372-375
    expect(result.cells.every(land)).toBe(true);
  });

  it('a second tap removes them again, even though the block has cells that could never be picked', () => {
    const first = toggleBlock([], cell(181, 373), 4, MAX_SELECTED_CELLS, land);
    const second = toggleBlock(first.cells, cell(181, 373), 4, MAX_SELECTED_CELLS, land);
    expect(second.cells).toEqual([]);
    expect(second.kind === 'changed' && second.removed).toBe(8);
  });

  it('a block with nothing eligible changes nothing and says why', () => {
    const selected = [cell(1, 1)];
    const result = toggleBlock(selected, cell(200, 373), 4, MAX_SELECTED_CELLS, land);
    expect(result).toEqual({ kind: 'no-land', cells: selected });
  });

  it('counts only eligible cells against the cap', () => {
    const result = toggleBlock([], cell(181, 373), 4, 8, land);
    expect(result.kind).toBe('changed');
    expect(toggleBlock([], cell(181, 373), 4, 7, land).kind).toBe('too-many');
  });

  it('view selection keeps only eligible cells, and says so when there are none', () => {
    const view: [number, number, number, number] = [-116.4, 43.5, -115.9, 43.8];
    const all = selectCellsInView([], view);
    const filtered = selectCellsInView([], view, MAX_SELECTED_CELLS, (c) => c.cx === lonLatToCell(-116.2, 43.6).cx);
    expect(filtered.cells.length).toBeLessThan(all.cells.length);
    expect(filtered.cells.length).toBeGreaterThan(0);
    expect(selectCellsInView([], view, MAX_SELECTED_CELLS, () => false).kind).toBe('no-land');
  });

  it('filtering lets a view with many cells over the cap in that a plain view would be refused', () => {
    const wide: [number, number, number, number] = [-125, 30, -105, 45]; // ~1,700 cells
    expect(selectCellsInView([], wide).kind).toBe('too-many');
    expect(selectCellsInView([], wide, MAX_SELECTED_CELLS, (c) => c.cx === 190 && c.cy < 380).kind).toBe('changed');
  });

  it('still refuses a view too big to list at all, filter or not', () => {
    expect(selectCellsInView([], [-180, -85, 180, 85], MAX_SELECTED_CELLS, () => true).kind).toBe('too-many');
  });
});

describe('blockPickState', () => {
  it('counts how much of the block under a tap is already picked', () => {
    const block = cellsInBlock(45, 93, 4);
    expect(blockPickState([], cell(181, 373), 4)).toEqual({ total: 16, picked: 0 });
    expect(blockPickState(block.slice(0, 5), cell(181, 373), 4)).toEqual({ total: 16, picked: 5 });
    expect(blockPickState(block, cell(183, 375), 4)).toEqual({ total: 16, picked: 16 });
  });

  it('ignores squares outside the block and squares the filter rejects', () => {
    const inBlock = cellsInBlock(45, 93, 4);
    const eligible = (c: Cell) => c.cx < 182;
    expect(blockPickState([...inBlock, cell(50, 50)], cell(181, 373), 4, eligible)).toEqual({ total: 8, picked: 8 });
  });

  it('has nothing to pick where nothing is eligible', () => {
    expect(blockPickState([], cell(181, 373), 4, () => false)).toEqual({ total: 0, picked: 0 });
  });
});
