import type { CoverageRow } from '../data/types';
import { createStateIndex } from './stateCells';
import { cellsToDelete, groupStorageByState } from './stateStorage';

const states = [
  { code: 'AA', name: 'Aland', id: 'aland' },
  { code: 'BB', name: 'Bland', id: 'bland' },
];
// AA: 1..3, BB: 3..5 — the square 3 is on the line between them.
const index = createStateIndex(
  {
    AA: [
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    BB: [
      [3, 0],
      [4, 0],
      [5, 0],
    ],
  },
  states
);

const row = (layer: string, cx: number, bytes = 100, status: CoverageRow['status'] = 'complete'): CoverageRow => ({
  layer,
  cell_x: cx,
  cell_y: 0,
  max_zoom: 0,
  status,
  bytes,
  updated_at: 0,
});

describe('groupStorageByState', () => {
  it('is empty for nothing stored', () => {
    expect(groupStorageByState([], index)).toEqual({ states: [], elsewhere: null, totalBytes: 0 });
  });

  it('splits what is stored by state, each with its layers, squares and size', () => {
    const { states: grouped } = groupStorageByState(
      [row('land', 1, 300), row('land', 2, 200), row('mvum', 1, 50), row('land', 5, 70)],
      index
    );
    expect(grouped.map((s) => s.state?.name)).toEqual(['Aland', 'Bland']);
    const [aland, bland] = grouped;
    expect(aland.totalSquares).toBe(3);
    expect(aland.bytes).toBe(550);
    expect(aland.layers).toEqual([
      { layer: 'mvum', squares: 1, bytes: 50 }, // "Forest roads (MVUM)" sorts before "Public land + private shading"
      { layer: 'land', squares: 2, bytes: 500 },
    ]);
    expect(bland.layers).toEqual([{ layer: 'land', squares: 1, bytes: 70 }]);
  });

  it('shows a square on a state line under both states, but counts its bytes once in the total', () => {
    const { states: grouped, totalBytes } = groupStorageByState([row('land', 3, 400)], index);
    expect(grouped.map((s) => s.state?.name)).toEqual(['Aland', 'Bland']);
    expect(grouped.map((s) => s.layers[0].squares)).toEqual([1, 1]);
    expect(totalBytes).toBe(400);
  });

  it('puts squares in no state under "elsewhere"', () => {
    const { states: grouped, elsewhere } = groupStorageByState([row('land', 99, 10), row('land', 1, 5)], index);
    expect(grouped).toHaveLength(1);
    expect(elsewhere?.state).toBeNull();
    expect(elsewhere?.layers).toEqual([{ layer: 'land', squares: 1, bytes: 10 }]);
  });

  it('counts squares that are on the phone in part, and ignores failed or in-flight ones', () => {
    const { states: grouped } = groupStorageByState(
      [row('land', 1, 10, 'partial'), row('land', 2, 10, 'failed'), row('land', 3, 10, 'downloading')],
      index
    );
    expect(grouped[0].layers).toEqual([{ layer: 'land', squares: 1, bytes: 10 }]);
  });

  it('lists layers in the order people read them (by name)', () => {
    const { states: grouped } = groupStorageByState(
      [row('trails', 1), row('land', 1), row('osm', 1), row('topo', 1)],
      index
    );
    expect(grouped[0].layers.map((l) => l.layer)).toEqual(['land', 'osm', 'topo', 'trails']);
  });
});

describe('cellsToDelete', () => {
  it('removes every square of the state for the layer, and only that layer', () => {
    const coverage = [row('land', 1), row('land', 2), row('mvum', 1), row('land', 5)];
    const { remove, kept } = cellsToDelete('AA', 'land', coverage, index);
    expect(remove).toEqual([
      { cx: 1, cy: 0 },
      { cx: 2, cy: 0 },
    ]);
    expect(kept).toBe(0);
  });

  it('removes a line square too when the neighbour has nothing of its own', () => {
    const { remove, kept } = cellsToDelete('AA', 'land', [row('land', 1), row('land', 3)], index);
    expect(remove.map((c) => c.cx)).toEqual([1, 3]);
    expect(kept).toBe(0);
  });

  it('keeps a line square the neighbour still needs — it has land of its own', () => {
    const { remove, kept } = cellsToDelete('AA', 'land', [row('land', 1), row('land', 3), row('land', 5)], index);
    expect(remove.map((c) => c.cx)).toEqual([1]);
    expect(kept).toBe(1);
  });

  it('does not let a neighbour’s data in another layer protect the square', () => {
    const { remove } = cellsToDelete('AA', 'land', [row('land', 3), row('mvum', 5)], index);
    expect(remove.map((c) => c.cx)).toEqual([3]);
  });

  it('also clears failed and half-done rows of the state, so nothing stale is left behind', () => {
    const { remove } = cellsToDelete(
      'AA',
      'land',
      [row('land', 1, 0, 'failed'), row('land', 2, 0, 'downloading')],
      index
    );
    expect(remove.map((c) => c.cx)).toEqual([1, 2]);
  });

  it('removes squares in no state when asked for "elsewhere"', () => {
    const { remove } = cellsToDelete(null, 'land', [row('land', 99), row('land', 1)], index);
    expect(remove).toEqual([{ cx: 99, cy: 0 }]);
  });
});
