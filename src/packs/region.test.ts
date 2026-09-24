import { cellBounds, lonLatToCell } from '../downloads/cells.ts';
import {
  BUNDLED_CELL_RECT,
  bundledBounds,
  cellRectCovering,
  isCellBundled,
  STARTER_BBOX_WSEN,
} from './region.ts';
import { PACK_LAYER_IDS } from './types.ts';

describe('bundled region', () => {
  it('BUNDLED_CELL_RECT is the smallest cell rect covering the starter bbox', () => {
    expect(cellRectCovering(STARTER_BBOX_WSEN)).toEqual(BUNDLED_CELL_RECT);
    const [w, s, e, n] = STARTER_BBOX_WSEN;
    const corners = [lonLatToCell(w, n), lonLatToCell(e, s), lonLatToCell(w, s), lonLatToCell(e, n)];
    for (const { cx, cy } of corners) {
      expect(cx).toBeGreaterThanOrEqual(BUNDLED_CELL_RECT.cxMin);
      expect(cx).toBeLessThanOrEqual(BUNDLED_CELL_RECT.cxMax);
      expect(cy).toBeGreaterThanOrEqual(BUNDLED_CELL_RECT.cyMin);
      expect(cy).toBeLessThanOrEqual(BUNDLED_CELL_RECT.cyMax);
    }
    // Minimal: the rect's outermost cells each touch the bbox.
    expect(lonLatToCell(w, n)).toEqual({ cx: BUNDLED_CELL_RECT.cxMin, cy: BUNDLED_CELL_RECT.cyMin });
    expect(lonLatToCell(e, s)).toEqual({ cx: BUNDLED_CELL_RECT.cxMax, cy: BUNDLED_CELL_RECT.cyMax });
  });

  it('a bbox edge exactly on a cell border does not pull in the neighbouring cell', () => {
    const [w, s, e, n] = cellBounds(181, 373);
    expect(cellRectCovering([w, s, e, n])).toEqual({ cxMin: 181, cxMax: 181, cyMin: 373, cyMax: 373 });
  });

  it('bundledBounds is the union of the rect cells and contains the starter bbox', () => {
    const [w, s, e, n] = bundledBounds();
    expect(w).toBe(cellBounds(BUNDLED_CELL_RECT.cxMin, BUNDLED_CELL_RECT.cyMin)[0]);
    expect(e).toBe(cellBounds(BUNDLED_CELL_RECT.cxMax, BUNDLED_CELL_RECT.cyMax)[2]);
    expect(n).toBe(cellBounds(BUNDLED_CELL_RECT.cxMin, BUNDLED_CELL_RECT.cyMin)[3]);
    expect(s).toBe(cellBounds(BUNDLED_CELL_RECT.cxMax, BUNDLED_CELL_RECT.cyMax)[1]);
    const [sw, ss, se, sn] = STARTER_BBOX_WSEN;
    expect(w).toBeLessThanOrEqual(sw);
    expect(s).toBeLessThanOrEqual(ss);
    expect(e).toBeGreaterThanOrEqual(se);
    expect(n).toBeGreaterThanOrEqual(sn);
  });

  it('isCellBundled: land/mvum/poi inside the rect only; osm and trails never', () => {
    const { cxMin, cxMax, cyMin, cyMax } = BUNDLED_CELL_RECT;
    for (const layer of PACK_LAYER_IDS) {
      const expected = layer !== 'osm' && layer !== 'trails';
      expect(isCellBundled(layer, cxMin, cyMin)).toBe(expected);
      expect(isCellBundled(layer, cxMax, cyMax)).toBe(expected);
      expect(isCellBundled(layer, cxMin - 1, cyMin)).toBe(false);
      expect(isCellBundled(layer, cxMax + 1, cyMax)).toBe(false);
      expect(isCellBundled(layer, cxMin, cyMin - 1)).toBe(false);
      expect(isCellBundled(layer, cxMax, cyMax + 1)).toBe(false);
    }
  });
});
