import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme, useThemedStyles, type ThemeColors } from '../../theme';
import { Icon, type IconName } from './Icon';

export interface ToolbarItem {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
}

/**
 * The map screen's bottom toolbar. It sits *under* the map rather than over it and pads itself by
 * `bottomInset`, so the map never runs beneath the system navigation bar (the app draws
 * edge-to-edge on Android).
 */
export function BottomToolbar({ items, bottomInset }: { items: ToolbarItem[]; bottomInset: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          onPress={item.onPress}
        >
          <Icon name={item.icon} size={24} color={colors.icon} />
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      elevation: 8,
    },
    item: { flex: 1, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 8 },
    itemPressed: { backgroundColor: c.pressed },
    label: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  });
