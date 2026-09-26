import { HybridAutoPlay } from '@iternio/react-native-auto-play';

import { finishTrackRecording, restoreRecording, startTrackRecording, syncRecording } from '../features/trackRecorder';
import { useSettingsStore } from '../state/useSettingsStore';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';
import { CAR_REFRESH_MS, registerCarApp } from './carApp';

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));

// The library's real module needs the native car host; this is just enough of it to see what the app asks for.
const mockListeners: Record<string, () => void> = {};
const mockLists: any[] = [];
const mockMessages: any[] = [];
jest.mock('@iternio/react-native-auto-play', () => {
  class ListTemplate {
    config: any;
    setRootTemplate = jest.fn(async () => undefined);
    push = jest.fn(async () => undefined);
    updateSections = jest.fn(async () => undefined);
    constructor(config: any) {
      this.config = config;
      mockLists.push(this);
    }
  }
  class MessageTemplate {
    config: any;
    push = jest.fn(async () => undefined);
    constructor(config: any) {
      this.config = config;
      mockMessages.push(this);
    }
  }
  return {
    ListTemplate,
    MessageTemplate,
    HybridAutoPlay: {
      addListener: jest.fn((event: string, cb: () => void) => {
        mockListeners[event] = cb;
        return jest.fn();
      }),
      popTemplate: jest.fn(async () => undefined),
    },
  };
});

const mockDb = { name: 'car-db' };
jest.mock('./carDb', () => ({ carDb: jest.fn(async () => mockDb) }));
jest.mock('../features/trackRecorder', () => ({
  startTrackRecording: jest.fn(),
  finishTrackRecording: jest.fn(),
  restoreRecording: jest.fn(),
  syncRecording: jest.fn(),
}));

const start = startTrackRecording as jest.Mock;
const finish = finishTrackRecording as jest.Mock;
const restore = restoreRecording as jest.Mock;
const sync = syncRecording as jest.Mock;
const popTemplate = HybridAutoPlay.popTemplate as jest.Mock;

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const home = () => mockLists[0];
const rowTitles = (list: any) => (list.config.sections as any[]).flatMap((s) => s.items).map((r) => r.title.text);
const lastSections = (list: any) => list.updateSections.mock.calls.at(-1)?.[0] as any[];

let unregister: () => void;

/** A car connects: the home screen is built and set as the root. */
async function connect() {
  mockListeners.didConnect();
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(2_000_000);
  mockLists.length = 0;
  mockMessages.length = 0;
  for (const mock of [start, finish, restore, sync, popTemplate]) mock.mockReset().mockResolvedValue(undefined);
  useTrackRecordingStore.getState().reset();
  useSettingsStore.getState().resetTrackSpacing();
  useSettingsStore.setState({ units: 'metric' });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  unregister = registerCarApp();
});

