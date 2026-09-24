import { addTagNames, parseTagNames } from './tagInput';

describe('parseTagNames', () => {
  it('splits on commas and newlines and trims', () => {
    expect(parseTagNames(' elk , water\nridge ')).toEqual(['elk', 'water', 'ridge']);
  });

  it('strips leading hashes, collapses inner whitespace, drops blanks', () => {
    expect(parseTagNames('#elk,,  two   words ,#,')).toEqual(['elk', 'two words']);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(parseTagNames('')).toEqual([]);
    expect(parseTagNames('  , \n ')).toEqual([]);
  });
});

describe('addTagNames', () => {
  it('appends new tags in order', () => {
    expect(addTagNames(['elk'], 'water, ridge')).toEqual(['elk', 'water', 'ridge']);
  });

  it('skips duplicates case-insensitively, including within the input itself', () => {
    expect(addTagNames(['Elk'], 'elk, water, WATER')).toEqual(['Elk', 'water']);
  });

  it("reuses an existing tag's spelling instead of creating a near-duplicate", () => {
    expect(addTagNames([], 'elk', ['Elk', 'Water'])).toEqual(['Elk']);
  });

  it('does not mutate the list it was given', () => {
    const current = ['elk'];
    addTagNames(current, 'water');
    expect(current).toEqual(['elk']);
  });
});
