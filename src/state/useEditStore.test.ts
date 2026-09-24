import { useEditStore } from './useEditStore';

const LINE: [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 0],
];

beforeEach(() => useEditStore.getState().end());

describe('useEditStore', () => {
  it('preselects the only vertex of a point', () => {
    useEditStore.getState().begin(7, 'point', [[1, 2]]);
    expect(useEditStore.getState().selected).toBe(0);
  });

  it('moves, inserts (and selects), and undoes', () => {
    const s = useEditStore.getState();
    s.begin(1, 'line', LINE);
    s.move(1, [1, 5]);
    expect(useEditStore.getState().vertices[1]).toEqual([1, 5]);

    useEditStore.getState().insert(1, [0.5, 0.5]);
    expect(useEditStore.getState().vertices).toHaveLength(4);
    expect(useEditStore.getState().selected).toBe(1);

    useEditStore.getState().undo();
    useEditStore.getState().undo();
    expect(useEditStore.getState().vertices).toEqual(LINE);
    useEditStore.getState().undo(); // nothing left — must not throw or corrupt
    expect(useEditStore.getState().vertices).toEqual(LINE);
  });

  it('refuses to remove below the minimum vertex count', () => {
    const s = useEditStore.getState();
    s.begin(1, 'line', [LINE[0], LINE[1]]);
    useEditStore.getState().remove(0);
    expect(useEditStore.getState().vertices).toHaveLength(2);

    useEditStore.getState().begin(1, 'line', LINE);
    useEditStore.getState().remove(1);
    expect(useEditStore.getState().vertices).toEqual([LINE[0], LINE[2]]);
    expect(useEditStore.getState().selected).toBeNull();
  });

  it('end() clears the session', () => {
    useEditStore.getState().begin(1, 'line', LINE);
    useEditStore.getState().end();
    expect(useEditStore.getState()).toMatchObject({ featureId: null, vertices: [], history: [] });
  });
});
