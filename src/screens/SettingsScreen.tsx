import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  useSettingsStore,
  type CoordinateFormat,
  type UnitSystem,
} from '../state/useSettingsStore';

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
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.optionGroup}>
        {options.map((opt) => (
          <Pressable
            key={opt.id}
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
  const units = useSettingsStore((s) => s.units);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);
  const setCoordinateFormat = useSettingsStore((s) => s.setCoordinateFormat);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
        domain, USGS GAP). Roads/trails/labels: © OpenStreetMap contributors (ODbL), via
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { padding: 16, gap: 8 },
  row: { marginBottom: 16 },
  rowLabel: { fontSize: 13, color: '#888', marginBottom: 6, textTransform: 'uppercase' },
  optionGroup: { flexDirection: 'row', gap: 8 },
  option: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#eee' },
  optionActive: { backgroundColor: '#2f6f4f' },
  optionText: { fontWeight: '600' },
  optionTextActive: { color: 'white', fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 16 },
  body: { fontSize: 13, color: '#555', lineHeight: 19, marginTop: 4 },
});
