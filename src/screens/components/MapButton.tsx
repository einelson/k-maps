import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme, useThemedStyles, type ThemeColors } from '../../theme';
import { Icon, type IconName } from './Icon';

export const MAP_BUTTON_SIZE = 44;

interface MapButtonProps {
  icon: IconName;
  /** Read out by screen readers — the button itself is icon-only. */
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** Highlighted (green) while the thing it controls is on or open. */
  active?: boolean;
  /** Small count bubble, e.g. how many filters are applied. Hidden at 0. */
  badge?: number;
}

/** The round buttons that float over the map (filters, layers, my location). */
export function MapButton({ icon, label, onPress, onLongPress, active = false, badge = 0 }: MapButtonProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.button, active && styles.buttonActive]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <Icon name={icon} size={22} color={active ? colors.onPrimary : colors.icon} />
      {badge > 0 && (
        <View style={[styles.badge, active && styles.badgeActive]}>
          <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    button: {
      width: MAP_BUTTON_SIZE,
      height: MAP_BUTTON_SIZE,
      borderRadius: MAP_BUTTON_SIZE / 2,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 3,
      shadowColor: c.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
    buttonActive: { backgroundColor: c.primary },
    badge: {
      position: 'absolute',
      top: -3,
      right: -3,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: c.primary,
      borderWidth: 1.5,
      borderColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeActive: { backgroundColor: c.surface, borderColor: c.primary },
    badgeText: { color: c.onPrimary, fontSize: 10, fontWeight: '800' },
    badgeTextActive: { color: c.primaryText },
  });
