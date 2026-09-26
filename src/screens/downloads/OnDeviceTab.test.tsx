import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { CoverageRow } from '../../data/types';
import { deletePackData } from '../../downloads/packDownloader';
import { usePackStore } from '../../state/usePackStore';
import { useRegionPackStore } from '../../state/useRegionPackStore';
import { pressableWith, renderedTexts, settle } from '../../testing/renderHelpers';
import { OnDeviceTab } from './OnDeviceTab';

const mockDb = {};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../downloads/packDownloader', () => ({ deletePackData: jest.fn(async () => {}) }));
jest.mock('../../downloads/freeSpace', () => ({ freeDiskBytes: () => 12_000_000_000 }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (layer: string, cx: number, status: CoverageRow['status'], bytes: number): CoverageRow => ({
  layer,
  cell_x: cx,
  cell_y: 0,
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

beforeEach(() => jest.clearAllMocks());

describe('OnDeviceTab', () => {
  it('says so when nothing is saved, and points at how data gets here', () => {
    mount([]);

    expect(has('Nothing is saved on this phone yet.')).toBe(true);
    expect(hasMatch(/save themselves as you browse/)).toBe(true);
  });

  it('totals what is stored and shows the free space', () => {
    mount([
      row('land', 1, 'complete', 300_000),
      row('land', 2, 'complete', 500_000),
      row('mvum', 1, 'complete', 2_000_000),
    ]);

    expect(has('2.8 MB saved on this phone · 12 GB free')).toBe(true);
  });

  it('lists each layer with its squares and size, counting partial squares but not failed or in-flight ones', () => {
    mount([
      row('land', 1, 'complete', 400_000),
      row('land', 2, 'partial', 100_000),
      row('land', 3, 'failed', 0),
      row('land', 4, 'downloading', 0),
    ]);

    expect(has('Public land + private shading')).toBe(true);
    expect(has('2 squares · 500 KB')).toBe(true);
  });

  it('uses the singular for one square and leaves the size off when it is unknown', () => {
    mount([row('trails', 1, 'complete', 0)]);
    expect(has('1 square')).toBe(true);
  });

  it('offers Delete for overlay data only, and explains that map pictures cannot be removed yet', () => {
    mount([row('land', 1, 'complete', 1), row('topo', 1, 'complete', 1)]);

    expect(
      renderer.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button')
    ).toHaveLength(1);
    expect(hasMatch(/Offline map pictures can.t be removed one square at a time yet/)).toBe(true);
  });

  it('asks before deleting, then removes the data, forgets the region install and refreshes the map', async () => {
    let buttons: AlertButton[] | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, b) => void (buttons = b));
    const bumped = jest.spyOn(usePackStore.getState(), 'bump');
    const forget = jest.spyOn(useRegionPackStore.getState(), 'forgetLayer');
    mount([row('mvum', 1, 'complete', 1)]);

    act(() => pressableWith(renderer, 'Delete').props.onPress());
    expect(Alert.alert).toHaveBeenCalledWith('Delete Forest roads (MVUM)?', expect.any(String), expect.any(Array));
    expect(deletePackData).not.toHaveBeenCalled();

    await act(async () => {
      await buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    });
    await settle();

    expect(deletePackData).toHaveBeenCalledWith(mockDb, 'mvum');
    expect(forget).toHaveBeenCalledWith('mvum');
    expect(reloadCoverage).toHaveBeenCalled();
    expect(bumped).toHaveBeenCalled();
  });

  it('keeps the data when the confirmation is cancelled', () => {
    let buttons: AlertButton[] | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, b) => void (buttons = b));
    mount([row('land', 1, 'complete', 1)]);

    act(() => pressableWith(renderer, 'Delete').props.onPress());

    expect(buttons?.find((b) => b.text === 'Cancel')?.style).toBe('cancel');
    expect(deletePackData).not.toHaveBeenCalled();
  });
});
