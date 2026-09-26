/**
 * Which z10 cells belong to which state — the bundled assets/us/us-state-cells.json (built by
 * tools/build_us_outline.mjs, the same list the region packs are built from). It lets Downloads treat a whole state
 * as one thing on the picker map, group what is on the phone by state, and tell "the whole of Idaho is picked" from
 * "some squares in Idaho are".
 *
 * A state is every cell its outline touches, so a cell on a state line belongs to both states.
 *
 * Pure (no native modules) so it is unit-testable; `US_STATE_CELLS` at the bottom is the one over the real data.
 */

import stateCellData from '../../assets/us/us-state-cells.json';
import { US_STATES, type UsState } from '../packs/usStates';
import type { Cell } from './blockSelect';
import { CELL_ZOOM, cellBounds } from './cells';

export type StateCellData = Record<string, [number, number][]>;

const keyOf = (cx: number, cy: number) => `${cx}:${cy}`;
const WORLD_CELLS = 1 << CELL_ZOOM;

export interface StateCellIndex {
  /** Every cell the state touches. */
  cellsOf(code: string): Cell[];
  /** The states a cell is in: none for the ocean or a foreign country, two or more on a state line. */
  statesOfCell(cx: number, cy: number): UsState[];
  /** `[west, south, east, north]` around the state, for flying the map to it. */
  boundsOf(code: string): [number, number, number, number] | null;
  /** The states every one of whose cells is in `selected`. */
  wholeStates(selected: readonly Cell[]): UsState[];
  /** `selected` plus the state's cells. */
  addState(selected: readonly Cell[], code: string): Cell[];
  /**
   * `selected` without the state's cells — except the ones on a line shared with another state that is still fully
   * selected, which that state still needs.
   */
  removeState(selected: readonly Cell[], code: string): Cell[];
}

export function createStateIndex(data: StateCellData, states: readonly UsState[] = US_STATES): StateCellIndex {
  const cells = new Map<string, Cell[]>();
  const cellKeys = new Map<string, Set<string>>();
  const byCell = new Map<string, UsState[]>();
  for (const state of states) {
    const list = (data[state.code] ?? []).map(([cx, cy]): Cell => ({ cx, cy }));
    cells.set(state.code, list);
    cellKeys.set(state.code, new Set(list.map(({ cx, cy }) => keyOf(cx, cy))));
    for (const { cx, cy } of list) {
      const key = keyOf(cx, cy);
      byCell.set(key, [...(byCell.get(key) ?? []), state]);
    }
  }

  const cellsOf = (code: string) => cells.get(code) ?? [];

  const wholeStates = (selected: readonly Cell[]): UsState[] => {
    if (selected.length === 0) return [];
    const have = new Set(selected.map(({ cx, cy }) => keyOf(cx, cy)));
    return states.filter((state) => {
      const list = cellsOf(state.code);
      return list.length > 0 && list.length <= have.size && list.every(({ cx, cy }) => have.has(keyOf(cx, cy)));
    });
  };

  return {
    cellsOf,
    statesOfCell: (cx, cy) => byCell.get(keyOf(cx, cy)) ?? [],

    boundsOf(code) {
      const list = cellsOf(code);
      if (list.length === 0) return null;
      // Alaska's western Aleutians sit across the antimeridian; a box around them would span the whole world.
      const west = list.filter(({ cx }) => cx < WORLD_CELLS / 2);
      let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const { cx, cy } of west.length > 0 ? west : list) {
        const [cw, cs, ce, cn] = cellBounds(cx, cy);
        w = Math.min(w, cw);
        s = Math.min(s, cs);
        e = Math.max(e, ce);
        n = Math.max(n, cn);
      }
      return [w, s, e, n];
    },

    wholeStates,

    addState(selected, code) {
      const have = new Set(selected.map(({ cx, cy }) => keyOf(cx, cy)));
      return [...selected, ...cellsOf(code).filter(({ cx, cy }) => !have.has(keyOf(cx, cy)))];
    },

    removeState(selected, code) {
      const leaving = cellKeys.get(code);
      if (!leaving) return [...selected];
      const kept = new Set<string>();
      for (const other of wholeStates(selected)) {
        if (other.code !== code) for (const { cx, cy } of cellsOf(other.code)) kept.add(keyOf(cx, cy));
      }
      return selected.filter(({ cx, cy }) => {
        const key = keyOf(cx, cy);
        return !leaving.has(key) || kept.has(key);
      });
    },
  };
}

export const US_STATE_CELLS = createStateIndex(stateCellData as unknown as StateCellData);

/**
 * The camera that fits a `[west, south, east, north]` box in a map of `size` dp, with `margin` dp to spare all round.
 * MapLibre draws the world 512 dp wide at zoom 0 and doubles that each zoom level; latitude is Web Mercator.
 */
export function viewFitting(
  [west, south, east, north]: [number, number, number, number],
  size: { width: number; height: number },
  margin = 24
): { center: [number, number]; zoom: number } {
  const mercatorY = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  };
  const yNorth = mercatorY(north);
  const ySouth = mercatorY(south);
  const zoomFor = (available: number, worldFraction: number) =>
    worldFraction > 0 ? Math.log2(Math.max(1, available) / (512 * worldFraction)) : Infinity;
  const zoom = Math.min(
    zoomFor(size.width - 2 * margin, (east - west) / 360),
    zoomFor(size.height - 2 * margin, ySouth - yNorth)
  );
  const yMid = (yNorth + ySouth) / 2;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yMid))) * 180) / Math.PI;
  return { center: [(west + east) / 2, lat], zoom: Number.isFinite(zoom) ? Math.max(0, Math.min(14, zoom)) : 8 };
}
