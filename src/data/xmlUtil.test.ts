import { asArray, escapeXml, htmlToText, textOf } from './xmlUtil';

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

describe('textOf', () => {
  it('returns strings as-is', () => {
    expect(textOf('hi')).toBe('hi');
    expect(textOf('')).toBe('');
  });

  it('reads the #text of an element that also has attributes', () => {
    expect(textOf({ '#text': 'Camp', '@_lang': 'en' })).toBe('Camp');
  });

  it('gives null for missing, non-text and attribute-only nodes', () => {
    expect(textOf(undefined)).toBeNull();
    expect(textOf(null)).toBeNull();
    expect(textOf(5)).toBeNull();
    expect(textOf({ '@_id': 'x' })).toBeNull();
    expect(textOf({ child: 'x' })).toBeNull();
  });
});

describe('htmlToText', () => {
  it('leaves plain text untouched, including stray angle brackets', () => {
    expect(htmlToText('Good spot')).toBe('Good spot');
    expect(htmlToText('elk if x < 5 and y > 3')).toBe('elk if x < 5 and y > 3');
    expect(htmlToText('  keep  spaces  ')).toBe('  keep  spaces  ');
  });

  it('turns <br> and closing block tags into newlines', () => {
    expect(htmlToText('Line one<br>Line two<br/>Line three')).toBe('Line one\nLine two\nLine three');
    expect(htmlToText('<p>First</p><p>Second</p>')).toBe('First\nSecond');
    expect(htmlToText('<div>A</div><div>B</div>')).toBe('A\nB');
  });

  it('drops other tags but keeps their text, including images and links', () => {
    expect(htmlToText('<b>Bold</b> and <a href="http://x.test">link</a><img src="a.png"/>')).toBe('Bold and link');
  });

  it('separates table cells with a space and rows with a newline', () => {
    expect(htmlToText('<table><tr><td>Elev</td><td>5,400</td></tr><tr><td>Water</td><td>yes</td></tr></table>')).toBe(
      'Elev 5,400\nWater yes'
    );
  });

  it('decodes named and numeric entities once', () => {
    expect(htmlToText('<b>Fish &amp; Game</b> &lt;3 &#39;x&#39; &#x41; &nbsp;end &unknown;')).toBe(
      "Fish & Game <3 'x' A  end &unknown;"
    );
  });

  it('collapses runs of blank lines and trims the ends', () => {
    expect(htmlToText('<p>A</p><br><br><br><p>B</p>  ')).toBe('A\n\nB');
  });
});
