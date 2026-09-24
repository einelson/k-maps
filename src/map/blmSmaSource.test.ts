import { BLM_AGENCY_COLORS, BLM_FILL_COLOR_EXPRESSION, blmAgencyLabel } from './blmSmaSource';

describe('blmAgencyLabel', () => {
  it('spells out the known BLM SMA codes', () => {
    expect(blmAgencyLabel('PVT')).toBe('Private');
    expect(blmAgencyLabel('UND')).toBe('Undetermined');
  });

  it('echoes an unrecognised code so unexpected data is still visible to the user', () => {
    expect(blmAgencyLabel('BLM')).toBe('BLM');
    expect(blmAgencyLabel('xyz')).toBe('xyz');
  });

  it('is case sensitive (codes come straight from the service)', () => {
    expect(blmAgencyLabel('pvt')).toBe('pvt');
  });

  it('says "Unknown" for missing values', () => {
    expect(blmAgencyLabel(null)).toBe('Unknown');
    expect(blmAgencyLabel(undefined)).toBe('Unknown');
  });
});

describe('BLM colours', () => {
  it('has a hex colour for private and undetermined land', () => {
    expect(BLM_AGENCY_COLORS.PVT).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BLM_AGENCY_COLORS.UND).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BLM_AGENCY_COLORS.PVT).not.toBe(BLM_AGENCY_COLORS.UND);
  });

  it('builds a match expression on ADMIN_AGENCY_CODE with the agency colours and a fallback', () => {
    const expression = BLM_FILL_COLOR_EXPRESSION as unknown as unknown[];
    expect(expression).toEqual([
      'match',
      ['get', 'ADMIN_AGENCY_CODE'],
      'PVT',
      BLM_AGENCY_COLORS.PVT,
      'UND',
      BLM_AGENCY_COLORS.UND,
      BLM_AGENCY_COLORS.UND, // fallback for unknown codes
    ]);
  });
});
