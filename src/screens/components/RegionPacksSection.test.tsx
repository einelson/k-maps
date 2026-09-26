import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { CoverageRow } from '../../data/types';
import type { ManifestState } from '../../downloads/useRegionManifest';
import type { RegionEntry } from '../../packs/regionPacks';
import { press, pressableWith, renderedTexts, settle } from '../../testing/renderHelpers';
import { useRegionPackStore } from '../../state/useRegionPackStore';
import { RegionPacksSection } from './RegionPacksSection';

const mockInstall = jest.fn();
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('../../downloads/regionPackInstaller', () => ({
  installRegionPack: (options: unknown) => mockInstall(options),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS = { land: 'Public land + private shading', osm: 'Roads & trails (OSM)', poi: 'POI pins' };
const CELLS: [number, number][] = [
  [100, 100],
  [101, 100],
  [102, 100],
];

const montana: RegionEntry = {
  id: 'montana',
  name: 'Montana',
  cells: CELLS,
  packs: [
    { layer: 'land', file: 'montana-land.zip', bytes: 15_000_000, version: 'v-land' },
    { layer: 'osm', file: 'montana-osm-1.zip', bytes: 40_000_000, version: 'v-osm', cells: CELLS.slice(0, 2) },
    { layer: 'osm', file: 'montana-osm-2.zip', bytes: 20_000_000, version: 'v-osm', cells: CELLS.slice(2) },
  ],
};
const wyoming: RegionEntry = {
  id: 'wyoming',
  name: 'Wyoming',
  cells: [[200, 200]],
  packs: [{ layer: 'land', file: 'wyoming-land.zip', bytes: 5_000_000, version: 'v1' }],
};

const ready = (...regions: RegionEntry[]): ManifestState => ({
  status: 'ready',
  manifest: { format: 2, regions, huntUnits: [] },
});
const complete = (layer: string, cells: [number, number][]): CoverageRow[] =>
  cells.map(([cx, cy]) => ({
    layer,
    cell_x: cx,
    cell_y: cy,
    max_zoom: 0,
    status: 'complete',
    bytes: 1,
    updated_at: 0,
  }));

let renderer: ReactTestRenderer;
const onChanged = jest.fn(async () => {});
const texts = () => renderedTexts(renderer);
const has = (text: string) => texts().includes(text);
const hasMatch = (re: RegExp) => texts().some((t) => re.test(t));

function mount(manifest: ManifestState, coverage: CoverageRow[] = []) {
  act(
    () =>
      void (renderer = create(
        <RegionPacksSection
          manifest={manifest}
          onRetry={jest.fn()}
          coverage={coverage}
          labels={LABELS}
          onChanged={onChanged}
        />
      ))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInstall.mockResolvedValue({ cells: 0, bytes: 0, keptNewer: 0 });
  useRegionPackStore.setState(useRegionPackStore.getInitialState(), true);
});
afterEach(() => act(() => renderer.unmount()));

describe('RegionPacksSection', () => {
  it('lists states folded, each with what a full download of it costs', () => {
    mount(ready(montana, wyoming));

    expect(has('Montana')).toBe(true);
    expect(has('Wyoming')).toBe(true);
    expect(has('75 MB')).toBe(true); // 15 + 40 + 20 = 75 MB
    expect(has('5.0 MB')).toBe(true);
    expect(has(LABELS.land)).toBe(false); // folded: no layer rows until opened
  });

  it('opens a state on tap to show its layers, one row per layer however many parts it has', async () => {
    mount(ready(montana));

    await press(renderer, 'Montana');

    expect(has(LABELS.land)).toBe(true);
    expect(texts().filter((t) => t === LABELS.osm)).toHaveLength(1); // two zips, one row
    expect(hasMatch(/60 MB download/)).toBe(true); // the parts' sizes added up: 40 + 20
  });

  it('opens by itself once anything from the state is on the phone', () => {
    mount(ready(montana, wyoming), complete('land', CELLS));

    expect(has(LABELS.land)).toBe(true); // Montana is open
    expect(has('Installed ✓')).toBe(true);
    expect(hasMatch(/1 of 2 on phone/)).toBe(true);
    // Wyoming has nothing on the phone, so it stays folded: its only layer row is not shown twice.
    expect(texts().filter((t) => t === LABELS.land)).toHaveLength(1);
  });

  it('a layer split into parts installs every part in order and counts as one install', async () => {
    mount(ready(montana));
    await press(renderer, 'Montana');
    const versions: string[] = [];
    mockInstall.mockImplementation(async ({ pack }) => void versions.push(pack.file));

    await act(async () => {
      // The second "Download" button in the list is the OSM row's (land is first).
      const buttons = renderer.root.findAll(
        (n) => typeof n.props.onPress === 'function' && n.props.children?.props?.children === 'Download'
      );
      await buttons[1].props.onPress();
    });
    await settle();

    expect(versions).toEqual(['montana-osm-1.zip', 'montana-osm-2.zip']);
    expect(useRegionPackStore.getState().installed).toEqual({ 'montana:osm': 'v-osm' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('does not record the layer as installed when a part fails, and says which', async () => {
    mount(ready(montana));
    await press(renderer, 'Montana');
    mockInstall.mockImplementation(async ({ pack }) => {
      if (pack.file === 'montana-osm-2.zip') throw new Error('Connection lost');
    });

    await act(async () => {
      const buttons = renderer.root.findAll(
        (n) => typeof n.props.onPress === 'function' && n.props.children?.props?.children === 'Download'
      );
      await buttons[1].props.onPress();
    });
    await settle();

    expect(useRegionPackStore.getState().installed).toEqual({});
    expect(has('Montana Roads & trails (OSM): Connection lost')).toBe(true);
  });

  it('"Download everything" installs each missing layer and skips what is already there', async () => {
    const withPins: RegionEntry = {
      ...montana,
      packs: [...montana.packs, { layer: 'poi', file: 'montana-poi.zip', bytes: 100_000, version: 'v-poi' }],
    };
    mount(ready(withPins), complete('land', CELLS));
    const files: string[] = [];
    mockInstall.mockImplementation(async ({ pack }) => void files.push(pack.file));

    await press(renderer, /Download everything not on the phone/);

    expect(files).toEqual(['montana-osm-1.zip', 'montana-osm-2.zip', 'montana-poi.zip']); // land was already there
    expect(useRegionPackStore.getState().installed).toEqual({ 'montana:osm': 'v-osm', 'montana:poi': 'v-poi' });
  });

  it('shows a message, and a retry, when the list could not be loaded', () => {
    mount({ status: 'error', message: "Couldn't load the region pack list" });

    expect(has("Couldn't load the region pack list")).toBe(true);
    expect(pressableWith(renderer, 'Try again')).toBeTruthy();
  });

  it('says so when no state is ready', () => {
    mount(ready());
    expect(hasMatch(/No states are ready yet/)).toBe(true);
  });
});
