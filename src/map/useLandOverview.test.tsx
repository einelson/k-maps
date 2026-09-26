import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { cellBounds } from '../downloads/cells';
import { OVERVIEW_BLOCK_CELLS, type LandCellRef } from './landOverview';
import { useLandOverview } from './useLandOverview';

let mockEnsure: jest.Mock;
const mockPrune = jest.fn();
jest.mock('./landOverviewBuild', () => ({
  ensureOverviewBlock: (...args: unknown[]) => mockEnsure(...args),
}));
jest.mock('../packs/overviewStorage', () => ({
  overviewUri: (bx: number, by: number, builtAt: number, level: string) =>
    `file:///ov/${bx}_${by}.${builtAt}.${level}.json`,
  pruneOverview: (...args: unknown[]) => mockPrune(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cellsIn = (bx: number, by: number, updatedAt = 100): LandCellRef[] => [
  { cx: bx * OVERVIEW_BLOCK_CELLS, cy: by * OVERVIEW_BLOCK_CELLS, updatedAt },
  { cx: bx * OVERVIEW_BLOCK_CELLS + 1, cy: by * OVERVIEW_BLOCK_CELLS, updatedAt },
];
const centreOf = (bx: number, by: number): [number, number] => {
  const [w, s, e, n] = cellBounds(bx * OVERVIEW_BLOCK_CELLS, by * OVERVIEW_BLOCK_CELLS);
  return [(w + e) / 2, (s + n) / 2];
};
const view = (zoom: number, [lon, lat]: [number, number]) => {
  const half = 2 ** (10 - zoom) * 0.1;
  return {
    zoom,
    center: [lon, lat] as [number, number],
    bounds: [lon - half, lat - half / 2, lon + half, lat + half / 2] as [number, number, number, number],
  };
};

let renderer: ReactTestRenderer;
let latest: ReturnType<typeof useLandOverview>;
let renders = 0;

function Probe(props: { enabled: boolean; cells: readonly LandCellRef[] }) {
  const result = useLandOverview(props);
  // Recorded after each commit (not during render), which is when the tests read it.
  useEffect(() => {
    latest = result;
    renders++;
  });
  return null;
}
const mount = (enabled: boolean, cells: readonly LandCellRef[]) =>
  act(() => void (renderer = create(<Probe enabled={enabled} cells={cells} />)));
const rerender = (enabled: boolean, cells: readonly LandCellRef[]) =>
  act(() => renderer.update(<Probe enabled={enabled} cells={cells} />));
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
const ids = () => latest.blocks.map((b) => b.id);

beforeEach(() => {
  jest.clearAllMocks();
  renders = 0;
  // Every block builds instantly at time 1000 unless a test says otherwise.
  mockEnsure = jest.fn(async () => 1000);
});
afterEach(() => act(() => renderer.unmount()));

describe('useLandOverview', () => {
  it('has nothing until the map has said where it is looking', async () => {
    mount(true, cellsIn(40, 46));
    await settle();
    expect(latest.blocks).toEqual([]);
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('makes and offers the blocks with downloaded land in view, for the level the zoom uses', async () => {
    mount(true, cellsIn(40, 46));
    act(() => latest.updateView(view(6, centreOf(40, 46))));
    await settle();

    expect(latest.blocks).toEqual([
      { id: 'land-ov-40_46-1000-coarse', uri: 'file:///ov/40_46.1000.coarse.json', level: 'coarse' },
    ]);
    act(() => latest.updateView(view(8, centreOf(40, 46))));
    await settle();
    expect(latest.blocks[0]).toMatchObject({ level: 'fine', uri: 'file:///ov/40_46.1000.fine.json' });
    // Same build serves both levels: no second build for the zoom change.
    expect(mockEnsure).toHaveBeenCalledTimes(1);
  });

  it('offers nothing when zoomed in where detailed cells draw, or too far out', async () => {
    mount(true, cellsIn(40, 46));
    act(() => latest.updateView(view(6, centreOf(40, 46))));
    await settle();
    expect(latest.blocks).toHaveLength(1);

    act(() => latest.updateView(view(10, centreOf(40, 46))));
    await settle();
    expect(latest.blocks).toEqual([]);

    act(() => latest.updateView(view(4, centreOf(40, 46))));
    await settle();
    expect(latest.blocks).toEqual([]);
  });

  it('offers nothing while no land layer is switched on, and comes back when one is', async () => {
    mount(false, cellsIn(40, 46));
    act(() => latest.updateView(view(6, centreOf(40, 46))));
    await settle();
    expect(latest.blocks).toEqual([]);
    expect(mockEnsure).not.toHaveBeenCalled();

    rerender(true, cellsIn(40, 46));
    await settle();
    expect(latest.blocks).toHaveLength(1);
  });

  it('shows blocks one by one as they are made, nearest first, and says it is preparing', async () => {
    const releases: (() => void)[] = [];
    mockEnsure = jest.fn(
      (_want, onBuild) =>
        new Promise<number>((resolve) => {
          onBuild();
          releases.push(() => resolve(1000 + releases.length));
        })
    );
    mount(true, [...cellsIn(40, 46), ...cellsIn(41, 46)]);
    act(() => latest.updateView(view(5, centreOf(40, 46))));
    await settle();

    expect(latest.building).toBe(true);
    expect(latest.blocks).toEqual([]);

    await act(async () => releases[0]());
    await settle();
    expect(ids()).toEqual(['land-ov-40_46-1001-coarse']);
    expect(latest.building).toBe(true); // the second is still being made

    await act(async () => releases[1]());
    await settle();
    expect(latest.blocks).toHaveLength(2);
    expect(latest.building).toBe(false);
  });

  it('barely re-renders while the view moves within the same blocks', async () => {
    mount(true, cellsIn(40, 46));
    act(() => latest.updateView(view(6, centreOf(40, 46))));
    await settle();
    const before = renders;

    for (let i = 0; i < 5; i++) {
      const [lon, lat] = centreOf(40, 46);
      act(() => latest.updateView(view(6, [lon + i * 0.01, lat])));
    }
    await settle();
    // React may run the component once more before it notices a set-state changed nothing; five moves cost at most one.
    expect(renders).toBeLessThanOrEqual(before + 1);
  });

  it('keeps showing blocks it already has while the next ones are made (no flicker on a pan)', async () => {
    mount(true, [...cellsIn(40, 46), ...cellsIn(41, 46)]);
    act(() => latest.updateView(view(5, centreOf(40, 46))));
    await settle();
    expect(latest.blocks).toHaveLength(2);

    // A new block appears and is slow to build: the two already built stay mounted.
    mockEnsure = jest.fn(() => new Promise<number>(() => {}));
    rerender(true, [...cellsIn(40, 46), ...cellsIn(41, 46), ...cellsIn(42, 46)]);
    await settle();
    expect(latest.blocks).toHaveLength(2);
  });

  it('rebuilds a block whose cells changed, under a new id so the map re-reads it', async () => {
    mount(true, cellsIn(40, 46, 100));
    act(() => latest.updateView(view(6, centreOf(40, 46))));
    await settle();
    const first = ids()[0];

    mockEnsure = jest.fn(async () => 2000);
    rerender(true, cellsIn(40, 46, 300));
    await settle();

    expect(mockEnsure).toHaveBeenCalledTimes(1);
    expect(ids()[0]).not.toBe(first);
    expect(ids()[0]).toBe('land-ov-40_46-2000-coarse');
  });

  it('keeps showing a block’s previous file while it is rebuilt, rather than blinking out', async () => {
    mount(true, cellsIn(40, 46, 100));
    act(() => latest.updateView(view(6, centreOf(40, 46))));
    await settle();
    const first = ids();

    let finish: (builtAt: number) => void = () => {};
    mockEnsure = jest.fn((_want, onBuild) => {
      onBuild();
      return new Promise<number>((resolve) => (finish = resolve));
    });
    rerender(true, cellsIn(40, 46, 300));
    await settle();
    expect(ids()).toEqual(first);
    expect(latest.building).toBe(true);

    await act(async () => finish(2000));
    await settle();
    expect(ids()).toEqual(['land-ov-40_46-2000-coarse']);
    expect(latest.building).toBe(false);
  });

  it('leaves a block out when it could not be built, and carries on with the others', async () => {
    mockEnsure = jest.fn(async ({ block }) => (block.bx === 40 ? null : 1000));
    mount(true, [...cellsIn(40, 46), ...cellsIn(41, 46)]);
    act(() => latest.updateView(view(5, centreOf(40, 46))));
    await settle();
    expect(ids()).toEqual(['land-ov-41_46-1000-coarse']);
    expect(latest.building).toBe(false);
  });

  it('tidies away the files of blocks that have no downloaded land left', async () => {
    mount(true, [...cellsIn(40, 46), ...cellsIn(41, 46)]);
    await settle();
    expect(mockPrune).toHaveBeenLastCalledWith(new Set(['40_46', '41_46']));

    rerender(true, cellsIn(41, 46));
    await settle();
    expect(mockPrune).toHaveBeenLastCalledWith(new Set(['41_46']));
  });
});
