import { asRecord, boolOr, mergeRecord, oneOf } from './persistHelpers';

describe('mergeRecord', () => {
  const defaults = { a: true, b: false, n: 0.5 };

  it('lays saved values over the defaults', () => {
    expect(mergeRecord(defaults, { a: false, n: 0.9 })).toEqual({ a: false, b: false, n: 0.9 });
  });

  it('fills in anything the save has never seen, e.g. a layer added in a later version', () => {
    expect(mergeRecord(defaults, {})).toEqual(defaults);
  });

  it('drops keys the app no longer has', () => {
    expect(mergeRecord(defaults, { a: true, removedLayer: true })).toEqual(defaults);
  });

  it('falls back to the default for a value of the wrong type or a non-finite number', () => {
    expect(mergeRecord(defaults, { a: 'yes', b: 1, n: Number.NaN })).toEqual(defaults);
    expect(mergeRecord(defaults, { n: Infinity })).toEqual(defaults);
  });

  it.each([null, undefined, 'x', 3, [], [true]])('returns the defaults for a save that is %p', (saved) => {
    expect(mergeRecord(defaults, saved)).toEqual(defaults);
  });

  it('never hands back the defaults object itself, so callers cannot mutate it', () => {
    expect(mergeRecord(defaults, {})).not.toBe(defaults);
  });
});

describe('oneOf / boolOr / asRecord', () => {
  it('oneOf keeps an allowed value and replaces anything else', () => {
    expect(oneOf('b', ['a', 'b'] as const, 'a')).toBe('b');
    expect(oneOf('z', ['a', 'b'] as const, 'a')).toBe('a');
    expect(oneOf(undefined, ['a', 'b'] as const, 'a')).toBe('a');
  });

  it('boolOr keeps a boolean (including false) and replaces anything else', () => {
    expect(boolOr(false, true)).toBe(false);
    expect(boolOr('false', true)).toBe(true);
    expect(boolOr(undefined, false)).toBe(false);
  });

  it('asRecord makes any saved value safe to read a key from', () => {
    expect(asRecord({ x: 1 })).toEqual({ x: 1 });
    for (const bad of [null, undefined, 'x', 4, [1, 2]]) expect(asRecord(bad)).toEqual({});
  });
});
