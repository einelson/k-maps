import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { CoverageRow } from '../../data/types';
import { lonLatToCell } from '../../downloads/cells';
import { US_COVERAGE } from '../../downloads/usCells';
import { startDownload } from '../../downloads/startDownload';
import { US_STATE_CELLS } from '../../downloads/stateCells';
import type { ManifestState } from '../../downloads/useRegionManifest';
import type { RegionEntry } from '../../packs/regionPacks';
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
  cameraRef: { current: unknown };
};
let mapProps: MapProps;
let overlayCells: { cx: number; cy: number; state: string }[] = [];
let cursorBlock: { bx: number; by: number; size: number } | null = null;
let mockFreeBytes: number | null = 500_000_000_000;

jest.mock('../../map/MapView', () => ({
  MapScreenMap: (props: MapProps & { children?: unknown }) => {
    mapProps = props;
    return props.children ?? null;
  },
}));
jest.mock('../../map/BlockGridOverlay', () => ({ BlockGridOverlay: () => null }));
jest.mock('../../map/BlockCursorOverlay', () => ({
  BlockCursorOverlay: ({ cursor }: { cursor: typeof cursorBlock }) => {
    cursorBlock = cursor;
    return null;
  },
}));
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
const onSeeOverlays = jest.fn();
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

const ready = (regions: RegionEntry[] = []): ManifestState => ({
  status: 'ready',
  manifest: { format: 2, regions, huntUnits: [] },
});
const idahoRegion = (layers: RegionEntry['packs'][number]['layer'][] = ['land']): RegionEntry => ({
  id: 'idaho',
  name: 'Idaho',
  cells: US_STATE_CELLS.cellsOf('ID').map(({ cx, cy }): [number, number] => [cx, cy]),
  packs: layers.map((layer) => ({ layer, file: `idaho-${layer}.zip`, bytes: 5_000_000, version: 'v1' })),
});

