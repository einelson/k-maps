import {
  LAND_FILL_COLOR_EXPRESSION,
  PUB_ACCESS_COLORS,
  PUB_ACCESS_LABELS,
  pubAccessLabel,
  type PubAccessCode,
} from './landSource';

const codes: PubAccessCode[] = ['OA', 'RA', 'XA', 'UK'];

describe('pubAccessLabel', () => {
  it('names each PAD-US Pub_Access code', () => {
    expect(pubAccessLabel('OA')).toBe('Open');
    expect(pubAccessLabel('RA')).toBe('Restricted');
    expect(pubAccessLabel('XA')).toBe('Closed');
    expect(pubAccessLabel('UK')).toBe('Unknown access');
  });

  it('falls back to "Unknown access" for unrecognised, empty or missing codes', () => {
    expect(pubAccessLabel('ZZ')).toBe('Unknown access');
    expect(pubAccessLabel('oa')).toBe('Unknown access'); // case sensitive, like the source data
    expect(pubAccessLabel('')).toBe('Unknown access');
    expect(pubAccessLabel(null)).toBe('Unknown access');
    expect(pubAccessLabel(undefined)).toBe('Unknown access');
  });
});

describe('land colours', () => {
  it('defines a label and distinct hex colour for each access code', () => {
    for (const code of codes) {
      expect(PUB_ACCESS_LABELS[code]).toEqual(expect.any(String));
      expect(PUB_ACCESS_COLORS[code]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(codes.map((c) => PUB_ACCESS_COLORS[c])).size).toBe(codes.length);
  });

  it('fill expression matches on Pub_Access and falls back to the "unknown" colour', () => {
    expect(LAND_FILL_COLOR_EXPRESSION as unknown).toEqual([
      'match',
      ['get', 'Pub_Access'],
      'OA',
      PUB_ACCESS_COLORS.OA,
      'RA',
      PUB_ACCESS_COLORS.RA,
      'XA',
      PUB_ACCESS_COLORS.XA,
      'UK',
      PUB_ACCESS_COLORS.UK,
      PUB_ACCESS_COLORS.UK,
    ]);
  });
});
