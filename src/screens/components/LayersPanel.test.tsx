import { Switch } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { OVERLAY_GROUPS, OVERLAYS } from '../../map/layerOptions';
import { useLayersStore } from '../../state/useLayersStore';
import { LayersPanel } from './LayersPanel';

// The theme reads the appearance setting from expo-sqlite's key-value store, which jest can't load; the panel doesn't care.
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));

// React 19's act() only works when told it's in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;

function mount(props: Partial<Parameters<typeof LayersPanel>[0]> = {}) {
  act(() => {
    renderer = create(
      <LayersPanel top={80} bottomClearance={100} onOpenAdvanced={() => undefined} onOpenDownloads={() => undefined} {...props} />
    );
  });
}

/** Every string rendered anywhere in the tree. */
function texts(): string[] {
  const out: string[] = [];
  const walk = (node: ReturnType<ReactTestRenderer['toJSON']>) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    // JSX like `{count} on` renders as two sibling strings; a reader sees one label, so join them.
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

const header = (label: string): ReactTestInstance =>
  renderer.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(`${label},`))[0];

beforeEach(() => {
  useLayersStore.setState(useLayersStore.getInitialState(), true);
});

afterEach(() => {
  act(() => renderer.unmount());
});

describe('LayersPanel groups', () => {
  it('shows a heading for each group, in order', () => {
    mount();
    const rendered = texts();
    const positions = OVERLAY_GROUPS.map((g) => rendered.indexOf(g.label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('starts with the first group open and the groups with nothing on folded away', () => {
    mount();
    const rendered = texts();
    expect(rendered).toContain('Public land');
    expect(rendered).toContain('Hunting units');
    expect(rendered).not.toContain('Weather radar');
    expect(rendered).not.toContain('Wetlands (NWI)');
    expect(rendered).not.toContain('USFS trails');
  });

  it('a tap on a heading opens it (and another tap folds it away again)', () => {
    mount();
    act(() => header('Hazards & conditions').props.onPress());
    expect(texts()).toEqual(expect.arrayContaining(['Wildfire perimeters', 'Weather radar']));
    act(() => header('Hazards & conditions').props.onPress());
    expect(texts()).not.toContain('Weather radar');
  });

  it('opens a group at the start when one of its layers is already on, with an "N on" badge', () => {
    act(() => useLayersStore.getState().setOverlayVisible('wildfire', true));
    act(() => useLayersStore.getState().setOverlayVisible('nhd', true));
    act(() => useLayersStore.getState().setOverlayVisible('slopeAngle', true));
    mount();
    const rendered = texts();
    expect(rendered).toEqual(expect.arrayContaining(['Wildfire perimeters', 'Water (NHD)', 'Slope angle']));
    expect(rendered).toContain('2 on'); // land: public land + likely-private shading are on by default
    expect(rendered).toContain('1 on'); // hazards: wildfire
    expect(rendered.filter((t) => t === '2 on')).toHaveLength(2); // ...and terrain: NHD + slope
    expect(rendered).not.toContain('USFS trails'); // roads had nothing on, so it starts folded
  });

  it('every overlay is reachable: expanding all the groups lists all of them once', () => {
    mount();
    for (const group of OVERLAY_GROUPS.slice(1)) act(() => header(group.label).props.onPress());
    const rendered = texts();
    for (const overlay of OVERLAYS) expect(rendered.filter((t) => t === overlay.label)).toHaveLength(1);
  });

  it('flipping a switch turns just that overlay on', () => {
    mount();
    act(() => header('Water & terrain').props.onPress());
    const before = { ...useLayersStore.getState().overlayVisibility };
    // Switches render in overlay order: land group (5) come first, then roads is folded, so terrain starts at index 5.
    const switches = renderer.root.findAllByType(Switch);
    const labels = OVERLAYS.filter((o) => o.group === 'land' || o.group === 'terrain').map((o) => o.id);
    const slopeIndex = labels.indexOf('slopeAngle');
    act(() => switches[slopeIndex].props.onValueChange(true));
    const after = useLayersStore.getState().overlayVisibility;
    expect(after.slopeAngle).toBe(true);
    for (const id of Object.keys(before) as (keyof typeof before)[]) {
      if (id !== 'slopeAngle') expect(after[id]).toBe(before[id]);
    }
  });

  it('marks live-service layers "online"', () => {
    mount();
    act(() => header('Hazards & conditions').props.onPress());
    expect(texts()).toContain('online'); // radar
  });
});

describe('LayersPanel download links', () => {
  const links = () => renderer.root.findAll((n) => n.props.accessibilityRole === 'link' && typeof n.props.onPress === 'function');

  it('offers a link to Downloads under Hunting units that opens the Downloads screen', () => {
    const onOpenDownloads = jest.fn();
    mount({ onOpenDownloads });
    expect(texts()).toContain('Download hunting units for your state →');
    expect(links()).toHaveLength(OVERLAYS.filter((o) => o.downloadsLink && o.group === 'land').length);
    act(() => links()[0].props.onPress());
    expect(onOpenDownloads).toHaveBeenCalledTimes(1);
  });

  it('only overlays that define a link get one', () => {
    mount();
    for (const group of OVERLAY_GROUPS.slice(1)) act(() => header(group.label).props.onPress());
    expect(links()).toHaveLength(OVERLAYS.filter((o) => o.downloadsLink).length);
  });
});
