import {
  formatAcres,
  formatAge,
  formatContainment,
  formatDate,
  wildfireCategoryLabel,
} from './wildfireSource';

describe('wildfire formatting', () => {
  it('formats acres with thousands separators and sensible rounding', () => {
    expect(formatAcres(4848.0462)).toBe('4,848 acres');
    expect(formatAcres(73183.44)).toBe('73,183 acres');
    expect(formatAcres(0.54)).toBe('0.5 acres');
    expect(formatAcres(1)).toBe('1 acre');
    expect(formatAcres(0)).toBe('0 acres');
    expect(formatAcres(null)).toBeNull();
    expect(formatAcres(undefined)).toBeNull();
    expect(formatAcres(NaN)).toBeNull();
  });

  it('says "not reported" for missing containment rather than implying 0%', () => {
    expect(formatContainment(41)).toBe('41% contained');
    expect(formatContainment(0)).toBe('0% contained');
    expect(formatContainment(99.6)).toBe('100% contained');
    expect(formatContainment(null)).toBe('Containment not reported');
    expect(formatContainment(undefined)).toBe('Containment not reported');
  });

  it('describes how stale the data is', () => {
    const now = 1_800_000_000_000;
    const ago = (ms: number) => formatAge(now - ms, now);
    expect(ago(20_000)).toBe('just now');
    expect(ago(3 * 60_000)).toBe('3 min ago');
    expect(ago(59 * 60_000)).toBe('59 min ago');
    expect(ago(2 * 3_600_000)).toBe('2 h ago');
    expect(ago(47 * 3_600_000)).toBe('47 h ago');
    expect(ago(5 * 86_400_000)).toBe('5 d ago');
    expect(formatAge(null)).toBeNull();
    expect(formatAge(now + 60_000, now)).toBe('just now'); // clock skew never yields a negative age
  });

  it('formats dates in a timezone-safe way for midday timestamps', () => {
    expect(formatDate(Date.UTC(2026, 6, 8, 12))).toBe('Jul 8, 2026');
    expect(formatDate(null)).toBeNull();
    expect(formatDate(NaN)).toBeNull();
  });

  it('labels the feed\'s incident categories', () => {
    expect(wildfireCategoryLabel('WF')).toBe('Wildfire');
    expect(wildfireCategoryLabel('CX')).toBe('Wildfire complex');
    expect(wildfireCategoryLabel('RX')).toBe('Prescribed fire');
    expect(wildfireCategoryLabel('??')).toBe('Wildfire');
    expect(wildfireCategoryLabel(undefined)).toBe('Wildfire');
  });
});
