import { Pressable, StyleSheet, View } from 'react-native';

import { formatDistance, withThousands } from '../../features/formatUnits';
import {
  DEFAULT_FIX_SPACING_M,
  MAX_FIX_EVERY_M,
  MIN_FIX_EVERY_M,
  TRANSPORT_MODES,
  stepSpacing,
} from '../../features/transport';
import { useSettingsStore, type UnitSystem } from '../../state/useSettingsStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

const METERS_PER_MILE = 1609.344;

/** "≈ 200 points per mile": what a spacing costs in stored points, since that is most of a track's size. */
export function pointsPerDistance(spacingM: number, units: UnitSystem): string {
  const perUnit = units === 'imperial' ? METERS_PER_MILE : 1000;
  return `≈ ${withThousands(perUnit / spacingM)} points per ${units === 'imperial' ? 'mile' : 'km'}`;
}

/**
 * How far apart recorded GPS points are, per way of getting around (Settings). Stepping along a fixed ladder of
 * spacings keeps it to two taps and lets the numbers read in feet or metres to match the Units setting.
 */
export function TrackSpacingSettings() {
  const styles = useThemedStyles(makeStyles);
  const units = useSettingsStore((s) => s.units);
  const spacing = useSettingsStore((s) => s.trackSpacingM);
  const setTrackSpacing = useSettingsStore((s) => s.setTrackSpacing);
  const resetTrackSpacing = useSettingsStore((s) => s.resetTrackSpacing);
  const changed = TRANSPORT_MODES.some((mode) => spacing[mode.id] !== DEFAULT_FIX_SPACING_M[mode.id]);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Track recording</Text>
      <Text style={styles.hint}>
        How far apart recorded points are. Smaller follows every twist but makes bigger tracks and uses more battery.
        Applies to the next track you start.
      </Text>

      {TRANSPORT_MODES.map((mode) => {
        const value = spacing[mode.id];
        return (
          <View key={mode.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.modeLabel}>{mode.label}</Text>
              <Text style={styles.caption}>
                {pointsPerDistance(value, units)}
                {value === DEFAULT_FIX_SPACING_M[mode.id] ? ' · default' : ''}
              </Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Closer points for ${mode.label}`}
                accessibilityState={{ disabled: value <= MIN_FIX_EVERY_M }}
                disabled={value <= MIN_FIX_EVERY_M}
                style={[styles.stepButton, value <= MIN_FIX_EVERY_M && styles.stepDisabled]}
                onPress={() => setTrackSpacing(mode.id, stepSpacing(value, -1))}
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.value}>{formatDistance(value, units)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Wider points for ${mode.label}`}
                accessibilityState={{ disabled: value >= MAX_FIX_EVERY_M }}
                disabled={value >= MAX_FIX_EVERY_M}
                style={[styles.stepButton, value >= MAX_FIX_EVERY_M && styles.stepDisabled]}
                onPress={() => setTrackSpacing(mode.id, stepSpacing(value, 1))}
              >
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {changed && (
        <Pressable accessibilityRole="button" style={styles.reset} onPress={resetTrackSpacing}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: { marginTop: 8, gap: 4 },
    title: { fontSize: 15, fontWeight: '700', marginTop: 8 },
    hint: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
    rowText: { flex: 1 },
    modeLabel: { fontSize: 15, fontWeight: '600' },
    caption: { fontSize: 12, color: c.textMuted },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    stepButton: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: c.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDisabled: { opacity: 0.35 },
    stepText: { fontSize: 20, fontWeight: '700' },
    value: { minWidth: 64, textAlign: 'center', fontSize: 15, fontWeight: '700' },
    reset: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 8 },
    resetText: { color: c.primaryText, fontWeight: '700' },
  });
