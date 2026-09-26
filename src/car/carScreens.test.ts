import { DEFAULT_FIX_SPACING_M, TRANSPORT_MODES } from '../features/transport';
import {
  PHONE_HINT,
  homeSections,
  startFailureMessage,
  transportSections,
  type CarHomeActions,
  type CarRecordingState,
} from './carScreens';

const idle: CarRecordingState = {
  recording: false,
  transport: null,
  startedAt: null,
  distanceM: 0,
  interrupted: false,
};
const recording = (over: Partial<CarRecordingState> = {}): CarRecordingState => ({
  recording: true,
  transport: 'horse',
  startedAt: 1_000_000,
  distanceM: 1609.344,
  interrupted: false,
  ...over,
});
const actions = (): CarHomeActions => ({ chooseTransport: jest.fn(), endAndSave: jest.fn() });

/** The rows of the single section a builder returns. */
function rowsOf(sections: ReturnType<typeof homeSections>) {
  if (!Array.isArray(sections)) throw new Error('expected a list of sections');
  return (sections as { items: unknown[] }[]).flatMap((s) => s.items) as any[];
}

describe('homeSections: not recording', () => {
  it('offers to record a track, opening the choice of how you are getting around', () => {
    const a = actions();
    const [row, ...rest] = rowsOf(homeSections(idle, 'imperial', 0, a));
    expect(rest).toEqual([]);
    expect(row.title.text).toBe('Record a track');
    expect(row.browsable).toBe(true);
    row.onPress();
    expect(a.chooseTransport).toHaveBeenCalledTimes(1);
    expect(a.endAndSave).not.toHaveBeenCalled();
  });
});

describe('homeSections: recording', () => {
  it("shows the mode, the running clock and the distance in the phone's units", () => {
    const now = 1_000_000 + 754_000; // 12:34 in
    const [status] = rowsOf(homeSections(recording(), 'imperial', now, actions()));
    expect(status.type).toBe('text');
    expect(status.title.text).toBe('Recording · Horse');
    expect(status.detailedText.text).toBe('12:34 · 1.00 mi');

    const [metric] = rowsOf(homeSections(recording({ distanceM: 2500 }), 'metric', now, actions()));
    expect(metric.detailedText.text).toBe('12:34 · 2.50 km');
  });

  it('drops the mode from the title when none was chosen (a recording started before modes existed)', () => {
    const [status] = rowsOf(homeSections(recording({ transport: null }), 'metric', 1_000_000, actions()));
    expect(status.title.text).toBe('Recording');
  });

  it('starts the clock at 0:00 when the start time is not known yet', () => {
    const [status] = rowsOf(homeSections(recording({ startedAt: null, distanceM: 0 }), 'metric', 5_000_000, actions()));
    expect(status.detailedText.text).toBe('0:00 · 0 m');
  });

  it('says so when location updates have stopped, instead of showing a clock that looks healthy', () => {
    const [status] = rowsOf(homeSections(recording({ interrupted: true }), 'metric', 2_000_000, actions()));
    expect(status.detailedText.text).toMatch(/^Stopped/);
    expect(status.detailedText.text).not.toMatch(/\d:\d\d/); // no clock
  });

  it('ends and saves from the second row, and only from there', () => {
    const a = actions();
    const rows = rowsOf(homeSections(recording(), 'metric', 2_000_000, a));
    expect(rows).toHaveLength(2);
    expect(rows[0].onPress).toBeUndefined(); // the status row does nothing when tapped
    rows[1].onPress();
    expect(a.endAndSave).toHaveBeenCalledTimes(1);
    expect(a.chooseTransport).not.toHaveBeenCalled();
  });

  it('draws the same thing for the same moment, so an unchanged screen can be recognised by its content', () => {
    const at = (now: number) => JSON.stringify(homeSections(recording(), 'metric', now, actions()));
    expect(at(1_500_000)).toBe(at(1_500_000));
    expect(at(1_500_000)).not.toBe(at(1_560_000));
  });
});

describe('transportSections', () => {
  it('lists every way of getting around with how often a point is saved', () => {
    const rows = rowsOf(transportSections('metric', DEFAULT_FIX_SPACING_M, jest.fn()));
    expect(rows.map((r) => r.title.text)).toEqual(TRANSPORT_MODES.map((m) => m.label));
    expect(rows[0].detailedText.text).toBe('A point every 5 m');
    expect(rows.find((r) => r.title.text === 'Vehicle').detailedText.text).toBe('A point every 25 m');
  });

  it('shows the spacing from Settings, in feet for imperial', () => {
    const rows = rowsOf(transportSections('imperial', { ...DEFAULT_FIX_SPACING_M, horse: 30 }, jest.fn()));
    expect(rows.find((r) => r.title.text === 'Horse').detailedText.text).toBe('A point every 98 ft');
  });

  it('reports which way was picked', () => {
    const onPick = jest.fn();
    const rows = rowsOf(transportSections('metric', DEFAULT_FIX_SPACING_M, onPick));
    rows.find((r) => r.title.text === 'ATV / UTV').onPress();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('atv');
  });
});

describe('startFailureMessage', () => {
  it('keeps the reason and points to the phone, where permission prompts can be answered', () => {
    const text = startFailureMessage('Location permission was not granted.');
    expect(text.startsWith('Location permission was not granted.')).toBe(true);
    expect(text).toContain(PHONE_HINT);
  });
});
