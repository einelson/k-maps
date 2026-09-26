import { formatBytes, formatWait } from './formatBytes';

describe('formatBytes', () => {
  it.each([
    [0, '0 KB'],
    [850_000, '850 KB'],
    [3_400_000, '3.4 MB'],
    [28_000_000, '28 MB'],
    [999_000_000, '999 MB'],
    [1_400_000_000, '1.4 GB'],
    [25_000_000_000, '25 GB'],
  ])('%p bytes reads as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('formatWait', () => {
  it.each([
    [5, 'under a minute'],
    [59, 'under a minute'],
    [60, 'about 1 min'],
    [12 * 60, 'about 12 min'],
    [59 * 60, 'about 59 min'],
    [3600, 'about 1 h'],
    [80 * 60, 'about 1 h 20 min'],
    [5 * 3600 + 10 * 60, 'about 5 h 10 min'],
  ])('%p seconds reads as %s', (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });
});
