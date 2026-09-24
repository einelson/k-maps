import { Directory, File, Paths } from 'expo-file-system';

import { GLYPH_RANGES } from './glyphData';

/**
 * Offline text-label glyphs. MapLibre needs SDF glyph PBFs to draw any text;
 * with no font server the app ships a Latin subset (src/map/glyphData.ts) and
 * writes it to the documents directory once, then the style's `glyphs` URL
 * points at those local files. `textFont` in symbol layers must be
 * `GLYPH_FONT_STACK`.
 */
export const GLYPH_FONT_STACK = 'KMapsSans';
export const TEXT_FONT = [GLYPH_FONT_STACK];

const GLYPHS_DIRECTORY = new Directory(Paths.document, 'glyphs', GLYPH_FONT_STACK);

/** `file://` template MapLibre substitutes {fontstack}/{range} into. */
export const GLYPHS_URL_TEMPLATE = `${Paths.document.uri.replace(/\/?$/, '/')}glyphs/{fontstack}/{range}.pbf`;

let ensured = false;

/**
 * Writes any glyph range file that's missing or the wrong size. Synchronous
 * so it can run before the first map render. Safe to call repeatedly; a
 * failure only costs labels, so it's logged, not thrown.
 */
export function ensureGlyphs(): void {
  if (ensured) return;
  try {
    GLYPHS_DIRECTORY.create({ intermediates: true, idempotent: true });
    for (const [range, base64] of Object.entries(GLYPH_RANGES)) {
      const file = new File(GLYPHS_DIRECTORY, `${range}.pbf`);
      const expectedBytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
      if (file.exists && file.size === expectedBytes) continue;
      file.create({ intermediates: true, overwrite: true });
      file.write(base64, { encoding: 'base64' });
    }
    ensured = true;
  } catch (err) {
    console.warn('Could not write map label glyphs; labels will be hidden', err);
  }
}
