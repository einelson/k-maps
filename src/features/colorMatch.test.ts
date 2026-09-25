import { FEATURE_COLOR_PALETTE } from './colorPalette';
import {
  cssColorToPalette,
  gpxColorToPalette,
  kmlColorToPalette,
  kmlColorToRgb,
  nearestPaletteColor,
  parseHexColor,
} from './colorMatch';

describe('nearestPaletteColor', () => {
  it('returns each palette color for itself', () => {
    for (const hex of FEATURE_COLOR_PALETTE) {
      const rgb = parseHexColor(hex)!;
      expect(nearestPaletteColor(rgb)).toBe(hex);
    }
  });

  it('snaps off-palette colors to the closest hue', () => {
    expect(nearestPaletteColor([255, 0, 0])).toBe('#e11d48'); // pure red -> red
    expect(nearestPaletteColor([0, 0, 255])).toBe('#6366f1'); // pure blue -> indigo (closest available)
    expect(nearestPaletteColor([0, 128, 0])).toBe('#22c55e'); // dark green -> green, not the neutral
    expect(nearestPaletteColor([128, 128, 0])).toBe('#eab308'); // dark yellow -> yellow
    expect(nearestPaletteColor([255, 120, 0])).toBe('#f97316'); // orange
    expect(nearestPaletteColor([1, 136, 209])).toBe('#06b6d4'); // Google My Maps' default blue sits between cyan and blue
  });

  it('sends blacks and grays to the neutral stone', () => {
    expect(nearestPaletteColor([0, 0, 0])).toBe('#57534e');
    expect(nearestPaletteColor([128, 128, 128])).toBe('#57534e');
    expect(nearestPaletteColor([192, 192, 192])).toBe('#57534e');
    expect(nearestPaletteColor([0, 0, 30])).toBe('#57534e'); // too dark for its hue to mean anything
  });

  it('returns null for white and near-white, which mean "no tint"', () => {
    expect(nearestPaletteColor([255, 255, 255])).toBeNull();
    expect(nearestPaletteColor([240, 250, 245])).toBeNull();
    expect(nearestPaletteColor([234, 255, 255])).not.toBeNull();
  });
});

describe('parseHexColor', () => {
  it('reads 6-digit hex with or without #, in any case', () => {
    expect(parseHexColor('#ff8000')).toEqual([255, 128, 0]);
    expect(parseHexColor('FF8000')).toEqual([255, 128, 0]);
  });

  it('expands 3-digit shorthand', () => {
    expect(parseHexColor('#f80')).toEqual([255, 136, 0]);
  });

  it('reads 8-digit hex with alpha last (CSS) or first (Android)', () => {
    expect(parseHexColor('#ff8000cc', 'last')).toEqual([255, 128, 0]);
    expect(parseHexColor('#ccff8000', 'first')).toEqual([255, 128, 0]);
  });

  it('gives null for a fully transparent 8-digit color', () => {
    expect(parseHexColor('#ff800000', 'last')).toBeNull();
    expect(parseHexColor('#00ff8000', 'first')).toBeNull();
  });

  it('gives null for anything that is not hex', () => {
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('rgb(1,2,3)')).toBeNull();
    expect(parseHexColor('#gg0000')).toBeNull();
  });
});

describe('kmlColorToRgb', () => {
  it('reverses aabbggrr into RGB', () => {
    expect(kmlColorToRgb('ff0000ff')).toEqual([255, 0, 0]);
    expect(kmlColorToRgb('ffff0000')).toEqual([0, 0, 255]);
    expect(kmlColorToRgb('ff00ff00')).toEqual([0, 255, 0]);
  });

  it('ignores alpha unless it is zero', () => {
    expect(kmlColorToRgb('7f0000ff')).toEqual([255, 0, 0]);
    expect(kmlColorToRgb('000000ff')).toBeNull();
  });

  it('rejects malformed values', () => {
    expect(kmlColorToRgb('ff0000')).toBeNull();
    expect(kmlColorToRgb('zzzzzzzz')).toBeNull();
    expect(kmlColorToRgb('')).toBeNull();
  });
});

describe('palette conversions', () => {
  it('kmlColorToPalette maps KML red to the palette red and white to null', () => {
    expect(kmlColorToPalette('ff0000ff')).toBe('#e11d48');
    expect(kmlColorToPalette('ffffffff')).toBeNull();
    expect(kmlColorToPalette('nope')).toBeNull();
  });

  it('gpxColorToPalette accepts Garmin names (any case) and hex', () => {
    expect(gpxColorToPalette('Red')).toBe('#e11d48');
    expect(gpxColorToPalette('darkgreen')).toBe('#22c55e');
    expect(gpxColorToPalette('#ff0000')).toBe('#e11d48');
    expect(gpxColorToPalette('ffff0000')).toBe('#e11d48'); // ARGB
    expect(gpxColorToPalette('White')).toBeNull();
    expect(gpxColorToPalette('Transparent')).toBeNull();
    expect(gpxColorToPalette('chartreuse')).toBeNull();
  });

  it('cssColorToPalette accepts hex strings only', () => {
    expect(cssColorToPalette('#e11d48')).toBe('#e11d48');
    expect(cssColorToPalette('#f00')).toBe('#e11d48');
    expect(cssColorToPalette('#ff0000ff')).toBe('#e11d48');
    expect(cssColorToPalette(undefined)).toBeNull();
    expect(cssColorToPalette(42)).toBeNull();
    expect(cssColorToPalette('red')).toBeNull();
  });
});
