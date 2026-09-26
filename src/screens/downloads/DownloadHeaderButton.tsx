import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemedStyles, type ThemeColors } from '../../theme';

interface Props {
  /** Nothing to download, not enough space, or a download is already running. */
  disabled: boolean;
  onPress: () => void;
}

/**
 * "Pick an area"'s Download button, shown at the right end of the screen's header so the picklist under the map gets
 * the room the old full-width button used to take. The reason it can't be pressed is spelled out in the footer.
 */
export function DownloadHeaderButton({ disabled, onPress }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Download"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
    >
      <Text style={styles.text}>Download</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    button: { backgroundColor: c.primary, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
    buttonDisabled: { backgroundColor: c.disabled },
    text: { color: c.onPrimary, fontWeight: '700', fontSize: 14 },
  });
