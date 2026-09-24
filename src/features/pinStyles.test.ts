import { existsSync } from 'node:fs';
import path from 'node:path';

import { FEATURE_COLOR_PALETTE } from './colorPalette';
import { DEFAULT_PIN_COLOR, DEFAULT_PIN_STYLE, PIN_STYLES, resolvePinStyle } from './pinStyles';
import { MAP_PIN_IMAGES, PIN_BODY_IMAGE, PIN_GLYPH_IMAGE_PREFIX, PIN_MASKS } from '../map/pinImages';

describe('resolvePinStyle', () => {
  it('passes known styles through', () => {
    for (const style of PIN_STYLES) expect(resolvePinStyle(style.id)).toBe(style.id);
  });

  it('falls back to the plain pin for null, empty and unknown values', () => {
    expect(resolvePinStyle(null)).toBe(DEFAULT_PIN_STYLE);
    expect(resolvePinStyle(undefined)).toBe(DEFAULT_PIN_STYLE);
    expect(resolvePinStyle('')).toBe(DEFAULT_PIN_STYLE);
    expect(resolvePinStyle('campfire-emoji')).toBe(DEFAULT_PIN_STYLE);
  });
});

describe('pin style registry', () => {
  it('has unique ids and labels', () => {
    expect(new Set(PIN_STYLES.map((s) => s.id)).size).toBe(PIN_STYLES.length);
    expect(new Set(PIN_STYLES.map((s) => s.label)).size).toBe(PIN_STYLES.length);
  });

  it('uses a palette colour for new pins, distinct from the blue location dot', () => {
    expect(FEATURE_COLOR_PALETTE).toContain(DEFAULT_PIN_COLOR);
    expect(DEFAULT_PIN_COLOR).not.toBe('#3b82f6');
  });

  it('registers a map image for the body and for every style, so no pin renders blank', () => {
    expect(Object.keys(MAP_PIN_IMAGES).sort()).toEqual(
      [PIN_BODY_IMAGE, ...PIN_STYLES.map((s) => `${PIN_GLYPH_IMAGE_PREFIX}${s.id}`)].sort()
    );
    for (const entry of Object.values(MAP_PIN_IMAGES)) expect(entry.sdf).toBe(true);
  });

  it('has UI masks for the body and every style', () => {
    for (const key of ['body', ...PIN_STYLES.map((s) => s.id)] as const) {
      expect(PIN_MASKS[key]).toBeDefined();
    }
  });

  it('has generated artwork on disk for every style (run tools/build_pin_icons.mjs if this fails)', () => {
    const dir = path.join(__dirname, '..', '..', 'assets', 'pins');
    for (const part of ['body', ...PIN_STYLES.map((s) => s.id)]) {
      expect(existsSync(path.join(dir, `sdf-${part}.png`))).toBe(true);
      expect(existsSync(path.join(dir, `mask-${part}.png`))).toBe(true);
    }
  });
});
