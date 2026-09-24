import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';

import { useTheme } from './ThemeProvider';

/**
 * Drop-in `Text` that defaults to the theme's text colour. React Native's own `Text` is black
 * unless told otherwise, which vanishes on a dark background — so app code imports `Text` and
 * `TextInput` from here rather than from 'react-native'. An explicit `color` in `style` still wins.
 */
export function Text({ style, ...props }: TextProps) {
  const { colors } = useTheme();
  return <RNText {...props} style={[{ color: colors.text }, style]} />;
}

/** Themed `TextInput`: readable text, placeholder colour and (on iOS) a keyboard to match. */
export function TextInput({ style, ...props }: TextInputProps) {
  const { colors, isDark } = useTheme();
  return (
    <RNTextInput
      placeholderTextColor={colors.textFaint}
      keyboardAppearance={isDark ? 'dark' : 'light'}
      {...props}
      style={[{ color: colors.text }, style]}
    />
  );
}
