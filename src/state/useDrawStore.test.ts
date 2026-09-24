import { useDrawStore } from './useDrawStore';

const store = useDrawStore;

beforeEach(() => {
  store.setState(store.getInitialState(), true);
});

describe('useDrawStore', () => {
  it('starts idle with an empty draft', () => {
    expect(store.getState().activeTool).toBe('none');
    expect(store.getState().draftVertices).toEqual([]);
  });

  it('addVertex appends in [lon, lat] order and keeps insertion order', () => {
    const s = store.getState();
    s.setActiveTool('line');
    s.addVertex([-116.2, 43.6]);
    s.addVertex([-116.1, 43.7]);
    s.addVertex([-116.0, 43.8]);
    expect(store.getState().draftVertices).toEqual([
      [-116.2, 43.6],
      [-116.1, 43.7],
      [-116.0, 43.8],
    ]);
  });

  it('undoVertex removes only the most recent vertex', () => {
    const s = store.getState();
    s.addVertex([1, 1]);
    s.addVertex([2, 2]);
    s.addVertex([3, 3]);
    s.undoVertex();
    expect(store.getState().draftVertices).toEqual([[1, 1], [2, 2]]);
    s.undoVertex();
    expect(store.getState().draftVertices).toEqual([[1, 1]]);
  });

  it('undoVertex on an empty draft is a safe no-op', () => {
    store.getState().undoVertex();
    store.getState().undoVertex();
    expect(store.getState().draftVertices).toEqual([]);
  });

  it('undo followed by add continues from the shortened draft', () => {
    const s = store.getState();
    s.addVertex([1, 1]);
    s.addVertex([2, 2]);
    s.undoVertex();
    s.addVertex([9, 9]);
    expect(store.getState().draftVertices).toEqual([[1, 1], [9, 9]]);
  });

  it('clearDraft discards vertices but keeps the active tool', () => {
    const s = store.getState();
    s.setActiveTool('polygon');
    s.addVertex([1, 1]);
    s.addVertex([2, 2]);
    s.clearDraft();
    expect(store.getState().draftVertices).toEqual([]);
    expect(store.getState().activeTool).toBe('polygon');
  });

  it('switching tools discards the in-progress draft', () => {
    const s = store.getState();
    s.setActiveTool('line');
    s.addVertex([1, 1]);
    s.setActiveTool('polygon');
    expect(store.getState().activeTool).toBe('polygon');
    expect(store.getState().draftVertices).toEqual([]);
  });

  it('turning drawing off (tool "none") also clears the draft', () => {
    const s = store.getState();
    s.setActiveTool('measure');
    s.addVertex([1, 1]);
    s.setActiveTool('none');
    expect(store.getState().activeTool).toBe('none');
    expect(store.getState().draftVertices).toEqual([]);
  });

  it('accepts every tool in the DrawTool union', () => {
    for (const tool of ['none', 'point', 'line', 'polygon', 'measure'] as const) {
      store.getState().setActiveTool(tool);
      expect(store.getState().activeTool).toBe(tool);
    }
  });

  it('never mutates a previously read draft array (safe for React renders)', () => {
    const s = store.getState();
    s.addVertex([1, 1]);
    const snapshot = store.getState().draftVertices;
    s.addVertex([2, 2]);
    s.undoVertex();
    s.undoVertex();
    expect(snapshot).toEqual([[1, 1]]);
    expect(store.getState().draftVertices).not.toBe(snapshot);
  });

  it('keeps 3D positions intact (altitude is not stripped)', () => {
    store.getState().addVertex([1, 2, 300]);
    expect(store.getState().draftVertices[0]).toEqual([1, 2, 300]);
  });
});
