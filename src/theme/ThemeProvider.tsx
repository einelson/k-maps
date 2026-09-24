import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { useSettingsStore } from '../state/useSettingsStore';
import { PALETTES, lightColors, resolveColorScheme, type ColorScheme, type ThemeColors } from './colors';

export interface Theme {
  scheme: ColorScheme;
  isDark: boolean;
  colors: ThemeColors;
}

const LIGHT_THEME: Theme = { scheme: 'light', isDark: false, colors: lightColors };

const ThemeContext = createContext<Theme>(LIGHT_THEME);

/**
 * Resolves the Settings appearance choice (system / light / dark) into a palette for the whole
 * tree, and mirrors the choice into React Native's Appearance so native chrome — alerts, the
 * keyboard, system bars — switches with it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSettingsStore((s) => s.appearance);
  const system = useColorScheme();
  const scheme = resolveColorScheme(preference, system);

  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const theme = useMemo<Theme>(() => ({ scheme, isDark: scheme === 'dark', colors: PALETTES[scheme] }), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Themed `StyleSheet`s. Pass a module-level factory so the sheet is rebuilt only when the theme
 * changes:
 *
 *   const makeStyles = (c: ThemeColors) => StyleSheet.create({ box: { backgroundColor: c.surface } });
 *   const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
