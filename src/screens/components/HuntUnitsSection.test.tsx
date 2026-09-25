import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ManifestState } from '../../downloads/useRegionManifest';
import type { HuntUnitPackEntry } from '../../packs/regionPacks';
import { press, pressablesNamed, renderedTexts, settle } from '../../testing/renderHelpers';
import { useHuntUnitStore } from '../../state/useHuntUnitStore';
import { HuntUnitsSection } from './HuntUnitsSection';

const mockFilesOnDevice = new Set<string>();
let mockInstall: (pack: HuntUnitPackEntry) => Promise<number>;

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));
jest.mock('../../huntUnits/storage', () => ({
  huntUnitsExist: (state: string) => mockFilesOnDevice.has(state),
  deleteHuntUnits: jest.fn((state: string) => mockFilesOnDevice.delete(state)),
}));
// The disclaimer sheet needs a Modal and safe-area insets; its content is what's under test.
jest.mock('./BottomSheet', () => ({ BottomSheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null) }));
jest.mock('../../downloads/huntUnitInstaller', () => ({
  installHuntUnitPack: jest.fn(({ pack }: { pack: HuntUnitPackEntry }) => mockInstall(pack)),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pack = (state: string, name: string, over: Partial<HuntUnitPackEntry> = {}): HuntUnitPackEntry => ({
  state,
  name,
  agency: `${name} Wildlife Agency`,
  regsUrl: 'https://example.test/regs',
  vintage: '2026 season',
  file: `hunt-${state.toLowerCase()}.zip`,
  bytes: 1_500_000,
  version: 'v1',
  bbox: [-120, 40, -110, 46],
  unitCount: 69,
  sets: [{ id: 'wmu', label: 'Wildlife Management Units', count: 69 }],
  ...over,
});

const OREGON = pack('OR', 'Oregon');
const WYOMING = pack('WY', 'Wyoming', {
  unitCount: 405,
  bytes: 2_600_000,
  sets: [
    { id: 'elk', label: 'Elk Hunt Areas', count: 105 },
    { id: 'deer', label: 'Deer Hunt Areas', count: 126 },
  ],
});
const ready = (...huntUnits: HuntUnitPackEntry[]): ManifestState => ({ status: 'ready', manifest: { format: 1, regions: [], huntUnits } });

let renderer: ReactTestRenderer;
const onRetry = jest.fn();
const texts = () => renderedTexts(renderer);
const has = (text: string) => texts().includes(text);
const hasMatch = (re: RegExp) => texts().some((t) => re.test(t));

async function mount(manifest: ManifestState) {
  await act(async () => {
    renderer = create(<HuntUnitsSection manifest={manifest} onRetry={onRetry} />);
  });
  await settle();
}

beforeEach(() => {
  useHuntUnitStore.setState({ ...useHuntUnitStore.getInitialState(), disclaimerAccepted: true }, true); // most tests aren't about the disclaimer
  mockFilesOnDevice.clear();
  jest.clearAllMocks();
  mockInstall = async (p) => {
    mockFilesOnDevice.add(p.state);
    return 123_456;
  };
});
afterEach(() => act(() => renderer.unmount()));

describe('HuntUnitsSection', () => {
  it('shows Idaho as built in, then each published state with its size', async () => {
    await mount(ready(WYOMING, OREGON));
    expect(has('Idaho')).toBe(true);
    expect(has('Built in')).toBe(true);
    expect(hasMatch(/69 units · 1\.5 MB/)).toBe(true);
    expect(hasMatch(/405 units · 2\.6 MB/)).toBe(true);
    // alphabetical: Oregon before Wyoming
    const order = texts().filter((t) => t === 'Oregon' || t === 'Wyoming');
    expect(order).toEqual(['Oregon', 'Wyoming']);
  });

  it('downloads a state on tap and records it, then offers Remove', async () => {
    await mount(ready(OREGON));
    await press(renderer, 'Download');
    expect(useHuntUnitStore.getState().installed.OR).toMatchObject({ name: 'Oregon', version: 'v1', bytes: 123_456, agency: 'Oregon Wildlife Agency' });
    expect(has('Installed ✓')).toBe(true);
    expect(has('Remove')).toBe(true);
    expect(hasMatch(/on this device/)).toBe(true);
  });

  it('says a state is downloadable again when its file is gone even though a record remains', async () => {
    useHuntUnitStore.getState().markInstalled(OREGON, 1); // record, but no file on the device
    await mount(ready(OREGON));
    expect(has('Installed ✓')).toBe(false);
    expect(has('Download')).toBe(true);
  });

  it('offers an update when a newer version is published', async () => {
    useHuntUnitStore.getState().markInstalled(OREGON, 1);
    mockFilesOnDevice.add('OR');
    await mount(ready({ ...OREGON, version: 'v2' }));
    expect(has('Update')).toBe(true);
    expect(hasMatch(/newer version available/)).toBe(true);
    await press(renderer, 'Update');
    expect(useHuntUnitStore.getState().installed.OR.version).toBe('v2');
    expect(has('Installed ✓')).toBe(true);
  });

  it('lets you pick which species layer a multi-set state shows', async () => {
    useHuntUnitStore.getState().markInstalled(WYOMING, 1);
    mockFilesOnDevice.add('WY');
    await mount(ready(WYOMING));
    expect(has('Elk Hunt Areas')).toBe(true);
    expect(has('Deer Hunt Areas')).toBe(true);
    await press(renderer, 'Deer Hunt Areas');
    expect(useHuntUnitStore.getState().activeSets.WY).toBe('deer');
  });

  it('does not show a picker for a state with one set', async () => {
    useHuntUnitStore.getState().markInstalled(OREGON, 1);
    mockFilesOnDevice.add('OR');
    await mount(ready(OREGON));
    expect(has('Wildlife Management Units')).toBe(false);
  });

  it('asks before removing, then deletes the file and forgets the state', async () => {
    useHuntUnitStore.getState().markInstalled(OREGON, 1);
    mockFilesOnDevice.add('OR');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Remove')?.onPress?.();
    });
    await mount(ready(OREGON));
    await press(renderer, 'Remove');
    expect(alert).toHaveBeenCalledWith('Remove Oregon hunting units?', expect.stringMatching(/download them again/), expect.any(Array));
    expect(mockFilesOnDevice.has('OR')).toBe(false);
    expect(useHuntUnitStore.getState().installed.OR).toBeUndefined();
    expect(has('Download')).toBe(true);
    alert.mockRestore();
  });

  it('cancelling the removal keeps the state', async () => {
    useHuntUnitStore.getState().markInstalled(OREGON, 1);
    mockFilesOnDevice.add('OR');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await mount(ready(OREGON));
    await press(renderer, 'Remove');
    expect(useHuntUnitStore.getState().installed.OR).toBeDefined();
    expect(mockFilesOnDevice.has('OR')).toBe(true);
    alert.mockRestore();
  });

  it('shows why a download failed and stores nothing', async () => {
    mockInstall = async () => {
      throw new Error("Oregon hunting units didn't download correctly — try again");
    };
    await mount(ready(OREGON));
    await press(renderer, 'Download');
    expect(has("Oregon: Oregon hunting units didn't download correctly — try again")).toBe(true);
    expect(useHuntUnitStore.getState().installed.OR).toBeUndefined();
    expect(has('Download')).toBe(true); // can retry
  });

  it('Download all fetches every state not yet on the device, one after another', async () => {
    useHuntUnitStore.getState().markInstalled(OREGON, 1);
    mockFilesOnDevice.add('OR');
    const order: string[] = [];
    mockInstall = async (p) => {
      order.push(p.state);
      mockFilesOnDevice.add(p.state);
      return 10;
    };
    const washington = pack('WA', 'Washington');
    await mount(ready(OREGON, WYOMING, washington));
    expect(hasMatch(/Download all · 3\.\d MB|Download all · 4\.\d MB/)).toBe(true); // WA 1.5 + WY 2.6 = 4.1 MB (Oregon already there)
    await press(renderer, /^Download all/);
    expect(order).toEqual(['WA', 'WY']);
    expect(Object.keys(useHuntUnitStore.getState().installed).sort()).toEqual(['OR', 'WA', 'WY']);
  });

  it('a manifest failure offers a retry; an empty one says nothing is published', async () => {
    await mount({ status: 'error', message: "Couldn't load the region pack list — check your connection" });
    expect(has("Couldn't load the region pack list — check your connection")).toBe(true);
    await press(renderer, 'Try again');
    expect(onRetry).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    await mount(ready());
    expect(has('No other states have been published yet.')).toBe(true);
    expect(has('Idaho')).toBe(true); // the built-in state is still there
  });

  it('shows a loading note while the list is being fetched', async () => {
    await mount({ status: 'loading' });
    expect(has('Checking for more states…')).toBe(true);
  });

  it('a nothing-to-download state offers no "Download all" (a single pending state has its own button)', async () => {
    await mount(ready(OREGON));
    expect(hasMatch(/^Download all/)).toBe(false);
    expect(pressablesNamed(renderer, 'Download').length).toBe(1);
  });

  describe('the disclaimer', () => {
    beforeEach(() => useHuntUnitStore.setState({ disclaimerAccepted: false }));

    it('always shows a notice to check local laws and regulations', async () => {
      await mount(ready(OREGON));
      expect(has('Check your local laws and regulations')).toBe(true);
      expect(hasMatch(/reference only and may be out of date or inaccurate/)).toBe(true);
    });

    it('asks before the first download and downloads nothing until the hunter accepts', async () => {
      await mount(ready(OREGON));
      await press(renderer, 'Download');
      expect(has('I understand')).toBe(true);
      expect(hasMatch(/responsible for knowing where and when you may hunt/)).toBe(true);
      expect(useHuntUnitStore.getState().installed.OR).toBeUndefined();
      expect(mockFilesOnDevice.size).toBe(0);
    });

    it('accepting remembers it and starts the download that was waiting', async () => {
      await mount(ready(OREGON));
      await press(renderer, 'Download');
      await press(renderer, 'I understand');
      expect(useHuntUnitStore.getState().disclaimerAccepted).toBe(true);
      expect(useHuntUnitStore.getState().installed.OR).toBeDefined();
      expect(has('Installed ✓')).toBe(true);
      expect(has('I understand')).toBe(false);
    });

    it('"Not now" leaves everything untouched and asks again next time', async () => {
      await mount(ready(OREGON));
      await press(renderer, 'Download');
      await press(renderer, 'Not now');
      expect(useHuntUnitStore.getState().disclaimerAccepted).toBe(false);
      expect(useHuntUnitStore.getState().installed.OR).toBeUndefined();
      expect(has('I understand')).toBe(false);
      await press(renderer, 'Download');
      expect(has('I understand')).toBe(true);
    });

    it('once accepted, later downloads go straight through', async () => {
      useHuntUnitStore.setState({ disclaimerAccepted: true });
      await mount(ready(OREGON));
      await press(renderer, 'Download');
      expect(has('I understand')).toBe(false);
      expect(useHuntUnitStore.getState().installed.OR).toBeDefined();
    });

    it('Download all is gated too, then downloads every waiting state after acceptance', async () => {
      await mount(ready(OREGON, WYOMING));
      await press(renderer, /^Download all/);
      expect(has('I understand')).toBe(true);
      expect(Object.keys(useHuntUnitStore.getState().installed)).toEqual([]);
      await press(renderer, 'I understand');
      expect(Object.keys(useHuntUnitStore.getState().installed).sort()).toEqual(['OR', 'WY']);
    });
  });

  describe('old source data (edited 3+ years ago)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const OLD = '2020-03-04'; // always well over 3 years
    const withDate = (p: HuntUnitPackEntry, updated: string, over: Partial<HuntUnitPackEntry> = {}): HuntUnitPackEntry => ({
      ...p,
      ...over,
      sets: p.sets.map((set) => ({ ...set, updated })),
    });
    const OLD_OREGON = withDate(OREGON, OLD);
    const FRESH_WYOMING = withDate(WYOMING, today);

    it('makes the hunter accept the old-data notice before the download starts', async () => {
      await mount(ready(OLD_OREGON));
      await press(renderer, 'Download');
      expect(has('Some of this data is old')).toBe(true);
      expect(hasMatch(/Oregon · Wildlife Management Units: last edited Mar 4, 2020 \(\d+ years ago\)/)).toBe(true);
      expect(hasMatch(/3 or more years ago/)).toBe(true);
      expect(hasMatch(/Confirm the current boundaries/)).toBe(true);
      expect(has('I understand')).toBe(true);
      expect(useHuntUnitStore.getState().installed.OR).toBeUndefined(); // nothing downloaded yet
    });

    it('when the general disclaimer is already accepted, shows only the old-data notice', async () => {
      await mount(ready(OLD_OREGON));
      await press(renderer, 'Download');
      expect(hasMatch(/responsible for knowing where and when you may hunt/)).toBe(false);
      expect(has('Check your local laws and regulations')).toBe(true); // the section's persistent notice, not the sheet
    });

    it('accepting records exactly what was accepted and downloads', async () => {
      await mount(ready(OLD_OREGON));
      await press(renderer, 'Download');
      await press(renderer, 'I understand');
      expect(useHuntUnitStore.getState().staleAccepted.OR).toBe(`wmu:${OLD}`);
      expect(useHuntUnitStore.getState().installed.OR).toBeDefined();
    });

    it('declining downloads nothing, records nothing, and asks again', async () => {
      await mount(ready(OLD_OREGON));
      await press(renderer, 'Download');
      await press(renderer, 'Not now');
      expect(useHuntUnitStore.getState().staleAccepted).toEqual({});
      expect(useHuntUnitStore.getState().installed.OR).toBeUndefined();
      await press(renderer, 'Download');
      expect(has('Some of this data is old')).toBe(true);
    });

    it('shows both the general disclaimer and the old-data notice when neither has been accepted', async () => {
      useHuntUnitStore.setState({ disclaimerAccepted: false });
      await mount(ready(OLD_OREGON));
      await press(renderer, 'Download');
      expect(hasMatch(/responsible for knowing where and when you may hunt/)).toBe(true);
      expect(has('Some of this data is old')).toBe(true);
      await press(renderer, 'I understand');
      expect(useHuntUnitStore.getState().disclaimerAccepted).toBe(true);
      expect(useHuntUnitStore.getState().staleAccepted.OR).toBe(`wmu:${OLD}`);
    });

    it('a state with fresh data needs no old-data notice', async () => {
      await mount(ready(FRESH_WYOMING));
      await press(renderer, 'Download');
      expect(has('I understand')).toBe(false);
      expect(useHuntUnitStore.getState().installed.WY).toBeDefined();
    });

    it('a state whose agency publishes no date is not treated as old (the card says so separately)', async () => {
      await mount(ready(OREGON));
      await press(renderer, 'Download');
      expect(has('I understand')).toBe(false);
    });

    it('Download all lists only the old layers, and accepting downloads every state', async () => {
      await mount(ready(OLD_OREGON, FRESH_WYOMING));
      await press(renderer, /^Download all/);
      expect(hasMatch(/Oregon · Wildlife Management Units/)).toBe(true);
      expect(hasMatch(/Wyoming ·/)).toBe(false);
      await press(renderer, 'I understand');
      expect(Object.keys(useHuntUnitStore.getState().installed).sort()).toEqual(['OR', 'WY']);
      expect(Object.keys(useHuntUnitStore.getState().staleAccepted)).toEqual(['OR']); // nothing recorded for fresh data
    });

    it('lists every old layer of a multi-layer state by name', async () => {
      const mixed = withDate(WYOMING, OLD);
      mixed.sets = [{ ...mixed.sets[0], updated: OLD }, { ...mixed.sets[1], updated: today }];
      await mount(ready(mixed));
      await press(renderer, 'Download');
      expect(hasMatch(/Wyoming · Elk Hunt Areas: last edited Mar 4, 2020/)).toBe(true);
      expect(hasMatch(/Deer Hunt Areas: last edited/)).toBe(false); // that one is fresh
    });

    it('already-accepted old data is not asked about again (e.g. a retry after a failed download)', async () => {
      useHuntUnitStore.getState().acceptStale({ OR: `wmu:${OLD}` });
      await mount(ready(OLD_OREGON));
      await press(renderer, 'Download');
      expect(has('I understand')).toBe(false);
      expect(useHuntUnitStore.getState().installed.OR).toBeDefined();
    });

    it('removing a state resets its acceptance, so downloading it again asks again', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        buttons?.find((b) => b.text === 'Remove')?.onPress?.();
      });
      await mount(ready(OLD_OREGON));
      await press(renderer, 'Download');
      await press(renderer, 'I understand');
      await press(renderer, 'Remove');
      expect(useHuntUnitStore.getState().staleAccepted.OR).toBeUndefined();
      await press(renderer, 'Download');
      expect(has('Some of this data is old')).toBe(true);
      alert.mockRestore();
    });

    it('an update with newer data does not ask; one that is still old but a different date does', async () => {
      useHuntUnitStore.getState().markInstalled(OLD_OREGON, 1);
      useHuntUnitStore.getState().acceptStale({ OR: `wmu:${OLD}` });
      mockFilesOnDevice.add('OR');
      await mount(ready(withDate(OREGON, today, { version: 'v2' })));
      await press(renderer, 'Update');
      expect(has('I understand')).toBe(false); // fresh now
      act(() => renderer.unmount());
      useHuntUnitStore.getState().markInstalled(OLD_OREGON, 1);
      useHuntUnitStore.getState().acceptStale({ OR: `wmu:${OLD}` });
      await mount(ready(withDate(OREGON, '2020-09-09', { version: 'v3' })));
      await press(renderer, 'Update');
      expect(has('Some of this data is old')).toBe(true); // still old, but not what they accepted
    });

    it('warns in the list, in words, about a state with old data — and not about one without', async () => {
      await mount(ready(OLD_OREGON, FRESH_WYOMING));
      expect(hasMatch(/Old data: this layer was last edited \d+ years ago \(Mar 4, 2020\)/)).toBe(true);
      expect(texts().filter((t) => t.startsWith('Old data:'))).toHaveLength(1);
    });
  });
});

