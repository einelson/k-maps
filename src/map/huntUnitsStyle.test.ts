import type { HuntStateInfo } from '../huntUnits/types';
import {
  formatDataDate,
  HUNT_UNIT_DISCLAIMER_POINTS,
  HUNT_UNIT_DISCLAIMER_TITLE,
  huntUnitDataSummary,
  huntUnitDisclaimer,
  huntUnitSourceNote,
} from './huntUnitsStyle';

const info = (over: Partial<HuntStateInfo> = {}): HuntStateInfo => ({
  state: 'OR',
  name: 'Oregon',
  agency: 'Oregon Department of Fish and Wildlife',
  regsUrl: 'https://example.test/regs',
  vintage: '',
  bbox: [-124, 42, -116, 46],
  sets: [{ id: 'wmu', label: 'Wildlife Management Units', count: 69 }],
  ...over,
});

describe('the hunter disclaimer', () => {
  it('tells hunters, on every card, to check the state regulations AND local laws, and that it may be inaccurate', () => {
    const text = huntUnitDisclaimer('Oregon');
    expect(text).toMatch(/Oregon hunting regulations/);
    expect(text).toMatch(/local laws/i);
    expect(text).toMatch(/out of date or inaccurate/i);
    expect(text).toMatch(/before you hunt/i);
  });

  it('the full acknowledgement covers the essentials', () => {
    const all = HUNT_UNIT_DISCLAIMER_POINTS.join(' ');
    expect(HUNT_UNIT_DISCLAIMER_TITLE).toMatch(/local laws and regulations/i);
    expect(all).toMatch(/reference only/i);
    expect(all).toMatch(/out of date/i);
    expect(all).toMatch(/private land/i);
    expect(all).toMatch(/current hunting regulations/i);
    expect(all).toMatch(/local laws/i);
    expect(all).toMatch(/responsible for knowing where and when you may hunt/i);
  });
});

describe('formatDataDate', () => {
  it('formats dates and ISO timestamps, and leaves other text alone', () => {
    expect(formatDataDate('2026-08-27')).toBe('Aug 27, 2026');
    expect(formatDataDate('2026-01-05T12:30:00.000Z')).toBe('Jan 5, 2026');
    expect(formatDataDate('2026-13-01')).toBe('2026-13-01'); // not a real month
    expect(formatDataDate('spring 2026')).toBe('spring 2026');
  });
});

describe('huntUnitSourceNote', () => {
  it('names the agency, the season when it states one, the source data date, and the download date', () => {
    const note = huntUnitSourceNote(
      info({ vintage: 'April 2026 – March 2027', fetchedAt: '2026-09-24T22:00:00.000Z', sets: [{ id: 'gmu', label: 'GMUs', count: 1, updated: '2026-02-11' }] }),
      'gmu'
    );
    expect(note).toBe('Oregon Department of Fish and Wildlife · April 2026 – March 2027. Source data last edited Feb 11, 2026; downloaded Sep 24, 2026.');
  });

  it('says plainly when the agency publishes no date, instead of implying the data is current', () => {
    const note = huntUnitSourceNote(info(), 'wmu');
    expect(note).toBe("Oregon Department of Fish and Wildlife. Source data date not published by the agency's service.");
    expect(note).not.toMatch(/current/i);
  });

  it("uses the tapped unit's own set for the date", () => {
    const state = info({ sets: [{ id: 'elk', label: 'Elk', count: 1, updated: '2026-03-19' }, { id: 'bear', label: 'Bear', count: 1, updated: '2021-11-23' }] });
    expect(huntUnitSourceNote(state, 'bear')).toContain('Nov 23, 2021');
    expect(huntUnitSourceNote(state, 'elk')).toContain('Mar 19, 2026');
  });
});

describe('huntUnitDataSummary', () => {
  it('reports the OLDEST layer date: a state is only as current as its stalest layer', () => {
    const state = info({ sets: [{ id: 'a', label: 'A', count: 1, updated: '2026-03-19' }, { id: 'b', label: 'B', count: 1, updated: '2021-11-23' }, { id: 'c', label: 'C', count: 1 }] });
    expect(huntUnitDataSummary(state)).toBe('Source data last edited Nov 23, 2021');
  });

  it('leads with the season the agency states, and admits when no date is published', () => {
    expect(huntUnitDataSummary(info({ vintage: '2026–2027 seasons' }))).toBe('2026–2027 seasons · Source data date not published');
  });
});
