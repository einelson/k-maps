import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useSettingsStore,
  type CoordinateFormat,
  type UnitSystem,
} from '../state/useSettingsStore';
import { Text, useThemedStyles, type AppearancePreference, type ThemeColors } from '../theme';

function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.optionGroup}>
        {options.map((opt) => (
          <Pressable
            key={opt.id}
            accessibilityRole="button"
            accessibilityState={{ selected: value === opt.id }}
            style={[styles.option, value === opt.id && styles.optionActive]}
            onPress={() => onChange(opt.id)}
          >
            <Text style={value === opt.id ? styles.optionTextActive : styles.optionText}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function SettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const units = useSettingsStore((s) => s.units);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);
  const setCoordinateFormat = useSettingsStore((s) => s.setCoordinateFormat);
  const appearance = useSettingsStore((s) => s.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]}
    >
      <OptionRow<AppearancePreference>
        label="Appearance"
        value={appearance}
        onChange={setAppearance}
        options={[
          { id: 'system', label: 'System' },
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
        ]}
      />
      <OptionRow<UnitSystem>
        label="Units"
        value={units}
        onChange={setUnits}
        options={[
          { id: 'imperial', label: 'Imperial' },
          { id: 'metric', label: 'Metric' },
        ]}
      />
      <OptionRow<CoordinateFormat>
        label="Coordinates"
        value={coordinateFormat}
        onChange={setCoordinateFormat}
        options={[
          { id: 'decimal', label: 'DD' },
          { id: 'dms', label: 'DMS' },
          { id: 'utm', label: 'UTM' },
        ]}
      />

      <Text style={styles.sectionTitle}>Data sources & attribution</Text>
      <Text style={styles.body}>
        Basemaps: USGS The National Map (public domain). Public land: USGS PAD-US 4.1 (public
        domain, USGS GAP), plus BLM National SMA (private/unknown cross-check) and USFS Motor Vehicle
        Use Map (forest roads), both public domain. Roads/trails/labels: © OpenStreetMap contributors (ODbL), via
        Protomaps.
      </Text>

      <Text style={styles.sectionTitle}>Disclaimer</Text>
      <Text style={styles.body}>
        Map data may be out of date or incorrect. Public-land boundaries are for planning only —
        verify land status and access on the ground before relying on them. Not for navigation in
        emergencies.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 16, gap: 8 },
    row: { marginBottom: 16 },
    rowLabel: { fontSize: 13, color: c.textFaint, marginBottom: 6, textTransform: 'uppercase' },
    optionGroup: { flexDirection: 'row', gap: 8 },
    option: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: c.chip },
    optionActive: { backgroundColor: c.primary },
    optionText: { fontWeight: '600' },
    optionTextActive: { color: c.onPrimary, fontWeight: '600' },
    sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 16 },
    body: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginTop: 4 },
  });
