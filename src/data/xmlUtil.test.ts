import { asArray, escapeXml } from './xmlUtil';

describe('escapeXml', () => {
  it('escapes the five predefined XML entities', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('leaves plain text, unicode and whitespace untouched', () => {
    expect(escapeXml('Camp 1 – Café ⛺ line1\nline2\ttab')).toBe('Camp 1 – Café ⛺ line1\nline2\ttab');
    expect(escapeXml('')).toBe('');
  });

  it('escapes ampersands first so entities are not double-decoded', () => {
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
    expect(escapeXml('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeXml('a&b&c<d<e')).toBe('a&amp;b&amp;c&lt;d&lt;e');
    expect(escapeXml('"""')).toBe('&quot;&quot;&quot;');
  });

  it('neutralises markup injection through a name', () => {
    const escaped = escapeXml('</name><wpt lat="0" lon="0"/>');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).not.toContain('"');
  });
});

describe('asArray', () => {
  it('turns null and undefined into an empty array', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });

  it('wraps a single value', () => {
    expect(asArray('a')).toEqual(['a']);
    expect(asArray({ x: 1 })).toEqual([{ x: 1 }]);
  });

  it('returns an existing array as-is', () => {
    const list = [1, 2, 3];
    expect(asArray(list)).toBe(list);
    expect(asArray([])).toEqual([]);
  });

  it('keeps falsy-but-present values (0, empty string, false)', () => {
    expect(asArray(0)).toEqual([0]);
    expect(asArray('')).toEqual(['']);
    expect(asArray(false)).toEqual([false]);
  });
});
