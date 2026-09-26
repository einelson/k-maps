import { Switch } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { OVERLAY_GROUPS, OVERLAYS } from '../map/layerOptions';
import { SLOPE_CLASSES } from '../map/liveOverlays';
import { useLayersStore } from '../state/useLayersStore';
import { useWildfireStore } from '../state/useWildfireStore';
import { LayersScreen } from './LayersScreen';

// The theme reads the appearance setting from expo-sqlite's key-value store, which jest can't load; the screen doesn't care.
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// The wildfire store's on-device cache needs the native file system.
jest.mock('../packs/wildfireCache', () => ({ readWildfireSnapshot: jest.fn(async () => null), writeWildfireSnapshot: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const mount = () => act(() => void (renderer = create(<LayersScreen />)));

function texts(): string[] {
  const out: string[] = [];
  const walk = (node: ReturnType<ReactTestRenderer['toJSON']>) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    let run = '';
    for (const child of node.children ?? []) {
      if (typeof child === 'string') run += child;
      else walk(child);
    }
    if (run) out.push(run);
  };
  walk(renderer.toJSON());
  return out;
}

const on = (id: (typeof OVERLAYS)[number]['id']) => act(() => useLayersStore.getState().setOverlayVisible(id, true));

beforeEach(() => {
  mockNavigate.mockClear();
  useLayersStore.setState(useLayersStore.getInitialState(), true);
  useWildfireStore.setState({ collection: null, fetchedAt: null, status: 'idle', error: null });
});
afterEach(() => act(() => renderer.unmount()));

describe('LayersScreen groups', () => {
  it('has a section heading and blurb for every group, in order, with every overlay under its own group', () => {
    mount();
    const rendered = texts();
    let last = -1;
    for (const group of OVERLAY_GROUPS) {
      const at = rendered.indexOf(group.label);
      expect(at).toBeGreaterThan(last);
      expect(rendered).toContain(group.blurb);
      last = at;
      const next = OVERLAY_GROUPS[OVERLAY_GROUPS.indexOf(group) + 1];
      const end = next ? rendered.indexOf(next.label) : rendered.indexOf('Points of interest');
      for (const overlay of OVERLAYS.filter((o) => o.group === group.id)) {
        const pos = rendered.indexOf(overlay.label);
        expect(pos).toBeGreaterThan(at);
        expect(pos).toBeLessThan(end);
      }
    }
  });

  it('keeps Points of interest as its own section after the overlay groups', () => {
    mount();
    const rendered = texts();
    expect(rendered.indexOf('Points of interest')).toBeGreaterThan(rendered.indexOf('Hazards & conditions'));
  });

  it('shows a legend only while its overlay is on', () => {
    mount();
    expect(texts()).not.toContain(SLOPE_CLASSES[0].label);
    on('slopeAngle');
    expect(texts()).toEqual(expect.arrayContaining(SLOPE_CLASSES.map((c) => c.label)));
    act(() => useLayersStore.getState().setOverlayVisible('slopeAngle', false));
    expect(texts()).not.toContain(SLOPE_CLASSES[0].label);
  });

  it('shows the land-manager agency key when that layer is on', () => {
    mount();
    on('landManager');
    expect(texts()).toEqual(expect.arrayContaining(['BLM', 'US Forest Service', 'State']));
  });

  it('tells the user which overlays need a connection', () => {
    mount();
    expect(texts().filter((t) => t === 'online').length).toBe(OVERLAYS.filter((o) => o.onlineOnly).length);
  });
});

describe('wildfire freshness', () => {
  const T = Date.now();

  it('says it is loading before the first perimeters arrive', () => {
    mount();
    on('wildfire');
    expect(texts()).toContain('Loading current perimeters…');
  });

  it('says how old the perimeters on screen are', () => {
    useWildfireStore.setState({ fetchedAt: T - 3 * 60_000, status: 'idle' });
    mount();
    on('wildfire');
    expect(texts()).toContain('Updated 3 min ago.');
  });

  it('when a refresh fails it says it is showing the saved copy and how old that is', () => {
    useWildfireStore.setState({ fetchedAt: T - 2 * 3_600_000, status: 'error', error: 'Network request failed' });
    mount();
    on('wildfire');
    const line = texts().find((t) => t.startsWith('Offline?'));
    expect(line).toContain('Showing the copy from 2 h ago.');
    expect(line).toContain('Network request failed');
  });

  it('with no saved copy and no signal it says there is no data yet', () => {
    useWildfireStore.setState({ fetchedAt: null, status: 'error', error: 'offline' });
    mount();
    on('wildfire');
    const line = texts().find((t) => t.startsWith('No data yet'));
    expect(line).toBe('No data yet — could not reach NIFC. (offline)');
  });

  it('shows nothing about freshness while the layer is off', () => {
    useWildfireStore.setState({ fetchedAt: T - 60_000 });
    mount();
    expect(texts().some((t) => t.startsWith('Updated '))).toBe(false);
  });
});

describe('load-as-I-pan switch', () => {
  it('reflects and changes the setting', () => {
    mount();
    // The first Switches are: offline maps, name labels, load-as-I-pan.
    const switches = () => renderer.root.findAllByType(Switch);
    expect(switches()[2].props.value).toBe(true);
    act(() => switches()[2].props.onValueChange(false));
    expect(useLayersStore.getState().autoLoadOverlays).toBe(false);
    expect(switches()[2].props.value).toBe(false);
    expect(texts()).toContain('Load land data as I pan');
  });
});

describe('download links', () => {
  it('links Hunting units to the Downloads screen', () => {
    mount();
    expect(texts()).toContain('Download hunting units for your state →');
    const link = renderer.root.findAll((n) => n.props.accessibilityRole === 'link' && typeof n.props.onPress === 'function')[0];
    act(() => link.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Downloads');
  });
});
