import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Position } from 'geojson';

import {
  distanceUnit,
  distanceValue,
  elevationUnit,
  elevationValue,
  formatDistance,
  formatDuration,
  formatElevation,
  formatElevationChange,
  formatSpeed,
  withThousands,
} from '../../features/formatUnits';
import { computeTrackStats, type TrackSamples } from '../../features/trackStats';
import { useSettingsStore } from '../../state/useSettingsStore';
import { Text, useTheme, useThemedStyles, type ThemeColors } from '../../theme';
import { LineChart } from './LineChart';

interface TrackDashboardProps {
  coordinates: Position[];
  samples: TrackSamples | null;
  /** True for a track this app recorded, which is what makes a missing time/elevation worth explaining. */
  recorded: boolean;
  /** The recording is still going: data is still arriving, so a gap isn't yet a problem worth explaining. */
  live?: boolean;
}

const DISTANCE_COLOR = '#3b82f6';
/** The elevation chart can run against elapsed time or distance travelled. */
type ElevationAxis = 'time' | 'distance';

/** Picks seconds, minutes or hours for the time axis so its ticks land on round numbers. */
function timeAxis(totalSeconds: number): { unitS: number; suffix: string } {
  if (totalSeconds < 120) return { unitS: 1, suffix: 's' };
  if (totalSeconds < 2 * 3600) return { unitS: 60, suffix: 'm' };
  return { unitS: 3600, suffix: 'h' };
}

const trimmed = (n: number) => String(Number(n.toFixed(2)));

