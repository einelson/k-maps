import { useCallback, useState } from 'react';
import type { ViewState } from '@maplibre/maplibre-react-native';

import { cellWindowOf, sameCellWindow, type CellWindow } from './cellWindow';
import { sameViewBox, viewBoxOf, type ViewBox } from './huntUnitWindow';

/**
 * Tracks what the map is looking at, in two coarse forms: which overlay cells (cellWindow.ts) and which area
 * (huntUnitWindow.ts, for the hunting-unit states). State only changes when the view moves onto different cells /
 * half-degree steps, so panning within one doesn't re-render the map's layers.
 */
export function useCellWindow(): {
  cellWindow: CellWindow | null;
  viewBox: ViewBox | null;
  updateCellWindow: (view: ViewState) => void;
} {
  const [cellWindow, setCellWindow] = useState<CellWindow | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox | null>(null);
  const updateCellWindow = useCallback((view: ViewState) => {
    const nextWindow = cellWindowOf(view);
    setCellWindow((prev) => (sameCellWindow(prev, nextWindow) ? prev : nextWindow));
    const nextBox = viewBoxOf(view);
    setViewBox((prev) => (sameViewBox(prev, nextBox) ? prev : nextBox));
  }, []);
  return { cellWindow, viewBox, updateCellWindow };
}
