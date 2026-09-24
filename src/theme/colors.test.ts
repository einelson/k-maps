import { PALETTES, darkColors, lightColors, resolveColorScheme, type ThemeColors } from './colors';

/** WCAG relative luminance / contrast ratio for opaque #rrggbb colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('resolveColorScheme', () => {
  it('honours an explicit choice whatever the phone says', () => {
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
    expect(resolveColorScheme('light', 'dark')).toBe('light');
  });

  it('follows the phone on "system"', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
  });

  it('falls back to light when the phone reports nothing usable', () => {
    expect(resolveColorScheme('system', null)).toBe('light');
    expect(resolveColorScheme('system', undefined)).toBe('light');
    expect(resolveColorScheme('system', 'unspecified')).toBe('light');
  });
});

describe('palettes', () => {
  it('define the same roles in light and dark', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it('are keyed by scheme name', () => {
    expect(PALETTES.light).toBe(lightColors);
    expect(PALETTES.dark).toBe(darkColors);
  });

  describe.each(Object.entries(PALETTES))('%s', (_scheme, c: ThemeColors) => {
    it('keeps body text readable on both grounds', () => {
      for (const ground of [c.background, c.surface]) {
        expect(contrast(c.text, ground)).toBeGreaterThanOrEqual(7);
        expect(contrast(c.textSecondary, ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.textMuted, ground)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps captions and placeholders legible', () => {
      expect(contrast(c.textFaint, c.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(c.textFaint, c.surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(c.textFaint, c.field)).toBeGreaterThanOrEqual(3);
    });

    it('keeps brand-green and danger text legible on the ground and on chips', () => {
      for (const ground of [c.background, c.surface]) {
        expect(contrast(c.primaryText, ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.danger, ground)).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(c.primaryText, c.primaryTint)).toBeGreaterThanOrEqual(3);
      expect(contrast(c.danger, c.dangerTint)).toBeGreaterThanOrEqual(3);
    });

    it('keeps text on filled brand buttons readable', () => {
      expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
