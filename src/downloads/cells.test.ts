import { CELL_ZOOM, cellBounds, cellsInBounds, childTiles, lonLatToCell, tileToCell, tmsY } from './cells';

describe('cell grid math', () => {
  it('childTiles at the cell zoom is the cell itself', () => {
    expect(childTiles(179, 372, CELL_ZOOM)).toEqual([{ z: 10, x: 179, y: 372 }]);
  });

  it('childTiles quadruples per zoom level', () => {
    expect(childTiles(5, 7, 11)).toHaveLength(4);
    expect(childTiles(5, 7, 14)).toHaveLength(4 ** 4);
  });

  it('childTiles rejects zooms below the cell zoom', () => {
    expect(() => childTiles(0, 0, 9)).toThrow();
  });

  it('every child tile maps back to its parent cell', () => {
    for (const tile of childTiles(180, 373, 13)) {
      expect(tileToCell(tile)).toEqual({ cx: 180, cy: 373 });
    }
  });

  it('tmsY flips rows', () => {
    expect(tmsY(0, 0)).toBe(0);
    expect(tmsY(3, 0)).toBe(7);
    expect(tmsY(3, 7)).toBe(0);
  });

  it('lonLatToCell and cellBounds are inverse', () => {
    const { cx, cy } = lonLatToCell(-116.2, 43.6);
    const [west, south, east, north] = cellBounds(cx, cy);
    expect(-116.2).toBeGreaterThanOrEqual(west);
    expect(-116.2).toBeLessThan(east);
    expect(43.6).toBeGreaterThanOrEqual(south);
    expect(43.6).toBeLessThan(north);
  });

  it('adjacent cells share an exact edge (no float gap)', () => {
    expect(cellBounds(180, 373)[2]).toBe(cellBounds(181, 373)[0]);
    expect(cellBounds(180, 373)[1]).toBe(cellBounds(180, 374)[3]);
  });
});

describe('cellsInBounds', () => {
  it('a view inside one cell is that cell', () => {
    const [w, s, e, n] = cellBounds(181, 373);
    const cells = cellsInBounds([w + 0.01, s + 0.01, e - 0.01, n - 0.01]);
    expect(cells).toEqual([{ cx: 181, cy: 373 }]);
  });

  it('a view straddling cell borders returns every cell it touches, row by row', () => {
    const a = cellBounds(181, 373);
    const b = cellBounds(182, 372);
    // From the middle of cell (181,373) to the middle of cell (182,372): a 2x2 block.
    const cells = cellsInBounds([(a[0] + a[2]) / 2, (a[1] + a[3]) / 2, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    expect(cells).toEqual([
      { cx: 181, cy: 372 },
      { cx: 182, cy: 372 },
      { cx: 181, cy: 373 },
      { cx: 182, cy: 373 },
    ]);
  });

  it('an east/south edge exactly on a cell border does not pull in the next cell', () => {
    const [w, s, e, n] = cellBounds(181, 373);
    expect(cellsInBounds([w, s, e, n])).toEqual([{ cx: 181, cy: 373 }]);
  });

  it('every returned cell contains part of the view (round trip through cellBounds)', () => {
    const view: [number, number, number, number] = [-116.9, 43.2, -115.7, 44.0];
    for (const { cx, cy } of cellsInBounds(view)) {
      const [w, s, e, n] = cellBounds(cx, cy);
      expect(w).toBeLessThan(view[2]);
      expect(e).toBeGreaterThan(view[0]);
      expect(s).toBeLessThan(view[3]);
      expect(n).toBeGreaterThan(view[1]);
    }
  });

  it('clamps to the Web Mercator grid instead of returning negative or NaN cells near the poles', () => {
    const cells = cellsInBounds([-1, 80, 1, 90]);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => Number.isInteger(c.cx) && Number.isInteger(c.cy) && c.cy >= 0 && c.cx >= 0)).toBe(true);
  });
});