function Tile({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

/**
 * What you see when you tap a recorded track: time, distance, speed and climb at a glance, then an elevation
 * chart (against time or distance) and a distance-over-time chart. Numbers follow the Settings unit choice.
 */
export function TrackDashboard({ coordinates, samples, recorded, live = false }: TrackDashboardProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const units = useSettingsStore((s) => s.units);
  const [elevationAxis, setElevationAxis] = useState<ElevationAxis>('time');

  const stats = useMemo(() => computeTrackStats(coordinates, samples), [coordinates, samples]);
  const { series, elevation } = stats;

  const totalS = series.elapsedS ? series.elapsedS[series.elapsedS.length - 1] : 0;
  const axis = timeAxis(totalS);
  const timeXs = useMemo(() => series.elapsedS?.map((s) => s / axis.unitS) ?? [], [series.elapsedS, axis.unitS]);
  const distanceXs = useMemo(() => series.distanceM.map((m) => distanceValue(m, units)), [series.distanceM, units]);
  const elevationYs = useMemo(
    () => series.elevationM?.map((m) => (m == null ? null : elevationValue(m, units))) ?? [],
    [series.elevationM, units]
  );

  const timeTick = (x: number) => `${trimmed(x)}${axis.suffix}`;
  const timeReadout = (x: number) => formatDuration(x * axis.unitS * 1000);
  const distanceTick = (x: number) => trimmed(x);
  const distanceReadout = (x: number) => `${x.toFixed(2)} ${distanceUnit(units)}`;

  const hasTime = stats.elapsedMs != null;
  const chartAxis: ElevationAxis = hasTime ? elevationAxis : 'distance';

  if (live && coordinates.length < 2) {
    return <Text style={styles.note}>Waiting for GPS. Stats and charts appear once a couple of points are recorded.</Text>;
  }

  return (
    <View style={styles.wrap}>
      {!live && stats.startedAt != null && (
        <Text style={styles.when}>Recorded {new Date(stats.startedAt).toLocaleString()}</Text>
      )}

      <View style={styles.tiles}>
        <Tile styles={styles} label="Distance" value={formatDistance(stats.distanceM, units)} />
        {stats.elapsedMs != null && <Tile styles={styles} label="Time" value={formatDuration(stats.elapsedMs)} />}
        {stats.movingMs != null && <Tile styles={styles} label="Moving time" value={formatDuration(stats.movingMs)} />}
        {stats.avgSpeedMps != null && <Tile styles={styles} label="Avg speed" value={formatSpeed(stats.avgSpeedMps, units)} />}
        {elevation && <Tile styles={styles} label="Climb" value={formatElevationChange(elevation.gainM, units, '+')} />}
        {elevation && <Tile styles={styles} label="Descent" value={formatElevationChange(elevation.lossM, units, '-')} />}
        {elevation && <Tile styles={styles} label="High point" value={formatElevation(elevation.maxM, units)} />}
        {elevation && <Tile styles={styles} label="Low point" value={formatElevation(elevation.minM, units)} />}
      </View>

      {elevation ? (
        <View style={styles.chartBlock}>
          {hasTime && (
            <View style={styles.axisRow}>
              <Text style={styles.axisLabel}>Elevation over</Text>
              {(['time', 'distance'] as const).map((option) => (
                <Pressable
                  key={option}
                  style={[styles.axisChip, chartAxis === option && styles.axisChipActive]}
                  onPress={() => setElevationAxis(option)}
                >
                  <Text style={chartAxis === option ? styles.axisChipTextActive : styles.axisChipText}>
                    {option === 'time' ? 'Time' : 'Distance'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <LineChart
            title={hasTime ? `Elevation (${elevationUnit(units)})` : `Elevation over distance (${elevationUnit(units)})`}
            xs={chartAxis === 'time' ? timeXs : distanceXs}
            ys={elevationYs}
            color={colors.primaryText}
            formatXTick={chartAxis === 'time' ? timeTick : distanceTick}
            formatXReadout={chartAxis === 'time' ? timeReadout : distanceReadout}
            formatYTick={(y) => String(Math.round(y))}
            formatYReadout={(y) => `${withThousands(y)} ${elevationUnit(units)}`}
          />
          <Text style={styles.footnote}>
            Elevation is GPS altitude, smoothed. Climb and descent are reliable; the absolute height can read tens of
            metres off.
          </Text>
        </View>
      ) : (
        <Text style={styles.note}>
          {stats.samplesMismatch
            ? "This track's shape was edited after it was recorded, so its saved time and elevation no longer line up."
            : live
              ? 'Elevation appears once your phone reports altitude.'
              : recorded
                ? 'No elevation was recorded for this track.'
                : 'This file had no elevation data.'}
        </Text>
      )}

      {series.elapsedS && (
        <View style={styles.chartBlock}>
          <LineChart
            title={`Distance over time (${distanceUnit(units)})`}
            xs={timeXs}
            ys={distanceXs}
            color={DISTANCE_COLOR}
            yMin={0}
            formatXTick={timeTick}
            formatXReadout={timeReadout}
            formatYTick={trimmed}
            formatYReadout={(y) => `${y.toFixed(2)} ${distanceUnit(units)}`}
          />
        </View>
      )}

      {!hasTime && !stats.samplesMismatch && !live && (
        <Text style={styles.note}>
          {recorded
            ? 'This track was saved before times were recorded, so only its distance is available.'
            : 'This file had no timestamps, so time-based stats and the distance-over-time chart are unavailable.'}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: 16, paddingBottom: 4 },
    when: { fontSize: 13, color: c.textMuted },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tile: {
      flexGrow: 1,
      flexBasis: '47%',
      backgroundColor: c.field,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 2,
    },
    tileLabel: { fontSize: 11, color: c.textFaint, textTransform: 'uppercase' },
    tileValue: { fontSize: 20, fontWeight: '700' },
    chartBlock: { gap: 8 },
    axisRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    axisLabel: { fontSize: 12, color: c.textFaint },
    axisChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: c.chip },
    axisChipActive: { backgroundColor: c.primary },
    axisChipText: { fontSize: 12, fontWeight: '600' },
    axisChipTextActive: { fontSize: 12, fontWeight: '600', color: c.onPrimary },
    footnote: { fontSize: 11, color: c.textFaint },
    note: { fontSize: 13, color: c.textMuted },
  });