function mount(coverage: CoverageRow[] = [], zoom = 10, manifest: ManifestState = ready()) {
  act(
    () =>
      void (renderer = create(
        <PickAreaTab
          coverage={coverage}
          manifest={manifest}
          reloadCoverage={reloadCoverage}
          initialView={{ center: BOISE, zoom }}
          onViewChange={onViewChange}
          onSeeOverlays={onSeeOverlays}
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
    mount([], 6.6);
    expect(mapProps.initialView).toEqual({ center: BOISE, zoom: 6.6 });
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

    zoomTo(6.6);
    expect(has('Each tap picks 2 × 2 squares')).toBe(true);
    tap();
    expect(selectedCount()).toBe(4);

    zoomTo(5.6);
    expect(has('Each tap picks 4 × 4 squares')).toBe(true);
    tap([-112, 46]);
    expect(selectedCount()).toBe(4 + 16);

    zoomTo(4.6);
    expect(has('Each tap picks 8 × 8 squares')).toBe(true);
    tap([-105, 40]);
    expect(selectedCount()).toBe(4 + 16 + 64);
  });

  it('picks single squares from zoom 7 — no more zooming in until one square fills the phone', () => {
    mount([], 7.3);
    zoomTo(7.3);
    expect(has('Each tap picks 1 square')).toBe(true);
    tap();
    expect(selectedCount()).toBe(1);
  });

  it('tapping a picked block again puts it back, so a mis-tap is one tap to undo', () => {
    mount();
    zoomTo(5.6);
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
    zoomTo(4.6);

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
    zoomTo(6.6);

    act(() => pressableWith(renderer, 'Pick everything in view').props.onPress());

    expect(selectedCount()).toBeGreaterThan(4);
    expect(hasMatch(/squares picked · about/)).toBe(true);
  });

  it('refuses a pick that is too big, says why and how to do it instead, and keeps what was picked', () => {
    mount();
    zoomTo(3.6);
    tap([-120, 45]); // a 16 x 16 block: 256 squares
    expect(selectedCount()).toBe(256);

    tap([-100, 40]); // another 256 would pass the limit of 500

    expect(selectedCount()).toBe(256);
    expect(hasMatch(/the most at once is 500/)).toBe(true);
    expect(hasMatch(/pick a whole state instead/)).toBe(true);
  });

  it('Clear empties the picks and the warning', () => {
    mount();
    zoomTo(3.6);
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

  it('links to State overlays for whole states', () => {
    mount();
    act(() => pressableWith(renderer, 'State overlays').props.onPress());
    expect(onSeeOverlays).toHaveBeenCalled();
  });

  it('reports the view so the Downloads screen can put the map back where it was', () => {
    mount();
    zoomTo(9, [-114, 46]);
    expect(onViewChange).toHaveBeenLastCalledWith({ center: [-114, 46], zoom: 9 });
  });
});

describe('PickAreaTab: choosing what to save', () => {
  const openOptions = () => act(() => pressableWith(renderer, '2 · Choose what to save').props.onPress());

  it('folds the options into a bar under the map, which says what is chosen without opening it', () => {
    mount();

    expect(has('2 · Choose what to save')).toBe(true);
    expect(has('Public land + private shading · Topo map pictures (Maximum)')).toBe(true);
    // Not opened: none of the option rows are on screen.
    expect(has('Forest roads (MVUM)')).toBe(false);
    expect(has('Satellite')).toBe(false);
  });

  it('opens the options over the map, and Done folds them away again', () => {
    mount();
    openOptions();
    expect(has('Forest roads (MVUM)')).toBe(true);
    expect(has('Satellite')).toBe(true);
    expect(has('Done ▼')).toBe(true);

    act(() => pressableWith(renderer, 'Done').props.onPress());
    expect(has('Forest roads (MVUM)')).toBe(false);
  });

  it('tapping the dimmed area outside the sheet closes it too', () => {
    mount();
    openOptions();
    const backdrop = renderer.root.find(
      (n) => n.props.accessibilityLabel === 'Close the save options' && typeof n.props.onPress === 'function'
    );
    act(() => backdrop.props.onPress());
    expect(has('Forest roads (MVUM)')).toBe(false);
  });

  it('starts with public land and topo maps chosen, and remembers changes in the download options', () => {
    mount();
    expect(store.getState().selectedPackLayers).toEqual(['land']);
    expect(store.getState().selectedLayers).toEqual(['topo']);

    openOptions();
    act(() => pressableWith(renderer, 'Forest roads (MVUM)').props.onPress());
    act(() => pressableWith(renderer, 'Satellite').props.onPress());
    act(() => pressableWith(renderer, 'Public land + private shading').props.onPress());

    expect(store.getState().selectedPackLayers).toEqual(['mvum']);
    expect(store.getState().selectedLayers).toEqual(['topo', 'satellite']);
  });

  it('keeps the folded bar up to date as choices change', () => {
    mount();
    openOptions();
    act(() => pressableWith(renderer, 'Forest roads (MVUM)').props.onPress());
    act(() => pressableWith(renderer, 'Satellite').props.onPress());
    act(() => pressableWith(renderer, 'Standard').props.onPress());

    expect(has('Public land + private shading · Forest roads (MVUM) · Topo + Satellite map pictures (Standard)')).toBe(
      true
    );
  });

  it('says nothing is chosen when nothing is', () => {
    mount();
    act(() => {
      store.setState({ selectedLayers: [], selectedPackLayers: [] });
    });
    expect(has('Nothing chosen yet')).toBe(true);
  });

  it('offers detail levels only once a map picture is chosen, and shows their cost per square', () => {
    mount();
    openOptions();
    expect(has('Detail')).toBe(true);
    expect(hasMatch(/About .* per square for what you picked, at zoom 16/)).toBe(true);

    act(() => pressableWith(renderer, 'Standard').props.onPress());
    expect(store.getState().maxZoom).toBe(14);
    expect(has('About 6.0 MB per square for what you picked, at zoom 14.')).toBe(true);

    act(() => pressableWith(renderer, 'Topo').props.onPress());
    expect(has('Detail')).toBe(false);
  });

  it('the total stays on screen while the options are open, so each change shows its cost', () => {
    mount();
    tap();
    openOptions();
    expect(hasMatch(/^About .* · .* for land & trail data$/)).toBe(true);
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
        regions: [],
      })
    );
  });

  it('asks first when it is over a gigabyte, and only starts if confirmed', () => {
    let buttons: AlertButton[] | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, b) => void (buttons = b));
    mount();
    zoomTo(5.6);
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

describe('PickAreaTab: the crosshair and its Pick button', () => {
  const pickButton = (label: string) => pressableWith(renderer, label);

  it('has no button until the map has said where it is looking', () => {
    mount();
    expect(hasMatch(/^Pick (this|these)/)).toBe(false);
  });

  it('picks the square under the middle of the map, and the label says what it will do', () => {
    mount();
    zoomTo(10);
    expect(cursorBlock).toEqual({ ...blockAtBoise(1), size: 1 });

    act(() => pickButton('Pick this square').props.onPress());
    expect(store.getState().selectedCells).toEqual([lonLatToCell(...BOISE)]);

    expect(has('Remove this square')).toBe(true);
    act(() => pickButton('Remove this square').props.onPress());
    expect(selectedCount()).toBe(0);
  });

  it('picks a whole block when zoomed out, and counts the squares it will pick', () => {
    mount();
    zoomTo(6.6);

    expect(has('Pick these 4 squares')).toBe(true);
    act(() => pickButton('Pick these 4 squares').props.onPress());
    expect(selectedCount()).toBe(4);
    expect(has('Remove these 4 squares')).toBe(true);
  });

  it('follows the map: panning to another block moves the crosshair’s block', () => {
    mount();
    zoomTo(10);
    const first = cursorBlock;
    zoomTo(10, [-112, 46]);
    expect(cursorBlock).not.toEqual(first);
    expect(cursorBlock?.size).toBe(1);
  });

  it('offers to finish a block that is only partly picked', () => {
    mount();
    zoomTo(6.6);
    tap();
    act(() => store.getState().setSelectedCells(store.getState().selectedCells.slice(0, 2)));

    expect(has('Pick the rest')).toBe(true);
    act(() => pickButton('Pick the rest').props.onPress());
    expect(selectedCount()).toBe(4);
  });

  it('is off over the ocean, and says so', () => {
    mount();
    zoomTo(10, [-128.5, 40.5]);

    expect(has('No US land here')).toBe(true);
    expect(pickButton('No US land here').props.disabled).toBe(true);
  });
});

describe('PickAreaTab: picking a whole state', () => {
  const openStates = () => act(() => pressableWith(renderer, 'Pick a whole state…').props.onPress());
  const idahoCells = US_STATE_CELLS.cellsOf('ID');

  it('offers the states in a list', () => {
    mount();
    openStates();
    expect(has('Idaho')).toBe(true);
    expect(has('Wyoming')).toBe(true);
    expect(has(`${idahoCells.length} squares`)).toBe(true);
  });

  it('picks every square of the state and flies the map to it', () => {
    mount();
    const flyTo = jest.fn();
    mapProps.cameraRef.current = { flyTo };
    openStates();

    act(() => pressableWith(renderer, 'Idaho').props.onPress());

    expect(selectedCount()).toBe(idahoCells.length);
    expect(flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: expect.any(Array), zoom: expect.any(Number) })
    );
    expect(hasMatch(/^Whole state: Idaho\./)).toBe(true);
    expect(hasMatch(new RegExp(`^${idahoCells.length} squares picked · about `))).toBe(true);
  });

  it('a state picked whole is added to what was already picked, not swapped for it', () => {
    mount();
    tap([-120, 47]); // somewhere in Washington
    const before = selectedCount();
    openStates();
    act(() => pressableWith(renderer, 'Idaho').props.onPress());
    expect(selectedCount()).toBeGreaterThan(idahoCells.length);
    expect(selectedCount()).toBeLessThanOrEqual(before + idahoCells.length);
  });

  it('tapping a picked state in the list puts it back', () => {
    mount();
    openStates();
    act(() => pressableWith(renderer, 'Idaho').props.onPress());
    expect(has('Picked ✓')).toBe(false); // the sheet closed

    openStates();
    expect(has('Picked ✓')).toBe(true);
    act(() => pressableWith(renderer, 'Idaho').props.onPress());
    expect(selectedCount()).toBe(0);
  });

  it('lets a state through however big it is — Alaska is thousands of squares — where hand-picking stops at 500', () => {
    mount();
    openStates();
    act(() => pressableWith(renderer, 'Alaska').props.onPress());
    expect(selectedCount()).toBe(US_STATE_CELLS.cellsOf('AK').length);
    expect(selectedCount()).toBeGreaterThan(500);
  });

  it('does not count a picked state against the cap on squares picked by hand', () => {
    mount();
    openStates();
    act(() => pressableWith(renderer, 'Texas').props.onPress());
    const texas = selectedCount();

    tap([-116.2, 43.6]); // a single square in Idaho
    expect(selectedCount()).toBe(texas + 1);
    expect(hasMatch(/the most at once/)).toBe(false);
  });

  it('still refuses hand-picking past 500 squares on top of a whole state', () => {
    mount();
    openStates();
    act(() => pressableWith(renderer, 'Idaho').props.onPress());
    zoomTo(3.6);
    tap([-100, 40]); // 256 squares: fine
    tap([-90, 40]); // another 256: past 500 beside the state
    expect(hasMatch(/besides the whole states — the most at once is 500/)).toBe(true);
  });

  it('says when the state is there in the list because the State overlays pack has its land and trail data', () => {
    mount([], 10, ready([idahoRegion()]));
    openStates();
    expect(has(`${idahoCells.length} squares · overlay pack ready`)).toBe(true);
  });

  it('downloads the state’s land data from its State overlays pack, map pictures square by square', () => {
    const region = idahoRegion(['land']);
    mount([], 10, ready([region]));
    openStates();
    act(() => pressableWith(renderer, 'Idaho').props.onPress());

    expect(hasMatch(/installs from the state overlay pack/)).toBe(true);
    // A whole state of topo maps is well over a gigabyte, so it asks first.
    let buttons: AlertButton[] | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, b) => void (buttons = b));
    act(() => headerButton().props.onPress());
    act(() => buttons?.find((b) => b.text === 'Download')?.onPress?.());

    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ regions: [region], packLayers: ['land'], tileLayers: ['topo'] })
    );
  });

  it('does not pass a pack for a state that is only partly picked', () => {
    mount([], 10, ready([idahoRegion()]));
    tap([-116.2, 43.6]);
    act(() => headerButton().props.onPress());
    expect(startDownload).toHaveBeenCalledWith(expect.objectContaining({ regions: [] }));
  });

  it('without a published pack the state is fetched square by square, and the screen does not claim otherwise', () => {
    mount([], 10, ready([]));
    openStates();
    act(() => pressableWith(renderer, 'Idaho').props.onPress());
    expect(hasMatch(/^Whole state: Idaho\.$/)).toBe(true);
    expect(hasMatch(/installs from the state overlay pack/)).toBe(false);
  });

  it('waits a moment while the pack list is still loading, then lets it start', () => {
    mount([], 10, { status: 'loading' });
    openStates();
    act(() => pressableWith(renderer, 'Idaho').props.onPress());
    expect(has('Checking for state overlay packs…')).toBe(true);
    expect(headerButton().props.disabled).toBe(true);
  });

  it('does not wait for the pack list when only map pictures are being saved', () => {
    mount([], 10, { status: 'loading' });
    act(() => {
      store.setState({ selectedPackLayers: [] });
    });
    openStates();
    act(() => pressableWith(renderer, 'Idaho').props.onPress());
    expect(has('Checking for state overlay packs…')).toBe(false);
  });
});

/** The block-grid coordinates of the block Boise is in, at a block size. */
function blockAtBoise(size: number) {
  const { cx, cy } = lonLatToCell(...BOISE);
  return { bx: Math.floor(cx / size), by: Math.floor(cy / size) };
}
