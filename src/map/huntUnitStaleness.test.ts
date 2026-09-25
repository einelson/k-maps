import type { HuntStateInfo } from '../huntUnits/types';
import {
  acceptanceFor,
  ageText,
  STALE_AFTER_YEARS,
  staleNotices,
  staleSignature,
  staleSummary,
  staleWarningFor,
  unacceptedStale,
  yearsSince,
} from './huntUnitStaleness';

const NOW = new Date(Date.UTC(2026, 8, 25)); // Sep 25 2026

const info = (state: string, sets: { id: string; updated?: string }[]): HuntStateInfo => ({
  state,
  name: state === 'MA' ? 'Massachusetts' : state,
  agency: 'Agency',
  regsUrl: 'https://example.test/regs',
  vintage: '',
  bbox: [-73, 41, -70, 43],
  sets: sets.map((s) => ({ id: s.id, label: `${s.id} layer`, count: 1, ...(s.updated ? { updated: s.updated } : {}) })),
});

describe('yearsSince', () => {
  it('counts whole calendar years, not yet a year until the anniversary', () => {
    expect(yearsSince('2023-09-25', NOW)).toBe(3); // exactly three years ago today
    expect(yearsSince('2023-09-26', NOW)).toBe(2); // one day short
    expect(yearsSince('2021-09-17', NOW)).toBe(5);
    expect(yearsSince('2026-08-27', NOW)).toBe(0);
    expect(yearsSince('2023-10-01', NOW)).toBe(2);
    expect(yearsSince('2023-01-06', NOW)).toBe(3);
  });

  it('is null for anything that is not a date', () => {
    expect(yearsSince('spring', NOW)).toBeNull();
    expect(yearsSince('', NOW)).toBeNull();
  });

  it('ageText pluralizes', () => {
    expect(ageText(1)).toBe('1 year ago');
    expect(ageText(5)).toBe('5 years ago');
  });
});

describe('staleNotices', () => {
  it(`flags layers edited ${STALE_AFTER_YEARS} or more years ago, and only those`, () => {
    const notices = staleNotices(info('MA', [{ id: 'zone', updated: '2021-09-17' }, { id: 'fresh', updated: '2026-03-01' }, { id: 'edge', updated: '2023-09-25' }, { id: 'almost', updated: '2023-09-26' }]), NOW);
    expect(notices.map((n) => n.setId).sort()).toEqual(['edge', 'zone']);
    expect(notices.find((n) => n.setId === 'zone')).toMatchObject({ state: 'MA', stateName: 'Massachusetts', layer: 'zone layer', updated: '2021-09-17', years: 5 });
  });

  it('does not flag a layer with no published date (the card says so separately)', () => {
    expect(staleNotices(info('OR', [{ id: 'wmu' }]), NOW)).toEqual([]);
  });

  it('the same data becomes old as time passes', () => {
    const state = info('NV', [{ id: 'unit', updated: '2024-02-06' }]);
    expect(staleNotices(state, NOW)).toEqual([]);
    expect(staleNotices(state, new Date(Date.UTC(2027, 2, 1)))).toHaveLength(1); // three years on
  });
});

describe('staleSignature and unacceptedStale', () => {
  const ma = info('MA', [{ id: 'zone', updated: '2021-09-17' }]);
  const fresh = info('MI', [{ id: 'deer', updated: '2026-09-21' }]);

  it('is empty when nothing is old, and names each old layer with its date', () => {
    expect(staleSignature(fresh, NOW)).toBe('');
    expect(staleSignature(info('WY', [{ id: 'bear', updated: '2021-11-23' }, { id: 'elk', updated: '2021-01-01' }]), NOW)).toBe('bear:2021-11-23,elk:2021-01-01');
  });

  it('lists old data that has not been accepted', () => {
    expect(unacceptedStale([ma, fresh], {}, NOW).map((n) => n.state)).toEqual(['MA']);
    expect(unacceptedStale([fresh], {}, NOW)).toEqual([]);
  });

  it('accepted old data is not listed again', () => {
    expect(unacceptedStale([ma], { MA: 'zone:2021-09-17' }, NOW)).toEqual([]);
  });

  it('acceptance covers exactly what was shown: a different (still old) date must be accepted again', () => {
    const updatedButOld = info('MA', [{ id: 'zone', updated: '2022-04-06' }]);
    expect(unacceptedStale([updatedButOld], { MA: 'zone:2021-09-17' }, NOW)).toHaveLength(1);
  });

  it('acceptance for other states does not count', () => {
    expect(unacceptedStale([ma], { NY: 'zone:2021-09-17' }, NOW)).toHaveLength(1);
  });
});

describe('the words shown to the hunter', () => {
  const state = info('MA', [{ id: 'zone', updated: '2021-09-17' }, { id: 'fresh', updated: '2026-03-01' }]);

  it('the card warns only for an old layer, with its age and date', () => {
    const warning = staleWarningFor(state, 'zone', NOW)!;
    expect(warning).toMatch(/5 years ago \(Sep 17, 2021\)/);
    expect(warning).toMatch(/may have changed/i);
    expect(warning).toMatch(/current regulations/i);
    expect(staleWarningFor(state, 'fresh', NOW)).toBeNull();
    expect(staleWarningFor(state, 'unknown', NOW)).toBeNull();
  });

  it('the Downloads list summarizes the oldest old layer, or says nothing', () => {
    expect(staleSummary(state, NOW)).toBe('Old data: this layer was last edited 5 years ago (Sep 17, 2021)');
    const two = info('WY', [{ id: 'bear', updated: '2021-11-23' }, { id: 'a', updated: '2022-05-01' }, { id: 'ok', updated: '2026-01-01' }]);
    expect(staleSummary(two, NOW)).toBe('Old data: 2 layers were last edited 4 years ago (Nov 23, 2021)');
    expect(staleSummary(info('MI', [{ id: 'deer', updated: '2026-09-21' }]), NOW)).toBeNull();
  });
});

describe('acceptanceFor', () => {
  it('records a signature only for states that have old data', () => {
    const ma = info('MA', [{ id: 'zone', updated: '2021-09-17' }]);
    const fresh = info('MI', [{ id: 'deer', updated: '2026-09-21' }]);
    const unknown = info('OR', [{ id: 'wmu' }]);
    expect(acceptanceFor([ma, fresh, unknown], NOW)).toEqual({ MA: 'zone:2021-09-17' });
  });

  it('what it records is exactly what makes unacceptedStale go quiet', () => {
    const ma = info('MA', [{ id: 'zone', updated: '2021-09-17' }]);
    expect(unacceptedStale([ma], acceptanceFor([ma], NOW), NOW)).toEqual([]);
  });
});

