import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Position } from 'geojson';

import { renderedTexts } from '../../testing/renderHelpers';
import { useSettingsStore } from '../../state/useSettingsStore';
import type { TrackSamples } from '../../features/trackStats';
import { TrackDashboard } from './TrackDashboard';

// The theme reads the appearance setting from expo-sqlite's key-value store, which jest can't load.
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const M_PER_DEG_LAT = 111194.9;
// 1 km due north in 21 points, 30 s apart, climbing 2 m each (40 m total): 10 minutes.
const coordinates: Position[] = Array.from({ length: 21 }, (_, i) => [-116, 43 + (i * 50) / M_PER_DEG_LAT]);
const samples: TrackSamples = {
  times: Array.from({ length: 21 }, (_, i) => Date.UTC(2026, 8, 24, 17, 0, 0) + i * 30_000),
  elevations: Array.from({ length: 21 }, (_, i) => 1500 + i * 2),
};

let renderer: ReactTestRenderer;
const mount = (props: Partial<Parameters<typeof TrackDashboard>[0]> = {}) =>
  act(() => void (renderer = create(<TrackDashboard coordinates={coordinates} samples={samples} recorded {...props} />)));
const texts = () => renderedTexts(renderer);

// A still-mounted tree would be re-rendered outside act() by the next test's settings change.
afterEach(() => act(() => renderer?.unmount()));

beforeEach(() => {
  act(() => {
    useSettingsStore.setState({ units: 'imperial' });
  });
});

describe('TrackDashboard', () => {
  it('shows distance, time, moving time and average speed in imperial units', () => {
    mount();
    const all = texts();
    expect(all).toContain('0.62 mi');
    expect(all).toContain('10:00');
    expect(all.filter((t) => t === '10:00')).toHaveLength(2); // Time and Moving time
    expect(all).toContain('Avg speed');
    expect(all).toContain('3.7 mph');
  });

  it('follows the metric setting', () => {
    act(() => {
    useSettingsStore.setState({ units: 'metric' });
  });
    mount();
    const all = texts();
    expect(all).toContain('1.00 km');
    expect(all).toContain('6.0 km/h');
    expect(all).toContain('Elevation (m)');
  });

  it('shows climb, descent, high and low point', () => {
    mount();
    const all = texts();
    expect(all).toContain('Climb');
    expect(all).toContain('Descent');
    expect(all).toContain('High point');
    expect(all).toContain('Low point');
    expect(all.some((t) => /^\+\d+ ft$/.test(t))).toBe(true);
    expect(all).toContain('0 ft'); // a climb-only track has no descent, and no "-0"
  });

  it('draws both charts when there is time and elevation', () => {
    mount();
    const all = texts();
    expect(all).toContain('Elevation (ft)');
    expect(all).toContain('Distance over time (mi)');
    expect(all.some((t) => t.startsWith('Elevation is GPS altitude'))).toBe(true);
  });

  it('offers a time / distance axis for the elevation chart and switches it', async () => {
    mount();
    expect(texts()).toContain('Elevation (ft)');
    const distanceChip = renderer.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((c) => c.children.includes('Distance')).length > 0)[0];
    await act(async () => distanceChip.props.onPress());
    expect(texts()).toContain('Elevation (ft)'); // same title, different x axis
  });

  it('with no samples on a recorded track, shows distance only and explains why', () => {
    mount({ samples: null });
    const all = texts();
    expect(all).toContain('0.62 mi');
    expect(all).not.toContain('Time');
    expect(all).not.toContain('Climb');
    expect(all).not.toContain('Distance over time (mi)');
    expect(all).toContain('No elevation was recorded for this track.');
    expect(all).toContain('This track was saved before times were recorded, so only its distance is available.');
  });

  it('words the missing-data notes differently for an imported file', () => {
    mount({ samples: null, recorded: false });
    const all = texts();
    expect(all).toContain('This file had no elevation data.');
    expect(all.some((t) => t.startsWith('This file had no timestamps'))).toBe(true);
  });

  it('without times, charts elevation over distance and skips the distance-over-time chart', () => {
    mount({ samples: { times: null, elevations: samples.elevations } });
    const all = texts();
    expect(all).toContain('Elevation over distance (ft)');
    expect(all).not.toContain('Distance over time (mi)');
    expect(all).not.toContain('Elevation over');
  });

  it('flags samples that no longer match the line', () => {
    mount({ coordinates: coordinates.slice(0, 10) });
    expect(texts().some((t) => t.includes('no longer line up'))).toBe(true);
  });

  it('says when the recording started', () => {
    mount();
    expect(texts().some((t) => t.startsWith('Recorded '))).toBe(true);
  });

  describe('while a recording is still going (live)', () => {
    it('waits for GPS until there are two points', () => {
      mount({ coordinates: coordinates.slice(0, 1), samples: { times: samples.times!.slice(0, 1), elevations: samples.elevations!.slice(0, 1) }, live: true });
      const all = texts();
      expect(all.some((t) => t.startsWith('Waiting for GPS'))).toBe(true);
      expect(all).not.toContain('Distance');
    });

    it('does not say when it was recorded, and does not explain missing data as if it were final', () => {
      mount({ samples: null, live: true });
      const all = texts();
      expect(all.some((t) => t.startsWith('Recorded '))).toBe(false);
      expect(all).toContain('Elevation appears once your phone reports altitude.');
      expect(all.some((t) => t.includes('saved before times'))).toBe(false);
    });

    it('shows the full stats and charts once there is data', () => {
      mount({ live: true });
      const all = texts();
      expect(all).toContain('Climb');
      expect(all).toContain('Distance over time (mi)');
    });
  });
});