afterEach(() => {
  unregister();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('connecting', () => {
  it('listens for the car connecting and disconnecting', () => {
    expect(HybridAutoPlay.addListener).toHaveBeenCalledWith('didConnect', expect.any(Function));
    expect(HybridAutoPlay.addListener).toHaveBeenCalledWith('didDisconnect', expect.any(Function));
  });

  it('shows K-Maps as the root screen, offering to record a track', async () => {
    await connect();
    expect(home().config.title).toEqual({ text: 'K-Maps' });
    expect(home().setRootTemplate).toHaveBeenCalledTimes(1);
    expect(rowTitles(home())).toEqual(['Record a track']);
  });

  it('first picks up a recording that is already running (started on the phone, or carried on while closed)', async () => {
    restore.mockImplementation(async () => useTrackRecordingStore.getState().begin(1_000_000, 'foot'));
    await connect();
    expect(restore).toHaveBeenCalledWith(mockDb);
    expect(rowTitles(home())).toEqual(['Recording · On foot', 'End & save']);
  });

  it('builds a fresh root each time a car connects', async () => {
    await connect();
    await connect();
    expect(mockLists).toHaveLength(2);
    expect(mockLists[1].setRootTemplate).toHaveBeenCalledTimes(1);
  });

  it('logs, rather than throwing, when the screen cannot be built', async () => {
    restore.mockRejectedValue(new Error('db locked'));
    await connect();
    expect(console.warn).toHaveBeenCalledWith('Could not show the car screen', expect.any(Error));
  });
});

describe('starting a recording from the car', () => {
  async function openChoices() {
    await connect();
    (home().config.sections[0].items[0] as any).onPress();
    return mockLists[1];
  }

  it('offers every way of getting around, with a back button', async () => {
    const choices = await openChoices();
    expect(choices.push).toHaveBeenCalledTimes(1);
    expect(rowTitles(choices)).toEqual(['On foot', 'Horse', 'Bike', 'ATV / UTV', 'Vehicle', 'Boat', 'Other']);
    expect(choices.config.headerActions.android.startHeaderAction.type).toBe('back');
    choices.config.headerActions.android.startHeaderAction.onPress();
    expect(popTemplate).toHaveBeenCalled();
  });

  it('shows the spacing set in Settings', async () => {
    useSettingsStore.getState().setTrackSpacing('vehicle', 50);
    const choices = await openChoices();
    const vehicle = (choices.config.sections[0].items as any[]).find((r) => r.title.text === 'Vehicle');
    expect(vehicle.detailedText.text).toBe('A point every 50 m');
  });

  it('starts recording with the chosen mode, goes back to the home screen and redraws it as recording', async () => {
    start.mockImplementation(async (_db, transport) => {
      useTrackRecordingStore.getState().begin(2_000_000, transport);
      return { ok: true };
    });
    const choices = await openChoices();
    (choices.config.sections[0].items as any[]).find((r) => r.title.text === 'Horse').onPress();
    await flush();

    expect(popTemplate).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(mockDb, 'horse');
    expect(mockMessages).toHaveLength(0);
    expect(lastSections(home())[0].items.map((r: any) => r.title.text)).toEqual(['Recording · Horse', 'End & save']);
  });

  it('says why when recording cannot start, and points to the phone', async () => {
    start.mockResolvedValue({ ok: false, reason: 'Location permission was not granted.' });
    const choices = await openChoices();
    (choices.config.sections[0].items as any[])[0].onPress();
    await flush();

    expect(mockMessages).toHaveLength(1);
    expect(mockMessages[0].config.title).toEqual({ text: "Can't record" });
    expect(mockMessages[0].config.message.text).toContain('Location permission was not granted.');
    expect(mockMessages[0].config.message.text).toContain('open K-Maps on your phone');
    expect(mockMessages[0].push).toHaveBeenCalled();
  });

  it('also says so when asking for permission itself fails, as it can with no phone screen up', async () => {
    start.mockRejectedValue(new Error('No activity'));
    const choices = await openChoices();
    (choices.config.sections[0].items as any[])[0].onPress();
    await flush();
    expect(mockMessages[0].config.message.text).toContain('No activity');
  });

  it('gives every message an OK button that closes it', async () => {
    start.mockResolvedValue({ ok: false, reason: 'nope' });
    const choices = await openChoices();
    (choices.config.sections[0].items as any[])[0].onPress();
    await flush();
    popTemplate.mockClear();
    const { android, ios } = mockMessages[0].config.actions;
    android[0].onPress();
    ios[0].onPress();
    expect(android[0].title).toBe('OK');
    expect(popTemplate).toHaveBeenCalledTimes(2);
  });
});

describe('ending a recording from the car', () => {
  beforeEach(() => {
    useTrackRecordingStore.getState().begin(1_000_000, 'vehicle');
  });
  const endAndSave = () => (home().config.sections[0].items[1] as any).onPress();

  it('saves the track, tells you where to name it, and goes back to offering a new recording', async () => {
    finish.mockImplementation(async () => {
      useTrackRecordingStore.getState().reset();
      return 42;
    });
    await connect();
    endAndSave();
    await flush();

    expect(finish).toHaveBeenCalledWith(mockDb);
    expect(mockMessages[0].config.title).toEqual({ text: 'Track saved' });
    expect(mockMessages[0].config.message.text).toContain('on your phone');
    expect(mockMessages[0].config.autoDismissMs).toBeGreaterThan(0);
    expect(lastSections(home())[0].items.map((r: any) => r.title.text)).toEqual(['Record a track']);
  });

  it('says so when there were not enough points to keep', async () => {
    finish.mockResolvedValue(null);
    await connect();
    endAndSave();
    await flush();
    expect(mockMessages[0].config.title).toEqual({ text: 'Nothing to save' });
  });

  it('reports a failure to save', async () => {
    finish.mockRejectedValue(new Error('disk full'));
    await connect();
    endAndSave();
    await flush();
    expect(mockMessages[0].config.title).toEqual({ text: "Couldn't save the track" });
    expect(mockMessages[0].config.message.text).toBe('disk full');
  });
});

describe('keeping the screen current', () => {
  it('syncs a running recording every few seconds and redraws when the clock has moved', async () => {
    useTrackRecordingStore.getState().begin(1_000_000, 'foot');
    await connect();
    sync.mockClear();

    jest.advanceTimersByTime(CAR_REFRESH_MS);
    await flush();

    expect(sync).toHaveBeenCalledWith(mockDb);
    expect(home().updateSections).toHaveBeenCalledTimes(1);
    // Started at 1,000,000 ms; the clock read 2,000,000 on connecting and 2,005,000 five seconds later: 1,005 s.
    expect(lastSections(home())[0].items[0].detailedText.text).toBe('16:45 · 0 m');
  });

  it('does not redraw a screen that has not changed', async () => {
    await connect(); // not recording: nothing on screen ever changes
    jest.advanceTimersByTime(CAR_REFRESH_MS * 3);
    await flush();
    expect(home().updateSections).not.toHaveBeenCalled();
  });

  it('notices a recording started on the phone while nothing was recording', async () => {
    await connect();
    restore.mockImplementation(async () => useTrackRecordingStore.getState().begin(1_990_000, 'atv'));
    jest.advanceTimersByTime(CAR_REFRESH_MS);
    await flush();
    expect(restore).toHaveBeenLastCalledWith(mockDb);
    expect(lastSections(home())[0].items[0].title.text).toBe('Recording · ATV / UTV');
  });

  it('logs a failed refresh and keeps going', async () => {
    useTrackRecordingStore.getState().begin(1_000_000, 'foot');
    await connect();
    sync.mockRejectedValueOnce(new Error('locked'));
    jest.advanceTimersByTime(CAR_REFRESH_MS);
    await flush();
    expect(console.warn).toHaveBeenCalledWith('Could not refresh the car screen', expect.any(Error));
    sync.mockClear();
    jest.advanceTimersByTime(CAR_REFRESH_MS);
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('stops refreshing when the car disconnects, and starts again on the next connection', async () => {
    useTrackRecordingStore.getState().begin(1_000_000, 'foot');
    await connect();
    mockListeners.didDisconnect();
    sync.mockClear();
    jest.advanceTimersByTime(CAR_REFRESH_MS * 3);
    await flush();
    expect(sync).not.toHaveBeenCalled();

    await connect();
    sync.mockClear();
    jest.advanceTimersByTime(CAR_REFRESH_MS);
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('does not stack refresh loops when a car reconnects', async () => {
    useTrackRecordingStore.getState().begin(1_000_000, 'foot');
    await connect();
    await connect();
    sync.mockClear();
    jest.advanceTimersByTime(CAR_REFRESH_MS);
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
