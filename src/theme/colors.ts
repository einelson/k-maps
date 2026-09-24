/** What the user picked in Settings: follow the phone, or force one look. */
export type AppearancePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

/**
 * Semantic UI colours. Screens ask for a role ("surface", "textMuted"), never a hex value, so
 * both palettes stay in step. Map artwork (feature/pin colours, map layer paints) is deliberately
 * not themed — it has to read against the map tiles, not against the app chrome.
 */
export interface ThemeColors {
  /** Screen background. */
  background: string;
  /** Cards, sheets, toolbars and floating panels. */
  surface: string;
  /** Text fields and list rows sitting on `background` or `surface`. */
  field: string;
  /** Unselected chip / segmented button. */
  chip: string;
  /** Held-down state for a row or toolbar item. */
  pressed: string;
  /** Hairline under list rows. */
  divider: string;
  /** Stronger separators and outlines. */
  border: string;
  /** Checkbox outlines and other controls that must stay visible. */
  borderStrong: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  /** Placeholders, captions, disabled labels. */
  textFaint: string;
  /** Default glyph colour for icons. */
  icon: string;

  /** Filled brand green (buttons, selected chips). Pair with `onPrimary`. */
  primary: string;
  onPrimary: string;
  /** Brand green used as text or an outline on `background`/`surface` (lighter in dark mode so it stays legible). */
  primaryText: string;
  /** Background of a selected row or tile. */
  primaryTint: string;

  danger: string;
  dangerTint: string;

  /** Dims the screen behind a bottom sheet. */
  scrim: string;
  /** Translucent panels drawn straight on the map (coordinate readout, attribution). */
  overlay: string;
  overlayFaint: string;
  /** Sheet drag handle. */
  handle: string;
  /** Ring drawn around the selected colour swatch. */
  selectionRing: string;
  /** Disabled filled button. */
  disabled: string;
  shadow: string;
}

export const lightColors: ThemeColors = {
  background: '#ffffff',
  surface: '#ffffff',
  field: '#f2f3f1',
  chip: '#eeeeee',
  pressed: '#f0f0f0',
  divider: '#eeeeee',
  border: '#dddddd',
  borderStrong: '#999999',

  text: '#111111',
  textSecondary: '#4d4d4d',
  textMuted: '#6e6e6e',
  textFaint: '#888888',
  icon: '#222222',

  primary: '#2f6f4f',
  onPrimary: '#ffffff',
  primaryText: '#2f6f4f',
  primaryTint: '#e3efe8',

  danger: '#c0392b',
  dangerTint: '#f6d5d5',

  scrim: 'rgba(0,0,0,0.4)',
  overlay: 'rgba(255,255,255,0.92)',
  overlayFaint: 'rgba(255,255,255,0.75)',
  handle: '#d4d4d4',
  selectionRing: '#333333',
  disabled: '#aaaaaa',
  shadow: '#000000',
};

export const darkColors: ThemeColors = {
  background: '#121413',
  surface: '#1c1e1d',
  field: '#292c2a',
  chip: '#2b2e2c',
  pressed: '#2a2d2b',
  divider: '#2c2f2d',
  border: '#3a3d3b',
  borderStrong: '#6b6f6c',

  text: '#ececec',
  textSecondary: '#c2c6c3',
  textMuted: '#9da29f',
  textFaint: '#7d817e',
  icon: '#e6e6e6',

  primary: '#35805b',
  onPrimary: '#ffffff',
  primaryText: '#66c295',
  primaryTint: '#1f3329',

  danger: '#ef6f62',
  dangerTint: '#3d2320',

  scrim: 'rgba(0,0,0,0.6)',
  overlay: 'rgba(28,30,29,0.92)',
  overlayFaint: 'rgba(28,30,29,0.75)',
  handle: '#4a4d4b',
  selectionRing: '#ffffff',
  disabled: '#4a4d4b',
  shadow: '#000000',
};

export const PALETTES: Record<ColorScheme, ThemeColors> = { light: lightColors, dark: darkColors };

/**
 * The look to draw: the user's explicit choice, else whatever the phone is set to. `system` is
 * React Native's `useColorScheme()` value, which can also be 'unspecified' — that means light.
 */
export function resolveColorScheme(
  preference: AppearancePreference,
  system: string | null | undefined
): ColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
