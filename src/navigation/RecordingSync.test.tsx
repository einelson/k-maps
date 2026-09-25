import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { restoreRecording, syncRecording } from '../features/trackRecorder';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';
import { RecordingSync, SYNC_INTERVAL_MS } from './RecordingSync';

const mockDb = {};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('../features/trackRecorder', () => ({ restoreRecording: jest.fn(), syncRecording: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const restore = restoreRecording as jest.Mock;
const sync = syncRecording as jest.Mock;

let renderer: ReactTestRenderer;
let onAppState: ((state: string) => void) | undefined;
const removeListener = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  restore.mockReset().mockResolvedValue(undefined);
  sync.mockReset().mockResolvedValue(undefined);
  removeListener.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (s: string) => void) => {
    onAppState = handler;
    return { remove: removeListener };
  }) as never);
  act(() => useTrackRecordingStore.getState().reset());
});

afterEach(() => {
  act(() => renderer?.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const mount = () => act(() => void (renderer = create(<RecordingSync />)));

describe('RecordingSync', () => {
  it('renders nothing', () => {
    mount();
    expect(renderer.toJSON()).toBeNull();
  });

  it('restores a recording from the database when the app opens', () => {
    mount();
    expect(restore).toHaveBeenCalledWith(mockDb);
  });

  it('restores again each time the app comes back to the front, but not on other state changes', () => {
    mount();
    restore.mockClear();
    act(() => onAppState!('background'));
    act(() => onAppState!('inactive'));
    expect(restore).not.toHaveBeenCalled();
    act(() => onAppState!('active'));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('does not poll while nothing is being recorded', () => {
    mount();
    act(() => void jest.advanceTimersByTime(SYNC_INTERVAL_MS * 5));
    expect(sync).not.toHaveBeenCalled();
  });

  it('polls for new fixes while recording, and stops when the recording ends', () => {
    mount();
    act(() => useTrackRecordingStore.getState().begin(0));
    act(() => void jest.advanceTimersByTime(SYNC_INTERVAL_MS * 3));
    expect(sync).toHaveBeenCalledTimes(3);
    expect(sync).toHaveBeenCalledWith(mockDb);

    act(() => useTrackRecordingStore.getState().reset());
    sync.mockClear();
    act(() => void jest.advanceTimersByTime(SYNC_INTERVAL_MS * 3));
    expect(sync).not.toHaveBeenCalled();
  });

  it('keeps going, quietly, when a sync or restore fails', async () => {
    sync.mockRejectedValue(new Error('locked'));
    restore.mockRejectedValue(new Error('locked'));
    mount();
    act(() => useTrackRecordingStore.getState().begin(0));
    await act(async () => void jest.advanceTimersByTime(SYNC_INTERVAL_MS * 2));
    expect(sync).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalled();
  });

  it('cleans up its listener and timer when unmounted', () => {
    mount();
    act(() => useTrackRecordingStore.getState().begin(0));
    act(() => renderer.unmount());
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
