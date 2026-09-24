import type { QueuedCell } from './useDownloadStore';
import { useDownloadStore } from './useDownloadStore';

const store = useDownloadStore;

beforeEach(() => {
  store.setState(store.getInitialState(), true);
});

const cell = (overrides: Partial<QueuedCell> = {}): QueuedCell => ({
  layer: 'topo',
  cx: 1,
  cy: 2,
  maxZoom: 16,
  progress: 0,
  ...overrides,
});

describe('useDownloadStore: defaults', () => {
  it('starts with nothing selected or queued, topo selected, and max zoom 16', () => {
    const s = store.getState();
    expect(s.selectedCells).toEqual([]);
    expect(s.queue).toEqual([]);
    expect(s.selectedLayers).toEqual(['topo']);
    expect(s.maxZoom).toBe(16);
  });
});

describe('useDownloadStore: cell selection', () => {
  it('selectCell adds cells in selection order', () => {
    store.getState().selectCell(10, 20);
    store.getState().selectCell(11, 20);
    store.getState().selectCell(10, 21);
    expect(store.getState().selectedCells).toEqual([
      { cx: 10, cy: 20 },
      { cx: 11, cy: 20 },
      { cx: 10, cy: 21 },
    ]);
  });

  it('selecting an already-selected cell is a no-op (no duplicates, same state object)', () => {
    store.getState().selectCell(10, 20);
    const before = store.getState().selectedCells;
    store.getState().selectCell(10, 20);
    expect(store.getState().selectedCells).toEqual([{ cx: 10, cy: 20 }]);
    expect(store.getState().selectedCells).toBe(before);
  });

  it('treats (cx, cy) and (cy, cx) as different cells', () => {
    store.getState().selectCell(1, 2);
    store.getState().selectCell(2, 1);
    expect(store.getState().selectedCells).toHaveLength(2);
    store.getState().deselectCell(1, 2);
    expect(store.getState().selectedCells).toEqual([{ cx: 2, cy: 1 }]);
  });

  it('deselectCell removes only the matching cell', () => {
    store.getState().selectCell(1, 1);
    store.getState().selectCell(2, 2);
    store.getState().selectCell(3, 3);
    store.getState().deselectCell(2, 2);
    expect(store.getState().selectedCells).toEqual([
      { cx: 1, cy: 1 },
      { cx: 3, cy: 3 },
    ]);
  });

  it('deselecting a cell that is not selected changes nothing', () => {
    store.getState().selectCell(1, 1);
    store.getState().deselectCell(9, 9);
    expect(store.getState().selectedCells).toEqual([{ cx: 1, cy: 1 }]);
  });

  it('select -> deselect -> select yields a single entry (tap-to-toggle behaviour)', () => {
    const s = store.getState();
    s.selectCell(5, 5);
    s.deselectCell(5, 5);
    expect(store.getState().selectedCells).toEqual([]);
    s.selectCell(5, 5);
    expect(store.getState().selectedCells).toEqual([{ cx: 5, cy: 5 }]);
  });

  it('clearSelection empties the selection but not the queue or layer choice', () => {
    store.getState().selectCell(1, 1);
    store.getState().selectCell(2, 2);
    store.getState().enqueue(cell());
    store.getState().setSelectedLayers(['satellite']);
    store.getState().clearSelection();
    expect(store.getState().selectedCells).toEqual([]);
    expect(store.getState().queue).toHaveLength(1);
    expect(store.getState().selectedLayers).toEqual(['satellite']);
  });

  it('handles zero and negative-looking coordinates (falsy values are valid cells)', () => {
    store.getState().selectCell(0, 0);
    store.getState().selectCell(0, 0);
    expect(store.getState().selectedCells).toEqual([{ cx: 0, cy: 0 }]);
    store.getState().deselectCell(0, 0);
    expect(store.getState().selectedCells).toEqual([]);
  });
});

describe('useDownloadStore: layer and zoom choices', () => {
  it('setSelectedLayers replaces the layer list', () => {
    store.getState().setSelectedLayers(['topo', 'satellite']);
    expect(store.getState().selectedLayers).toEqual(['topo', 'satellite']);
    store.getState().setSelectedLayers([]);
    expect(store.getState().selectedLayers).toEqual([]);
  });

  it('setMaxZoom stores the chosen zoom', () => {
    store.getState().setMaxZoom(14);
    expect(store.getState().maxZoom).toBe(14);
  });
});

describe('useDownloadStore: queue', () => {
  it('enqueue appends in order', () => {
    store.getState().enqueue(cell({ cx: 1 }));
    store.getState().enqueue(cell({ cx: 2 }));
    expect(store.getState().queue.map((c) => c.cx)).toEqual([1, 2]);
  });

  it('updateProgress changes only the matching layer+cell', () => {
    store.getState().enqueue(cell({ layer: 'topo', cx: 1, cy: 2 }));
    store.getState().enqueue(cell({ layer: 'satellite', cx: 1, cy: 2 }));
    store.getState().enqueue(cell({ layer: 'topo', cx: 3, cy: 4 }));

    store.getState().updateProgress('topo', 1, 2, 0.6);

    expect(store.getState().queue.map((c) => [c.layer, c.cx, c.cy, c.progress])).toEqual([
      ['topo', 1, 2, 0.6],
      ['satellite', 1, 2, 0],
      ['topo', 3, 4, 0],
    ]);
  });

  it('updateProgress keeps the other fields and does not mutate the previous entry', () => {
    store.getState().enqueue(cell({ maxZoom: 15 }));
    const original = store.getState().queue[0];
    store.getState().updateProgress('topo', 1, 2, 0.5);
    expect(store.getState().queue[0]).toEqual({ layer: 'topo', cx: 1, cy: 2, maxZoom: 15, progress: 0.5 });
    expect(original.progress).toBe(0);
  });

  it('updateProgress for a cell that is not queued leaves the queue as it was', () => {
    store.getState().enqueue(cell());
    store.getState().updateProgress('topo', 99, 99, 1);
    expect(store.getState().queue).toEqual([cell()]);
  });

  it('dequeue removes only the matching layer+cell', () => {
    store.getState().enqueue(cell({ layer: 'topo', cx: 1, cy: 2 }));
    store.getState().enqueue(cell({ layer: 'satellite', cx: 1, cy: 2 }));
    store.getState().dequeue('topo', 1, 2);
    expect(store.getState().queue.map((c) => c.layer)).toEqual(['satellite']);
  });

  it('dequeue of an unknown cell is a no-op', () => {
    store.getState().enqueue(cell());
    store.getState().dequeue('hybrid', 1, 2);
    store.getState().dequeue('topo', 7, 7);
    expect(store.getState().queue).toHaveLength(1);
  });

  it('supports a full enqueue -> progress -> complete -> dequeue lifecycle', () => {
    store.getState().enqueue(cell());
    for (const p of [0.25, 0.5, 1]) store.getState().updateProgress('topo', 1, 2, p);
    expect(store.getState().queue[0].progress).toBe(1);
    store.getState().dequeue('topo', 1, 2);
    expect(store.getState().queue).toEqual([]);
  });
});
