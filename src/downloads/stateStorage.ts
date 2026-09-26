/**
 * What is stored on the phone, grouped by state — the "On this phone" view. The coverage table knows squares, not
 * states; the bundled state data (stateCells.ts) says which states a square is in.
 *
 * A square on a state line is in both states, so each shows it (their sizes can add up to more than the total). The
 * one place that must not double count is the total, which is summed over the rows themselves.
 *
 * Pure (no native modules) so it is unit-testable.
 */

import type { CoverageRow } from '../data/types';
import type { UsState } from '../packs/usStates';
import type { Cell } from './blockSelect';
import { LAYER_LABELS } from './downloadOptions';
import { US_STATE_CELLS, type StateCellIndex } from './stateCells';

export interface LayerStorage {
  layer: string;
  /** Squares of this state that have this layer on the phone (whole or part). */
  squares: number;
  bytes: number;
}

export interface StateStorage {
  /** `null` for squares that belong to no state (data loaded before the app was US-only, say). */
  state: UsState | null;
  /** How many squares the state has in all, for "12 of 329". */
  totalSquares: number;
  bytes: number;
  layers: LayerStorage[];
}

export interface StorageByState {
  /** Alphabetical by state name; only states with something on the phone. */
  states: StateStorage[];
  /** Squares in no state, or null when there are none. */
  elsewhere: StateStorage | null;
  /** Everything stored, each square counted once. */
  totalBytes: number;
}

const onPhone = (row: CoverageRow) => row.status === 'complete' || row.status === 'partial';
const keyOf = (cx: number, cy: number) => `${cx}:${cy}`;
const byLabel = (a: LayerStorage, b: LayerStorage) =>
  (LAYER_LABELS[a.layer] ?? a.layer).localeCompare(LAYER_LABELS[b.layer] ?? b.layer);

export function groupStorageByState(
  coverage: readonly CoverageRow[],
  index: StateCellIndex = US_STATE_CELLS
): StorageByState {
  const byState = new Map<string, { state: UsState; layers: Map<string, LayerStorage> }>();
  const elsewhere = new Map<string, LayerStorage>();
  let totalBytes = 0;

  const add = (layers: Map<string, LayerStorage>, row: CoverageRow) => {
    const entry = layers.get(row.layer) ?? { layer: row.layer, squares: 0, bytes: 0 };
    entry.squares += 1;
    entry.bytes += row.bytes ?? 0;
    layers.set(row.layer, entry);
  };

  for (const row of coverage) {
    if (!onPhone(row)) continue;
    totalBytes += row.bytes ?? 0;
    const states = index.statesOfCell(row.cell_x, row.cell_y);
    if (states.length === 0) add(elsewhere, row);
    for (const state of states) {
      const group = byState.get(state.code) ?? { state, layers: new Map() };
      add(group.layers, row);
      byState.set(state.code, group);
    }
  }

  const summarize = (state: UsState | null, layers: Map<string, LayerStorage>): StateStorage => {
    const list = [...layers.values()].sort(byLabel);
    return {
      state,
      totalSquares: state ? index.cellsOf(state.code).length : 0,
      bytes: list.reduce((sum, layer) => sum + layer.bytes, 0),
      layers: list,
    };
  };

  return {
    states: [...byState.values()]
      .sort((a, b) => a.state.name.localeCompare(b.state.name))
      .map(({ state, layers }) => summarize(state, layers)),
    elsewhere: elsewhere.size > 0 ? summarize(null, elsewhere) : null,
    totalBytes,
  };
}

export interface StateDeletion {
  /** The squares whose file and coverage row to delete. */
  remove: Cell[];
  /** Squares left in place because another state still needs them. */
  kept: number;
}

/**
 * Which squares "Delete <layer> for <state>" removes. A square on the line with another state is kept when that
 * state has data of its own for the layer — deleting Idaho must not punch a hole in a Washington you still have. A
 * neighbour that only has the line squares (they came from the pack being deleted) doesn't count. Squares in no
 * state (`code` null) all go.
 */
export function cellsToDelete(
  code: string | null,
  layer: string,
  coverage: readonly CoverageRow[],
  index: StateCellIndex = US_STATE_CELLS
): StateDeletion {
  const rows = coverage.filter((row) => row.layer === layer);
  const mine =
    code === null
      ? rows.filter((row) => index.statesOfCell(row.cell_x, row.cell_y).length === 0)
      : rows.filter((row) => index.statesOfCell(row.cell_x, row.cell_y).some((state) => state.code === code));

  // Other states with a square of their own (one that isn't in this state) on the phone.
  const needy = new Set<string>();
  if (code !== null) {
    for (const row of rows) {
      if (!onPhone(row)) continue;
      const states = index.statesOfCell(row.cell_x, row.cell_y);
      if (states.some((state) => state.code === code)) continue;
      for (const state of states) needy.add(state.code);
    }
  }

  const remove: Cell[] = [];
  let kept = 0;
  const seen = new Set<string>();
  for (const row of mine) {
    const key = keyOf(row.cell_x, row.cell_y);
    if (seen.has(key)) continue;
    seen.add(key);
    const shared =
      code !== null && index.statesOfCell(row.cell_x, row.cell_y).some((s) => s.code !== code && needy.has(s.code));
    if (shared) kept++;
    else remove.push({ cx: row.cell_x, cy: row.cell_y });
  }
  return { remove, kept };
}
