import { useTrackRecordingStore } from './useTrackRecordingStore';

const store = () => useTrackRecordingStore.getState();
// ~111 m per 0.001° of latitude.
const fix = (id: number, lat: number, extra: { altitude?: number | null } = {}) => ({
  id,
  time: id * 1000,
  lon: -116,
  lat,
  altitude: extra.altitude === undefined ? 1500 : extra.altitude,
});

beforeEach(() => useTrackRecordingStore.getState().reset());

describe('useTrackRecordingStore', () => {
  it('starts empty and not recording', () => {
    expect(store()).toMatchObject({ recording: false, startedAt: null, points: [], times: [], altitudes: [], distanceM: 0, lastFixId: 0, interrupted: false, resumedAfterGap: false });
  });

  it('begin starts an empty recording at the given time', () => {
    store().begin(5000);
    expect(store()).toMatchObject({ recording: true, startedAt: 5000, points: [], distanceM: 0 });
  });

  it('appends fixes in step, accumulating distance from the previous fix', () => {
    store().begin(0);
    store().appendFixes([fix(1, 43), fix(2, 43.001, { altitude: null })]);
    expect(store().points).toEqual([[-116, 43], [-116, 43.001]]);
    expect(store().times).toEqual([1000, 2000]);
    expect(store().altitudes).toEqual([1500, null]);
    expect(store().distanceM).toBeGreaterThan(105);
    expect(store().distanceM).toBeLessThan(118);
    expect(store().lastFixId).toBe(2);

    store().appendFixes([fix(3, 43.002)]);
    expect(store().points).toHaveLength(3);
    expect(store().distanceM).toBeGreaterThan(215);
  });

  it('ignores fixes it already has (a sync that overlaps the last one)', () => {
    store().begin(0);
    store().appendFixes([fix(1, 43), fix(2, 43.001)]);
    const before = store().distanceM;
    store().appendFixes([fix(2, 43.001), fix(3, 43.002)]);
    expect(store().points).toHaveLength(3);
    expect(store().distanceM).toBeGreaterThan(before);
    store().appendFixes([fix(1, 43)]);
    expect(store().points).toHaveLength(3);
  });

  it('ignores fixes once the recording has ended (a late sync must not refill the cleared store)', () => {
    store().begin(0);
    store().reset();
    store().appendFixes([fix(1, 43), fix(2, 43.001)]);
    expect(store().points).toEqual([]);
    expect(store().recording).toBe(false);
  });

  it('leaves state alone for an empty append', () => {
    store().begin(0);
    const before = store();
    store().appendFixes([]);
    expect(store().points).toBe(before.points);
  });

  it('hydrate replaces everything with the stored recording', () => {
    store().begin(0);
    store().appendFixes([fix(1, 50)]);

    store().hydrate(9000, [fix(4, 43), fix(5, 43.001)]);

    expect(store()).toMatchObject({ recording: true, startedAt: 9000, lastFixId: 5 });
    expect(store().points).toEqual([[-116, 43], [-116, 43.001]]);
    expect(store().distanceM).toBeGreaterThan(105);
  });

  it('hydrate with no fixes yet still starts a recording', () => {
    store().hydrate(9000, []);
    expect(store()).toMatchObject({ recording: true, startedAt: 9000, points: [], lastFixId: 0 });
  });

  it('hydrate keeps the interrupted flag as it was', () => {
    store().setInterrupted(true);
    store().hydrate(1, []);
    expect(store().interrupted).toBe(true);
  });

  it('remembers a gap across a rebuild from the database, and forgets it on reset or a new recording', () => {
    store().begin(0);
    store().setResumedAfterGap(true);
    store().hydrate(0, [fix(1, 43)]);
    expect(store().resumedAfterGap).toBe(true);
    store().reset();
    expect(store().resumedAfterGap).toBe(false);
    store().setResumedAfterGap(true);
    store().begin(5);
    expect(store().resumedAfterGap).toBe(false);
  });

  it('setInterrupted toggles the flag', () => {
    store().setInterrupted(true);
    expect(store().interrupted).toBe(true);
    store().setInterrupted(false);
    expect(store().interrupted).toBe(false);
  });

  it('reset clears everything, including the interrupted flag', () => {
    store().begin(0);
    store().appendFixes([fix(1, 43), fix(2, 43.001)]);
    store().setInterrupted(true);
    store().reset();
    expect(store()).toMatchObject({ recording: false, startedAt: null, points: [], times: [], altitudes: [], distanceM: 0, lastFixId: 0, interrupted: false });
  });
});
