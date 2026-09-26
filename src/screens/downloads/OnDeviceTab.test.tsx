import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { CoverageRow } from '../../data/types';
import { deletePackCells, deletePackData } from '../../downloads/packDownloader';
import { US_STATE_CELLS } from '../../downloads/stateCells';
import { usePackStore } from '../../state/usePackStore';
import { useRegionPackStore } from '../../state/useRegionPackStore';
import { pressableWith, renderedTexts, settle } from '../../testing/renderHelpers';
import { OnDeviceTab } from './OnDeviceTab';

const mockDb = {};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../downloads/packDownloader', () => ({
  deletePackData: jest.fn(async () => {}),
  deletePackCells: jest.fn(async () => {}),
}));
jest.mock('../../downloads/freeSpace', () => ({ freeDiskBytes: () => 12_000_000_000 }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Cell = { cx: number; cy: number };
const keyOf = (c: Cell) => `${c.cx}:${c.cy}`;
const idaho = US_STATE_CELLS.cellsOf('ID');
const washington = US_STATE_CELLS.cellsOf('WA');
const inWashington = new Set(washington.map(keyOf));
const inIdaho = new Set(idaho.map(keyOf));
/** Squares only in Idaho / only in Washington, and one on the line between them. */
const idahoOnly = idaho.filter((c) => !inWashington.has(keyOf(c)));
const washingtonOnly = washington.filter((c) => !inIdaho.has(keyOf(c)));
const onTheLine = idaho.filter((c) => inWashington.has(keyOf(c)));
/** Well out in the Pacific: in no state. */
const ocean: Cell = { cx: 100, cy: 100 };

const row = (layer: string, cell: Cell, status: CoverageRow['status'] = 'complete', bytes = 1): CoverageRow => ({
  layer,
  cell_x: cell.cx,
  cell_y: cell.cy,
  max_zoom: 0,
  status,
  bytes,
  updated_at: 0,
});

let renderer: ReactTestRenderer;
const reloadCoverage = jest.fn(async () => {});
const texts = () => renderedTexts(renderer);
const has = (text: string) => texts().includes(text);
const hasMatch = (re: RegExp) => texts().some((t) => re.test(t));

function mount(coverage: CoverageRow[]) {
  act(() => void (renderer = create(<OnDeviceTab coverage={coverage} reloadCoverage={reloadCoverage} />)));
}

/** The pressable with this accessibility label (the Delete buttons all read "Delete", so they are told apart by it). */
const labelled = (label: string) => {
  const found = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
  );
  if (found.length === 0) throw new Error(`No button labelled ${label}`);
  return found[0];
};
const open = (name: string) => act(() => pressableWith(renderer, name).props.onPress());

function captureAlert() {
  const captured: { title?: string; message?: string; buttons?: AlertButton[] } = {};
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    Object.assign(captured, { title, message, buttons });
  });
  return captured;
}
async function confirm(buttons?: AlertButton[]) {
  await act(async () => {
    await buttons?.find((b) => b.text === 'Delete')?.onPress?.();
  });
  await settle();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('OnDeviceTab', () => {
  it('says so when nothing is saved, and points at how data gets here', () => {
    mount([]);

    expect(has('Nothing is saved on this phone yet.')).toBe(true);
    expect(hasMatch(/save themselves as you browse/)).toBe(true);
    expect(has('By state')).toBe(false);
  });

  it('totals what is stored and shows the free space', () => {
    mount([
      row('land', idahoOnly[0], 'complete', 300_000),
      row('land', idahoOnly[1], 'complete', 500_000),
      row('mvum', idahoOnly[0], 'complete', 2_000_000),
    ]);

    expect(has('2.8 MB saved on this phone · 12 GB free')).toBe(true);
  });

  it('counts a square on a state line once in the total', () => {
    mount([row('land', onTheLine[0], 'complete', 1_000_000)]);
    expect(has('1.0 MB saved on this phone · 12 GB free')).toBe(true);
  });
});

describe('OnDeviceTab: by state', () => {
  it('splits what is stored by state, each folded to its name and size when there is more than one', () => {
    mount([row('land', idahoOnly[0], 'complete', 2_000_000), row('land', washingtonOnly[0], 'complete', 500_000)]);

    expect(has('By state')).toBe(true);
    expect(has('Idaho')).toBe(true);
    expect(has('Washington')).toBe(true);
    expect(has('2.0 MB')).toBe(true);
    expect(has('500 KB')).toBe(true);
    // Folded: the layers are not listed under the states yet.
    expect(texts().filter((t) => t === 'Public land + private shading')).toHaveLength(1); // only the by-layer list
  });

  it('opens a state to show its layers, squares out of the state’s total, and size', () => {
    mount([
      row('land', idahoOnly[0], 'complete', 400_000),
      row('land', idahoOnly[1], 'partial', 100_000),
      row('land', idahoOnly[2], 'failed', 0),
      row('mvum', idahoOnly[0], 'complete', 1_000_000),
      row('land', washingtonOnly[0], 'complete', 1),
    ]);

    open('Idaho');

    expect(has(`2 of ${idaho.length} squares · 500 KB`)).toBe(true);
    expect(has(`1 of ${idaho.length} squares · 1.0 MB`)).toBe(true);
  });

  it('opens by itself when there is only one state', () => {
    mount([row('land', idahoOnly[0], 'complete', 400_000)]);
    expect(has(`1 of ${idaho.length} squares · 400 KB`)).toBe(true);
  });

  it('shows a square on a state line under both states', () => {
    mount([row('land', onTheLine[0], 'complete', 10)]);
    expect(has('Idaho')).toBe(true);
    expect(has('Washington')).toBe(true);
  });

  it('gathers squares that are in no state in their own group', () => {
    mount([row('land', ocean, 'complete', 1234), row('land', idahoOnly[0])]);

    expect(has('Outside any state')).toBe(true);
    open('Outside any state');
    expect(has('1 square · 1 KB')).toBe(true);
  });

  it('offers Delete for overlay data only, and explains that map pictures cannot be removed yet', () => {
    mount([row('land', idahoOnly[0]), row('topo', idahoOnly[0])]);

    expect(() => labelled('Delete Public land + private shading for Idaho')).not.toThrow();
    expect(() => labelled('Delete Topo for Idaho')).toThrow();
    expect(hasMatch(/Offline map pictures can.t be removed one square at a time yet/)).toBe(true);
  });

  it('asks before deleting a state’s layer, then removes just that state’s squares and refreshes the map', async () => {
    const alert = captureAlert();
    const bumped = jest.spyOn(usePackStore.getState(), 'bump');
    const forget = jest.spyOn(useRegionPackStore.getState(), 'forgetRegionLayer');
    mount([
      row('mvum', idahoOnly[0]),
      row('mvum', idahoOnly[1]),
      row('mvum', washingtonOnly[0]),
      row('land', idahoOnly[0]),
    ]);

    open('Idaho');
    act(() => labelled('Delete Forest roads (MVUM) for Idaho').props.onPress());
    expect(alert.title).toBe('Delete Forest roads (MVUM) for Idaho?');
    expect(alert.message).toMatch(/^2 squares are removed from this phone/);
    expect(deletePackCells).not.toHaveBeenCalled();

    await confirm(alert.buttons);

    expect(deletePackCells).toHaveBeenCalledTimes(1);
    expect(deletePackCells).toHaveBeenCalledWith(mockDb, 'mvum', [idahoOnly[0], idahoOnly[1]]);
    expect(forget).toHaveBeenCalledWith('idaho', 'mvum');
    expect(reloadCoverage).toHaveBeenCalled();
    expect(bumped).toHaveBeenCalled();
  });

  it('keeps the squares on the line that the neighbouring state still uses, and says so', async () => {
    const alert = captureAlert();
    mount([
      row('land', idahoOnly[0]),
      row('land', onTheLine[0]),
      row('land', washingtonOnly[0]), // Washington has land of its own, so it needs the line square
    ]);

    open('Idaho');
    act(() => labelled('Delete Public land + private shading for Idaho').props.onPress());
    expect(alert.message).toMatch(/1 square is removed/);
    expect(alert.message).toMatch(/1 square on the line with a neighbouring state stay/);

    await confirm(alert.buttons);
    expect(deletePackCells).toHaveBeenCalledWith(mockDb, 'land', [idahoOnly[0]]);
  });

  it('deletes every overlay layer of a state with one button', async () => {
    const alert = captureAlert();
    mount([row('land', idahoOnly[0]), row('mvum', idahoOnly[0]), row('topo', idahoOnly[0])]);

    act(() => pressableWith(renderer, 'Delete all overlay data for Idaho').props.onPress());
    expect(alert.title).toBe('Delete all overlay data for Idaho?');

    await confirm(alert.buttons);
    expect(deletePackCells).toHaveBeenCalledTimes(2);
    expect(deletePackCells).toHaveBeenCalledWith(mockDb, 'land', [idahoOnly[0]]);
    expect(deletePackCells).toHaveBeenCalledWith(mockDb, 'mvum', [idahoOnly[0]]);
  });

  it('does not offer "delete all" for a state with only one overlay layer', () => {
    mount([row('land', idahoOnly[0])]);
    expect(texts().some((t) => t.startsWith('Delete all overlay data'))).toBe(false);
  });

  it('keeps the data when the confirmation is cancelled', () => {
    const alert = captureAlert();
    mount([row('land', idahoOnly[0])]);

    act(() => labelled('Delete Public land + private shading for Idaho').props.onPress());

    expect(alert.buttons?.find((b) => b.text === 'Cancel')?.style).toBe('cancel');
    expect(deletePackCells).not.toHaveBeenCalled();
  });

  it('says there is nothing to delete when every square is one a neighbour still needs', () => {
    const alert = captureAlert();
    mount([row('land', onTheLine[0]), row('land', washingtonOnly[0])]);
    open('Idaho');

    act(() => labelled('Delete Public land + private shading for Idaho').props.onPress());

    expect(alert.title).toBe('Nothing to delete for Idaho');
    expect(alert.buttons).toBeUndefined();
    expect(deletePackCells).not.toHaveBeenCalled();
  });
});

describe('OnDeviceTab: by layer', () => {
  it('lists each layer with its squares and size, counting partial squares but not failed or in-flight ones', () => {
    mount([
      row('land', idahoOnly[0], 'complete', 400_000),
      row('land', idahoOnly[1], 'partial', 100_000),
      row('land', idahoOnly[2], 'failed', 0),
      row('land', idahoOnly[3], 'downloading', 0),
    ]);

    expect(has('By layer, everywhere')).toBe(true);
    expect(has('2 squares · 500 KB')).toBe(true);
  });

  it('uses the singular for one square and leaves the size off when it is unknown', () => {
    mount([row('trails', idahoOnly[0], 'complete', 0)]);
    expect(has('1 square')).toBe(true);
  });

  it('removes a layer everywhere after asking, forgets every state’s install of it and refreshes the map', async () => {
    const alert = captureAlert();
    const bumped = jest.spyOn(usePackStore.getState(), 'bump');
    const forget = jest.spyOn(useRegionPackStore.getState(), 'forgetLayer');
    mount([row('mvum', idahoOnly[0]), row('mvum', washingtonOnly[0])]);

    act(() => labelled('Delete Forest roads (MVUM) everywhere').props.onPress());
    expect(alert.title).toBe('Delete Forest roads (MVUM)?');
    expect(deletePackData).not.toHaveBeenCalled();

    await confirm(alert.buttons);

    expect(deletePackData).toHaveBeenCalledWith(mockDb, 'mvum');
    expect(forget).toHaveBeenCalledWith('mvum');
    expect(reloadCoverage).toHaveBeenCalled();
    expect(bumped).toHaveBeenCalled();
  });
});
