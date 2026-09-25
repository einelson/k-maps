/**
 * Which downloaded overlay cells the map actually mounts. Every mounted cell is a MapLibre source plus
 * several style layers, and a region pack can install hundreds of cells — mounting them all would put
 * thousands of layers on the map. So only cells in (or one cell beyond) the current view are mounted,
 * and only once you're zoomed in far enough for the data to be legible.
 *
 * Pure so it is unit-testable; the map wiring is in MapView.tsx.
 */

import { cellsInBounds, lonLatToCell } from '../downloads/cells';

/** Below this zoom no downloaded cells are drawn (a phone view spans dozens of cells there). Bundled starter data always is. */
export const CELL_WINDOW_MIN_ZOOM = 9;
/** Cells mounted beyond the view's edge, so panning a little doesn't show a gap while the next cells mount. */
export const CELL_WINDOW_MARGIN = 1;
/** Per overlay layer; visible cells are kept first, then the margin. A tall tablet view at the minimum zoom just fits. */
export const CELL_WINDOW_MAX_CELLS_PER_LAYER = 30;

/** Cell-grid rectangle of the view (margin not included) and the cell at its center. */
export interface CellWindow {
  cxMin: number;
  cxMax: number;
  cyMin: number;
  cyMax: number;
  centerCx: number;
  centerCy: number;
}

export interface MapView {
  /** `[west, south, east, north]` */
  bounds: [number, number, number, number];
  /** `[lon, lat]` */
  center: [number, number];
  zoom: number;
}

/** The window for a camera view, or null when zoomed too far out to draw downloaded cells. */
export function cellWindowOf(view: MapView): CellWindow | null {
  if (view.zoom < CELL_WINDOW_MIN_ZOOM) return null;
  const cells = cellsInBounds(view.bounds);
  if (cells.length === 0) return null;
  const { cx: centerCx, cy: centerCy } = lonLatToCell(view.center[0], view.center[1]);
  return {
    cxMin: Math.min(...cells.map((c) => c.cx)),
    cxMax: Math.max(...cells.map((c) => c.cx)),
    cyMin: Math.min(...cells.map((c) => c.cy)),
    cyMax: Math.max(...cells.map((c) => c.cy)),
    centerCx,
    centerCy,
  };
}

/** Lets callers keep the same state object (and skip a re-render) while the view stays on the same cells. */
export function sameCellWindow(a: CellWindow | null, b: CellWindow | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.cxMin === b.cxMin &&
    a.cxMax === b.cxMax &&
    a.cyMin === b.cyMin &&
    a.cyMax === b.cyMax &&
    a.centerCx === b.centerCx &&
    a.centerCy === b.centerCy
  );
}

interface CellRef {
  layer: string;
  cx: number;
  cy: number;
}

/**
 * The cells to mount: per layer, those in the window plus the margin — cells in the view first, nearest
 * the center first — capped at CELL_WINDOW_MAX_CELLS_PER_LAYER. Order within a layer is stable for a given
 * window, and other layers are unaffected by a busy one.
 */
export function pickWindowCells<T extends CellRef>(cells: readonly T[], window: CellWindow | null): T[] {
  if (window === null) return [];
  const { cxMin, cxMax, cyMin, cyMax, centerCx, centerCy } = window;
  const m = CELL_WINDOW_MARGIN;

  const ranked = cells
    .filter((c) => c.cx >= cxMin - m && c.cx <= cxMax + m && c.cy >= cyMin - m && c.cy <= cyMax + m)
    .map((cell) => ({
      cell,
      inView: cell.cx >= cxMin && cell.cx <= cxMax && cell.cy >= cyMin && cell.cy <= cyMax,
      distance: (cell.cx - centerCx) ** 2 + (cell.cy - centerCy) ** 2,
    }))
    .sort((a, b) => Number(b.inView) - Number(a.inView) || a.distance - b.distance || a.cell.cx - b.cell.cx || a.cell.cy - b.cell.cy);

  const perLayer = new Map<string, number>();
  const picked: T[] = [];
  for (const { cell } of ranked) {
    const count = perLayer.get(cell.layer) ?? 0;
    if (count >= CELL_WINDOW_MAX_CELLS_PER_LAYER) continue;
    perLayer.set(cell.layer, count + 1);
    picked.push(cell);
  }
  return picked;
}
