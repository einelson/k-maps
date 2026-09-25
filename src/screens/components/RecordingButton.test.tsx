import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useSettingsStore } from '../../state/useSettingsStore';
import { useTrackRecordingStore } from '../../state/useTrackRecordingStore';
import { renderedTexts } from '../../testing/renderHelpers';
import { RecordingButton } from './RecordingButton';

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const NOW = Date.UTC(2026, 8, 24, 17, 0, 0);
const onPress = jest.fn();
const mount = () => act(() => void (renderer = create(<RecordingButton onPress={onPress} />)));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  onPress.mockClear();
  act(() => {
    useSettingsStore.setState({ units: 'imperial' });
    useTrackRecordingStore.setState({ recording: true, startedAt: NOW - 65_000, distanceM: 1609.344, interrupted: false });
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  act(() => useTrackRecordingStore.getState().reset());
  jest.useRealTimers();
});

describe('RecordingButton', () => {
  it('shows the elapsed time and distance so far', () => {
    mount();
    expect(renderedTexts(renderer)).toContain('1:05 · 1.00 mi');
  });

  it('ticks forward every second', () => {
    mount();
    act(() => void jest.advanceTimersByTime(3000));
    expect(renderedTexts(renderer)).toContain('1:08 · 1.00 mi');
  });

  it('picks up new distance as fixes arrive', () => {
    mount();
    act(() => useTrackRecordingStore.setState({ distanceM: 3218.688 }));
    expect(renderedTexts(renderer)).toContain('1:05 · 2.00 mi');
  });

  it('uses metric units when chosen', () => {
    act(() => {
      useSettingsStore.setState({ units: 'metric' });
    });
    mount();
    expect(renderedTexts(renderer)).toContain('1:05 · 1.61 km');
  });

  it('is a button that opens the panel when pressed', () => {
    mount();
    const button = renderer.root.findByProps({ accessibilityRole: 'button' });
    act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(button.props.accessibilityLabel).toBe('Recording a track — show track stats');
  });

  it('says so, for screen readers, when location updates have stopped', () => {
    act(() => useTrackRecordingStore.setState({ interrupted: true }));
    mount();
    expect(renderer.root.findByProps({ accessibilityRole: 'button' }).props.accessibilityLabel).toBe(
      'Recording stopped — show track stats'
    );
  });

  it('renders nothing when no recording has started', () => {
    act(() => useTrackRecordingStore.setState({ startedAt: null }));
    mount();
    expect(renderer.toJSON()).toBeNull();
  });

  it('stops its timer when it unmounts', () => {
    mount();
    act(() => renderer.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });
});
