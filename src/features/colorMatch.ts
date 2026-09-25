import { FEATURE_COLOR_PALETTE } from './colorPalette';

export type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

interface Hsl {
  hue: number; // degrees, 0-360
  saturation: number; // 0-1
  lightness: number; // 0-1
}

function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation, lightness };
}

const PALETTE = FEATURE_COLOR_PALETTE.map((hex) => ({ hex, hsl: rgbToHsl(hexToRgb(hex)) }));
/** The palette's one neutral (stone): the home for blacks and grays, whose hue means nothing. */
const NEUTRAL = PALETTE.reduce((least, c) => (c.hsl.saturation < least.hsl.saturation ? c : least));
const CHROMATIC = PALETTE.filter((c) => c !== NEUTRAL);

const hueGap = (a: number, b: number) => {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
};

/**
 * Imported files carry arbitrary colors but the app only offers its fixed palette (spec §7.1, and the
 * color filter matches on exact values), so every imported color snaps to a palette entry. Matching is by
 * hue: straight RGB distance sends dark saturated colors (Garmin's "DarkGreen") to the gray-brown neutral.
 * Blacks and grays go to the neutral. Near-white returns null: apps use white as "no tint" (KML's default
 * icon color), and snapping it to a palette hue would invent a color the source never had.
 */
export function nearestPaletteColor(rgb: Rgb): string | null {
  if (Math.min(...rgb) >= 235) return null;
  const { hue, saturation, lightness } = rgbToHsl(rgb);
  if (saturation < 0.2 || lightness < 0.1) return NEUTRAL.hex;

  let best = CHROMATIC[0];
  for (const candidate of CHROMATIC) {
    if (hueGap(hue, candidate.hsl.hue) < hueGap(hue, best.hsl.hue)) best = candidate;
  }
  return best.hex;
}

/** How to read an 8-digit hex color: CSS/GeoJSON put alpha last, Android/Garmin/OsmAnd put it first. */
export type AlphaPosition = 'first' | 'last';

/** `#rgb`, `#rrggbb` or 8-digit hex (with or without the `#`); null when unparseable or fully transparent. */
export function parseHexColor(value: string, alpha: AlphaPosition = 'last'): Rgb | null {
  let hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  if (hex.length === 3) {
    hex = [...hex].map((c) => c + c).join('');
  } else if (hex.length === 8) {
    const alphaHex = alpha === 'first' ? hex.slice(0, 2) : hex.slice(6);
    if (parseInt(alphaHex, 16) === 0) return null;
    hex = alpha === 'first' ? hex.slice(2) : hex.slice(0, 6);
  } else if (hex.length !== 6) {
    return null;
  }
  return hexToRgb(`#${hex}`);
}

/** KML colors are `aabbggrr` (alpha, blue, green, red) — the reverse of the usual RGB order. */
export function kmlColorToRgb(value: string): Rgb | null {
  const hex = value.trim();
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
  if (parseInt(hex.slice(0, 2), 16) === 0) return null;
  return [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4)].map((c) => parseInt(c, 16)) as Rgb;
}

/** The named colors Garmin's GPX `DisplayColor` extension allows (the Windows 16-color set). */
const GARMIN_COLORS: Record<string, Rgb> = {
  black: [0, 0, 0],
  darkred: [128, 0, 0],
  darkgreen: [0, 128, 0],
  darkyellow: [128, 128, 0],
  darkblue: [0, 0, 128],
  darkmagenta: [128, 0, 128],
  darkcyan: [0, 128, 128],
  lightgray: [192, 192, 192],
  darkgray: [128, 128, 128],
  red: [255, 0, 0],
  green: [0, 255, 0],
  yellow: [255, 255, 0],
  blue: [0, 0, 255],
  magenta: [255, 0, 255],
  cyan: [0, 255, 255],
  white: [255, 255, 255],
};

/** A GPX extension color: a Garmin color name, or hex (Android-style ARGB when 8 digits). */
export function gpxColorToPalette(value: string): string | null {
  const named = GARMIN_COLORS[value.trim().toLowerCase()];
  const rgb = named ?? parseHexColor(value, 'first');
  return rgb ? nearestPaletteColor(rgb) : null;
}

export function kmlColorToPalette(value: string): string | null {
  const rgb = kmlColorToRgb(value);
  return rgb ? nearestPaletteColor(rgb) : null;
}

/** GeoJSON/CSS-style hex (`#rrggbb`, `#rgb`, `#rrggbbaa`). Non-strings and other syntaxes give null. */
export function cssColorToPalette(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const rgb = parseHexColor(value, 'last');
  return rgb ? nearestPaletteColor(rgb) : null;
}
