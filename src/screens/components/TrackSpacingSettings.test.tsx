import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DEFAULT_FIX_SPACING_M } from '../../features/transport';
import { useSettingsStore } from '../../state/useSettingsStore';
import { pressableWith, renderedTexts } from '../../testing/renderHelpers';
import { TrackSpacingSettings, pointsPerDistance } from './TrackSpacingSettings';

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const texts = () => renderedTexts(renderer);
const spacing = () => useSettingsStore.getState().trackSpacingM;
/** The button (or pressable text) carrying this label; the steppers only show "−" and "+", so they are found by accessibility label. */
const byLabel = (label: string) => {
  const found = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
  );
  return found.length > 0 ? found[found.length - 1] : pressableWith(renderer, label);
};
const press = (label: string) => act(() => byLabel(label).props.onPress());

function mount(units: 'imperial' | 'metric' = 'metric') {
  act(() => {
    useSettingsStore.setState({ units });
    useSettingsStore.getState().resetTrackSpacing();
  });
  act(() => void (renderer = create(<TrackSpacingSettings />)));
}

afterEach(() => act(() => renderer?.unmount()));

describe('TrackSpacingSettings', () => {
  it('lists every way of getting around at its default, with what that means in points', () => {
    mount();
    const all = texts();
    expect(all).toEqual(expect.arrayContaining(['On foot', 'Horse', 'Bike', 'ATV / UTV', 'Vehicle', 'Boat', 'Other']));
    expect(all).toContain('5 m');
    expect(all).toContain('25 m');
    expect(all).toContain('≈ 200 points per km · default'); // 1000 m / 5 m
    expect(all).toContain('≈ 40 points per km · default'); // 1000 m / 25 m
  });

  it('shows distances in feet and points per mile for imperial', () => {
    mount('imperial');
    expect(texts()).toContain('16 ft'); // 5 m
    expect(texts()).toContain('≈ 322 points per mile · default'); // 1609 m / 5 m
  });

  it("steps a mode's spacing up and down, one ladder step at a time, leaving the others alone", () => {
    mount();
    press('Wider points for Horse');
    expect(spacing()).toEqual({ ...DEFAULT_FIX_SPACING_M, horse: 15 });
    press('Closer points for Horse');
    press('Closer points for Horse');
    expect(spacing().horse).toBe(8);
    expect(spacing().foot).toBe(5);
  });

  it('drops the "default" tag once a mode is changed', () => {
    mount();
    press('Wider points for On foot');
    expect(texts()).toContain('≈ 125 points per km'); // 1000 / 8, no longer the default
    expect(texts()).toContain('8 m');
  });

  it('disables the step buttons at the ends of the range', () => {
    mount();
    act(() => useSettingsStore.getState().setTrackSpacing('foot', 1));
    expect(byLabel('Closer points for On foot').props.disabled).toBe(true);
    act(() => useSettingsStore.getState().setTrackSpacing('foot', 100));
    expect(byLabel('Wider points for On foot').props.disabled).toBe(true);
  });

  it('offers "Reset to defaults" only when something has changed, and restores every mode', () => {
    mount();
    expect(texts()).not.toContain('Reset to defaults');
    press('Wider points for Vehicle');
    press('Closer points for On foot');
    expect(texts()).toContain('Reset to defaults');
    press('Reset to defaults');
    expect(spacing()).toEqual(DEFAULT_FIX_SPACING_M);
    expect(texts()).not.toContain('Reset to defaults');
  });
});

describe('pointsPerDistance', () => {
  it('is the number of points a stretch of distance costs at that spacing', () => {
    expect(pointsPerDistance(10, 'metric')).toBe('≈ 100 points per km');
    expect(pointsPerDistance(1, 'metric')).toBe('≈ 1,000 points per km');
    expect(pointsPerDistance(10, 'imperial')).toBe('≈ 161 points per mile');
  });
});
