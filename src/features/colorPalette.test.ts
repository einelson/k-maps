import { FEATURE_COLOR_PALETTE } from './colorPalette';

describe('FEATURE_COLOR_PALETTE', () => {
  it('has the ~12 colours from spec §7.1', () => {
    expect(FEATURE_COLOR_PALETTE).toHaveLength(12);
  });

  it('contains only 6-digit lowercase hex colours (safe for MapLibre and SQLite text matching)', () => {
    for (const color of FEATURE_COLOR_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('has no duplicate colours', () => {
    expect(new Set(FEATURE_COLOR_PALETTE).size).toBe(FEATURE_COLOR_PALETTE.length);
  });

  it('has perceptibly distinct colours (no two within a small RGB distance)', () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let i = 0; i < FEATURE_COLOR_PALETTE.length; i++) {
      for (let j = i + 1; j < FEATURE_COLOR_PALETTE.length; j++) {
        const [r1, g1, b1] = rgb(FEATURE_COLOR_PALETTE[i]);
        const [r2, g2, b2] = rgb(FEATURE_COLOR_PALETTE[j]);
        const distance = Math.hypot(r1 - r2, g1 - g2, b1 - b2);
        expect(distance).toBeGreaterThan(40);
      }
    }
  });

  it('is a plain array of strings that callers can index by position', () => {
    expect(Array.isArray(FEATURE_COLOR_PALETTE)).toBe(true);
    expect(FEATURE_COLOR_PALETTE.every((c) => typeof c === 'string')).toBe(true);
    expect(FEATURE_COLOR_PALETTE[0]).toBeDefined();
  });
});
