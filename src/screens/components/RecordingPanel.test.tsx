import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useSettingsStore } from '../../state/useSettingsStore';
import { useTrackRecordingStore } from '../../state/useTrackRecordingStore';
import { pressableWith, renderedTexts } from '../../testing/renderHelpers';
import { RecordingPanel } from './RecordingPanel';

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 8, 24, 17, 0, 0);
const M_PER_DEG_LAT = 111194.9;
let renderer: ReactTestRenderer;
const onClose = jest.fn();
const onEnd = jest.fn();
const onDelete = jest.fn();

function mount(props: Partial<Parameters<typeof RecordingPanel>[0]> = {}) {
  act(
    () =>
      void (renderer = create(
        <RecordingPanel visible onClose={onClose} onEnd={onEnd} onDelete={onDelete} {...props} />
      ))
  );
}
const texts = () => renderedTexts(renderer);

function recordFixes(count: number) {
  act(() => {
    useTrackRecordingStore.getState().begin(NOW - 600_000);
    useTrackRecordingStore.getState().appendFixes(
      Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        time: NOW - 600_000 + i * 30_000,
        lon: -116,
        lat: 43 + (i * 50) / M_PER_DEG_LAT,
        altitude: 1500 + i * 2,
      }))
    );
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  [onClose, onEnd, onDelete].forEach((f) => f.mockClear());
  act(() => {
    useSettingsStore.setState({ units: 'imperial' });
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  act(() => useTrackRecordingStore.getState().reset());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('RecordingPanel', () => {
  it('shows the live clock and distance, and the same stats a saved track has', () => {
    recordFixes(21);
    mount();
    const all = texts();
    expect(all).toContain('Recording track');
    expect(all).toContain('10:00'); // hero clock: now minus the start
    expect(all).toContain('0.62 mi');
    expect(all).toContain('Avg speed');
    expect(all).toContain('Climb');
    expect(all).toContain('Elevation (ft)');
    expect(all).toContain('Distance over time (mi)');
  });

  it('keeps counting up while open', () => {
    recordFixes(21);
    mount();
    act(() => void jest.advanceTimersByTime(5000));
    expect(texts()).toContain('10:05');
  });

  it('asks the user to wait for GPS before there are two points', () => {
    recordFixes(1);
    mount();
    expect(texts().some((t) => t.startsWith('Waiting for GPS'))).toBe(true);
    expect(texts()).not.toContain('Climb');
  });

  it('shows nothing about missing data while it is still arriving', () => {
    recordFixes(3);
    mount();
    const all = texts();
    expect(all.some((t) => t.includes('saved before times'))).toBe(false);
    expect(all.some((t) => t.includes('was recorded for this track'))).toBe(false);
  });

  it('End & save calls onEnd', () => {
    recordFixes(5);
    mount();
    act(() => pressableWith(renderer, 'End & save').props.onPress());
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('Delete asks first, naming what will be lost, and only deletes when confirmed', () => {
    recordFixes(21);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mount();
    act(() => pressableWith(renderer, 'Delete').props.onPress());

    expect(onDelete).not.toHaveBeenCalled();
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Delete this recording?');
    expect(message).toContain('0.62 mi');
    const byText = (text: string) => (buttons as AlertButton[]).find((b) => b.text === text)!;

    act(() => byText('Keep recording').onPress?.());
    expect(onDelete).not.toHaveBeenCalled();
    act(() => byText('Delete').onPress?.());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while an end or delete is in flight', () => {
    recordFixes(5);
    mount({ busy: true });
    expect(pressableWith(renderer, 'End & save').props.disabled).toBe(true);
    expect(pressableWith(renderer, 'Delete').props.disabled).toBe(true);
  });

  it('warns, and still offers save and delete, when location updates have stopped', () => {
    recordFixes(5);
    act(() => useTrackRecordingStore.setState({ interrupted: true }));
    mount();
    const all = texts();
    expect(all).toContain('Recording stopped');
    expect(all.some((t) => t.includes("couldn't be restarted"))).toBe(true);
    expect(pressableWith(renderer, 'End & save').props.disabled).toBeFalsy();
  });

  it('says so when recording was restarted after a gap, and not otherwise', () => {
    recordFixes(5);
    mount();
    expect(texts().some((t) => t.includes('straight line across that gap'))).toBe(false);
    act(() => useTrackRecordingStore.setState({ resumedAfterGap: true }));
    expect(texts().some((t) => t.includes('straight line across that gap'))).toBe(true);
  });

  it('leaves out the gap note when the more serious stopped warning is showing', () => {
    recordFixes(5);
    act(() => useTrackRecordingStore.setState({ resumedAfterGap: true, interrupted: true }));
    mount();
    expect(texts().some((t) => t.includes('straight line across that gap'))).toBe(false);
  });

  it('follows the metric setting', () => {
    recordFixes(21);
    act(() => {
      useSettingsStore.setState({ units: 'metric' });
    });
    mount();
    expect(texts()).toContain('1.00 km');
  });

  it('renders nothing visible when closed', () => {
    recordFixes(5);
    mount({ visible: false });
    expect(texts()).not.toContain('Recording track');
  });
});
