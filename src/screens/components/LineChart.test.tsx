import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Path, Text as SvgText } from 'react-native-svg';

import { renderedTexts } from '../../testing/renderHelpers';
import { LineChart } from './LineChart';

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const xs = Array.from({ length: 50 }, (_, i) => i);
const ys = xs.map((x) => 100 + Math.sin(x / 5) * 20);

let renderer: ReactTestRenderer;
const props = { title: 'Elevation (ft)', color: '#2f6f4f', formatXTick: (x: number) => `${x}m`, formatYTick: (y: number) => String(Math.round(y)) };

function mount(overrides: Partial<Parameters<typeof LineChart>[0]> = {}, width = 300) {
  act(() => void (renderer = create(<LineChart {...props} xs={xs} ys={ys} {...overrides} />)));
  // Nothing draws until the chart knows its width, which a real layout pass supplies.
  const holder = renderer.root.findAll((n) => typeof n.props.onLayout === 'function')[0];
  if (holder) act(() => holder.props.onLayout({ nativeEvent: { layout: { width, height: 150 } } }));
}
const responder = (): ReactTestInstance => renderer.root.findAll((n) => typeof n.props.onResponderGrant === 'function')[0];
afterEach(() => act(() => renderer?.unmount()));

const touch = (x: number) => ({ nativeEvent: { locationX: x } });

describe('LineChart', () => {
  it('draws the area and the line once it has a width', () => {
    mount();
    const paths = renderer.root.findAllByType(Path);
    expect(paths).toHaveLength(2);
    expect(paths[0].props.d).toMatch(/Z$/); // the shaded area closes
    expect(paths[1].props.d).toMatch(/^M[\d.]+ [\d.]+ L/);
    expect(paths[1].props.stroke).toBe('#2f6f4f');
  });

  it('labels the axes with round ticks through the formatters', () => {
    mount();
    // Axis labels are SVG text, which the plain-text walker can't see.
    const labels = renderer.root.findAllByType(SvgText).map((n) => String(n.props.children));
    expect(labels.some((t) => /^\d+m$/.test(t))).toBe(true); // x ticks go through formatXTick
    expect(labels.some((t) => /^\d+$/.test(t))).toBe(true); // y ticks go through formatYTick
  });

  it('draws nothing but the title before it is laid out', () => {
    act(() => void (renderer = create(<LineChart {...props} xs={xs} ys={ys} />)));
    expect(renderer.root.findAllByType(Path)).toHaveLength(0);
    expect(renderedTexts(renderer)).toContain('Elevation (ft)');
  });

  it('thins a very long series but still draws a line', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => i);
    mount({ xs: many, ys: many.map((x) => Math.sin(x / 300) * 50) });
    const line = renderer.root.findAllByType(Path)[1].props.d as string;
    expect(line.split('L').length).toBeLessThan(260);
  });

  it('says there is not enough data for fewer than two known points', () => {
    mount({ xs: [0, 1, 2], ys: [null, 5, null] });
    expect(renderedTexts(renderer)).toContain('Not enough data to draw this chart.');
    expect(renderer.root.findAllByType(Path)).toHaveLength(0);
  });

  it('bridges gaps where the value is unknown', () => {
    mount({ xs: [0, 1, 2, 3], ys: [1, null, null, 4] });
    expect(renderer.root.findAllByType(Path)).toHaveLength(2);
  });

  it('copes with a flat series and a pinned baseline', () => {
    mount({ xs: [0, 1, 2], ys: [5, 5, 5], yMin: 0 });
    expect(renderer.root.findAllByType(Path)).toHaveLength(2);
  });

  it('shows a readout that follows a finger and clears on release', () => {
    mount({ formatYReadout: (y) => `${Math.round(y)} ft`, formatXReadout: (x) => `at ${x}` });
    expect(renderedTexts(renderer).some((t) => t.includes(' · '))).toBe(false);

    act(() => responder().props.onResponderGrant(touch(100)));
    const during = renderedTexts(renderer).find((t) => t.includes(' · '));
    expect(during).toMatch(/^\d+ ft · at \d+$/);

    act(() => responder().props.onResponderMove(touch(250)));
    const later = renderedTexts(renderer).find((t) => t.includes(' · '));
    expect(later).not.toBe(during);

    act(() => responder().props.onResponderRelease());
    expect(renderedTexts(renderer).some((t) => t.includes(' · '))).toBe(false);
  });

  it('clamps a touch left or right of the plot to the first and last point', () => {
    mount({ formatXReadout: (x) => `at ${x}`, formatYReadout: () => 'y' });
    act(() => responder().props.onResponderGrant(touch(-40)));
    expect(renderedTexts(renderer).find((t) => t.includes(' · '))).toBe('y · at 0');
    act(() => responder().props.onResponderMove(touch(9999)));
    expect(renderedTexts(renderer).find((t) => t.includes(' · '))).toBe('y · at 49');
  });

  it('clears the readout when the gesture is taken over (e.g. by scrolling)', () => {
    mount();
    act(() => responder().props.onResponderGrant(touch(100)));
    act(() => responder().props.onResponderTerminate());
    expect(renderedTexts(renderer).some((t) => t.includes(' · '))).toBe(false);
  });
});
