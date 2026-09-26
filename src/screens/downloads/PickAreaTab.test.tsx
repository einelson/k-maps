import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { CoverageRow } from '../../data/types';
import { lonLatToCell } from '../../downloads/cells';
import { US_COVERAGE } from '../../downloads/usCells';
import { startDownload } from '../../downloads/startDownload';
import { useDownloadRunStore } from '../../state/useDownloadRunStore';
import { useDownloadStore } from '../../state/useDownloadStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import { pressableWith, pressablesNamed, renderedTexts } from '../../testing/renderHelpers';
import { PickAreaTab } from './PickAreaTab';

// The map is native; what matters here is what the tab does with its taps and view changes, so the stub just keeps
// the props it was given for the test to call.
type MapProps = {
  onMapPress: (lngLat: [number, number]) => void;
  onViewStateChange: (view: {
    center: [number, number];
    zoom: number;
    bounds: [number, number, number, number];
  }) => void;
  initialView: { center: [number, number]; zoom: number };
};
let mapProps: MapProps;
let overlayCells: { cx: number; cy: number; state: string }[] = [];
let mockFreeBytes: number | null = 500_000_000_000;

jest.mock('../../map/MapView', () => ({
  MapScreenMap: (props: MapProps & { children?: unknown }) => {
    mapProps = props;
    return props.children ?? null;
  },
}));
jest.mock('../../map/BlockGridOverlay', () => ({ BlockGridOverlay: () => null }));
jest.mock('../../map/CellsOverlay', () => ({
  CELL_STATE_COLORS: { selected: '#0a0', complete: '#00a', partial: '#fa0' },
  CellsOverlay: ({ cells }: { cells: typeof overlayCells }) => {
    overlayCells = cells;
    return null;
  },
}));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
// The Download button is handed to the screen header through `navigation.setOptions`; the tests read it from there.
const mockNavigation = { setOptions: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../downloads/startDownload', () => ({ startDownload: jest.fn(), cancelDownload: jest.fn() }));
jest.mock('../../downloads/freeSpace', () => ({ freeDiskBytes: () => mockFreeBytes }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOISE: [number, number] = [-116.2, 43.6];
let renderer: ReactTestRenderer;
const onViewChange = jest.fn();
const onSeeReadyMade = jest.fn();
const reloadCoverage = jest.fn(async () => {});
const texts = () => renderedTexts(renderer);
const has = (text: string) => texts().includes(text);
const hasMatch = (re: RegExp) => texts().some((t) => re.test(t));
const store = useDownloadStore;

/** The Download button as the screen header would draw it: the latest `headerRight` PickAreaTab set, called for its element. */
function headerButton() {
  const calls = mockNavigation.setOptions.mock.calls.filter(([options]) => typeof options.headerRight === 'function');
  if (calls.length === 0) throw new Error('PickAreaTab has not put a button in the header');
  return calls[calls.length - 1][0].headerRight() as ReactElement<{ disabled: boolean; onPress: () => void }>;
}

const row = (
  layer: string,
  cx: number,
  cy: number,
  status: CoverageRow['status'] = 'complete',
  maxZoom = 0
): CoverageRow => ({
  layer,
  cell_x: cx,
  cell_y: cy,
  max_zoom: maxZoom,
  status,
  bytes: 1,
  updated_at: 0,
});

function mount(coverage: CoverageRow[] = [], zoom = 10) {
  act(
    () =>
      void (renderer = create(
        <PickAreaTab
          coverage={coverage}
          reloadCoverage={reloadCoverage}
          initialView={{ center: BOISE, zoom }}
          onViewChange={onViewChange}
          onSeeReadyMade={onSeeReadyMade}
        />
      ))
  );
}

/** Moves the (stubbed) map to a zoom, the way the real one reports it when the camera settles. */
function zoomTo(zoom: number, center: [number, number] = BOISE) {
  const half = 2 ** (10 - zoom) * 0.1;
  act(() =>
    mapProps.onViewStateChange({
      center,
      zoom,
      bounds: [center[0] - half, center[1] - half / 2, center[0] + half, center[1] + half / 2],
    })
  );
}
const tap = (lngLat: [number, number] = BOISE) => act(() => mapProps.onMapPress(lngLat));
const selectedCount = () => store.getState().selectedCells.length;

// A tree left mounted keeps listening to the stores and would overwrite `mapProps` with its own stale copy.
afterEach(() => act(() => renderer.unmount()));

beforeEach(() => {
  jest.clearAllMocks();
  mockFreeBytes = 500_000_000_000;
  store.setState(store.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  act(() => useDownloadRunStore.getState().dismiss());
});

describe('PickAreaTab: picking squares', () => {
  it('starts with a hint that says how to pick, and nothing picked', () => {
    mount();

    expect(has('1 · Pick the area')).toBe(true);
    expect(hasMatch(/Tap the map to pick squares/)).toBe(true);
    expect(has('Each tap picks 1 square')).toBe(true);
    expect(has('Zoom out to pick more at once')).toBe(true);
  });

  it('opens the map where it was told to', () => {
    mount([], 8.2);
    expect(mapProps.initialView).toEqual({ center: BOISE, zoom: 8.2 });
    expect(has('Each tap picks 2 × 2 squares')).toBe(true);
  });

  it('a tap picks one square when zoomed in', () => {
    mount();
    tap();

    expect(selectedCount()).toBe(1);
    expect(store.getState().selectedCells[0]).toEqual(lonLatToCell(...BOISE));
    expect(has('1 square picked · about 310 sq mi')).toBe(true);
  });

  it('zooming out makes each tap pick more: 2 x 2, then 4 x 4, then 8 x 8 squares', () => {
    mount();

    zoomTo(8.2);
    expect(has('Each tap picks 2 × 2 squares')).toBe(true);
    tap();
    expect(selectedCount()).toBe(4);

    zoomTo(7.2);
    expect(has('Each tap picks 4 × 4 squares')).toBe(true);
    tap([-112, 46]);
    expect(selectedCount()).toBe(4 + 16);

    zoomTo(6.2);
    expect(has('Each tap picks 8 × 8 squares')).toBe(true);
    tap([-105, 40]);
    expect(selectedCount()).toBe(4 + 16 + 64);
  });

  it('tapping a picked block again puts it back, so a mis-tap is one tap to undo', () => {
    mount();
    zoomTo(7.2);
    tap();
    expect(selectedCount()).toBe(16);

    tap();
    expect(selectedCount()).toBe(0);
  });

  it('shows picked squares on the map in the picked colour, next to ones already on the phone', () => {
    mount([row('land', 1, 1)]);
    tap();

    expect(overlayCells).toEqual(
      expect.arrayContaining([
        { cx: 1, cy: 1, state: 'complete' },
        { ...lonLatToCell(...BOISE), state: 'selected' },
      ])
    );
  });

  it('cannot pick ocean or another country: nothing is picked and it says why', () => {
    mount();

    tap([-128.5, 40.5]); // the Pacific, 100 miles off California
    expect(selectedCount()).toBe(0);
    expect(hasMatch(/no US land there/)).toBe(true);

    tap([-114.07, 51.05]); // Calgary
    expect(selectedCount()).toBe(0);
  });

  it('a block over a coast picks only its land squares', () => {
    mount();
    zoomTo(6.2);

    tap([-124, 41]); // an 8 x 8 block straddling the California / Oregon coast
    expect(selectedCount()).toBeGreaterThan(0);
    expect(selectedCount()).toBeLessThan(64);
    expect(store.getState().selectedCells.every((c) => US_COVERAGE.hasLand(c.cx, c.cy))).toBe(true);
  });

  it('the notice goes away once something valid is picked', () => {
    mount();
    tap([-128.5, 40.5]);
    expect(hasMatch(/no US land there/)).toBe(true);

    tap();

    expect(hasMatch(/no US land there/)).toBe(false);
    expect(selectedCount()).toBe(1);
  });

  it('"Pick everything in view" picks every square on screen at once', () => {
    mount();
    zoomTo(8.2);

    act(() => pressableWith(renderer, 'Pick everything in view').props.onPress());

    expect(selectedCount()).toBeGreaterThan(4);
    expect(hasMatch(/squares picked · about/)).toBe(true);
  });

  it('refuses a pick that is too big, says why and how to do it instead, and keeps what was picked', () => {
    mount();
    zoomTo(5.2);
    tap([-120, 45]); // a 16 x 16 block: 256 squares
    expect(selectedCount()).toBe(256);

    tap([-100, 40]); // another 256 would pass the limit of 500

    expect(selectedCount()).toBe(256);
    expect(hasMatch(/the most at once is 500/)).toBe(true);
    expect(hasMatch(/Ready-made downloads/)).toBe(true);
  });

  it('Clear empties the picks and the warning', () => {
    mount();
    zoomTo(5.2);
    tap([-120, 45]);
    tap([-100, 40]);

    act(() => pressableWith(renderer, 'Clear').props.onPress());

    expect(selectedCount()).toBe(0);
    expect(hasMatch(/the most at once/)).toBe(false);
  });

  it('reports the picked area in kilometres for metric users', () => {
    useSettingsStore.setState({ units: 'metric' });
    mount();
    tap();

    expect(hasMatch(/^1 square picked · about \d+ km²$/)).toBe(true);
  });

  it('links to Ready-made downloads for whole states', () => {
    mount();
    act(() => pressableWith(renderer, 'Ready-made downloads').props.onPress());
    expect(onSeeReadyMade).toHaveBeenCalled();
  });

  it('reports the view so the Downloads screen can put the map back where it was', () => {
    mount();
    zoomTo(9, [-114, 46]);
    expect(onViewChange).toHaveBeenLastCalledWith({ center: [-114, 46], zoom: 9 });
  });
});

describe('PickAreaTab: choosing what to save', () => {
  it('starts with public land and topo maps chosen, and remembers changes in the download options', () => {
    mount();
    expect(store.getState().selectedPackLayers).toEqual(['land']);
    expect(store.getState().selectedLayers).toEqual(['topo']);

    act(() => pressableWith(renderer, 'Forest roads (MVUM)').props.onPress());
    act(() => pressableWith(renderer, 'Satellite').props.onPress());
    act(() => pressableWith(renderer, 'Public land + private shading').props.onPress());

    expect(store.getState().selectedPackLayers).toEqual(['mvum']);
    expect(store.getState().selectedLayers).toEqual(['topo', 'satellite']);
  });

  it('offers detail levels only once a map picture is chosen, and shows their cost per square', () => {
    mount();
    expect(has('Detail')).toBe(true);
    expect(hasMatch(/About .* per square for what you picked, at zoom 16/)).toBe(true);

    act(() => pressableWith(renderer, 'Standard').props.onPress());
    expect(store.getState().maxZoom).toBe(14);
    expect(has('About 6.0 MB per square for what you picked, at zoom 14.')).toBe(true);

    act(() => pressableWith(renderer, 'Topo').props.onPress());
    expect(has('Detail')).toBe(false);
  });
});

describe('PickAreaTab: starting a download', () => {
  it('has its Download button in the header, not the bottom panel', () => {
    mount();
    tap();

    expect(pressablesNamed(renderer, 'Download')).toHaveLength(0);
    expect(headerButton().props.disabled).toBe(false);
  });

  it('turns the header button off while a download runs, and back on once it is dismissed', () => {
    mount();
    tap();
    expect(headerButton().props.disabled).toBe(false);

    act(() => useDownloadRunStore.getState().begin(2, 0));
    expect(headerButton().props.disabled).toBe(true);

    act(() => useDownloadRunStore.getState().dismiss());
    expect(headerButton().props.disabled).toBe(false);
  });

  it('takes the button out of the header when the tab goes away', () => {
    mount();
    act(() => renderer.unmount());

    const calls = mockNavigation.setOptions.mock.calls;
    expect(calls[calls.length - 1][0]).toEqual({ headerRight: undefined });
    mount(); // keeps the afterEach unmount balanced
  });

  it('cannot start until something is picked, and says so', () => {
    mount();

    expect(has('Tap the map to pick an area first.')).toBe(true);
    expect(headerButton().props.disabled).toBe(true);
  });

  it('cannot start with nothing chosen to save', () => {
    mount();
    tap();
    act(() => {
      store.setState({ selectedLayers: [], selectedPackLayers: [] });
    });

    expect(has('Choose what to save under step 2.')).toBe(true);
  });

  it('cannot start when everything picked is already on the phone', () => {
    mount([
      row('land', ...(Object.values(lonLatToCell(...BOISE)) as [number, number])),
      row('topo', ...(Object.values(lonLatToCell(...BOISE)) as [number, number]), 'complete', 16),
    ]);
    tap();

    expect(has('Everything you picked is already on this phone.')).toBe(true);
  });

  it('cannot start when the phone does not have the space', () => {
    mockFreeBytes = 50_000_000;
    mount();
    tap();

    expect(hasMatch(/Not enough space: this needs about .* and the phone has 50 MB free\./)).toBe(true);
    expect(headerButton().props.disabled).toBe(true);
  });

  it('starts the download for the picked squares and chosen layers', () => {
    mount();
    tap();

    act(() => headerButton().props.onPress());

    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        cells: [lonLatToCell(...BOISE)],
        tileLayers: ['topo'],
        packLayers: ['land'],
        maxZoom: 16,
      })
    );
  });

  it('asks first when it is over a gigabyte, and only starts if confirmed', () => {
    let buttons: AlertButton[] | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, b) => void (buttons = b));
    mount();
    zoomTo(7.2);
    tap(); // 16 squares of topo at maximum detail: well over a gigabyte

    act(() => headerButton().props.onPress());
    expect(Alert.alert).toHaveBeenCalledWith(
      'Large download',
      expect.stringMatching(/GB of storage/),
      expect.any(Array)
    );
    expect(startDownload).not.toHaveBeenCalled();

    act(() => buttons?.find((b) => b.text === 'Download')?.onPress?.());
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it('does not ask for a small one', () => {
    const alert = jest.spyOn(Alert, 'alert');
    mount();
    tap();
    act(() => headerButton().props.onPress());
    expect(alert).not.toHaveBeenCalled();
  });

  it('only counts what is still to do in the total, and says what it is skipping', () => {
    const { cx, cy } = lonLatToCell(...BOISE);
    mount([row('land', cx, cy)]);
    tap();

    expect(has('1 already on this phone is skipped.')).toBe(true);
  });
});
