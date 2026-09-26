import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useThemedStyles, type ThemeColors } from '../../theme';

interface Props<T extends string> {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}

/** Equal-width tabs in one rounded bar — the top-level switch on a screen with a few distinct jobs. */
export function SegmentedTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(tab.id)}
          >
            <Text style={active ? styles.labelActive : styles.label} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    bar: { flexDirection: 'row', backgroundColor: c.chip, borderRadius: 10, padding: 3, gap: 3 },
    tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
    tabActive: { backgroundColor: c.primary },
    label: { fontWeight: '600', fontSize: 13 },
    labelActive: { fontWeight: '700', fontSize: 13, color: c.onPrimary },
  });
