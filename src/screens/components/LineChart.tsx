import { useMemo, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import {
  areaPath,
  downsample,
  extentOf,
  linePath,
  nearestIndex,
  niceTicks,
  scaleLinear,
  toPoints,
} from '../../features/chartMath';
import { Text, useTheme, useThemedStyles, type ThemeColors } from '../../theme';

interface LineChartProps {
  title: string;
  /** Horizontal values, ascending, in the units the axis is labelled in. */
  xs: number[];
  /** One value per x; null where unknown. */
  ys: (number | null)[];
  color: string;
  formatXTick: (x: number) => string;
  formatYTick: (y: number) => string;
  /** Wording for the value under your finger; falls back to the tick formatters. */
  formatXReadout?: (x: number) => string;
  formatYReadout?: (y: number) => string;
  /** Pin the bottom of the vertical axis (e.g. 0 for a distance that only grows). */
  yMin?: number;
  height?: number;
}

const MARGIN = { top: 8, right: 10, bottom: 22, left: 46 };
/** More points than this can't be told apart on a phone-width chart. */
const MAX_DRAWN_POINTS = 240;

/**
 * A single-series line chart with an area fill, gridlines and press-and-drag scrubbing: hold a finger on
 * the chart and the readout above it follows, so you can read any moment of the track.
 */
export function LineChart({
  title,
  xs,
  ys,
  color,
  formatXTick,
  formatYTick,
  formatXReadout = formatXTick,
  formatYReadout = formatYTick,
  yMin,
  height = 150,
}: LineChartProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  const points = useMemo(() => downsample(toPoints(xs, ys), MAX_DRAWN_POINTS), [xs, ys]);

  const plot = useMemo(() => {
    const xExtent = extentOf(points.map((p) => p.x));
    const yExtentRaw = extentOf(points.map((p) => p.y));
    if (!xExtent || !yExtentRaw) return null;
    // A little headroom so the line doesn't graze the top and bottom gridlines.
    const span = yExtentRaw.max - yExtentRaw.min || Math.max(1, Math.abs(yExtentRaw.max) * 0.1);
    const yExtent = {
      min: yMin ?? yExtentRaw.min - span * 0.08,
      max: yExtentRaw.max + span * 0.08,
    };
    return { xExtent, yExtent, xTicks: niceTicks(xExtent.min, xExtent.max, 4), yTicks: niceTicks(yExtent.min, yExtent.max, 3) };
  }, [points, yMin]);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  if (!plot || points.length < 2) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.empty}>Not enough data to draw this chart.</Text>
      </View>
    );
  }

  const plotLeft = MARGIN.left;
  const plotRight = Math.max(plotLeft + 1, width - MARGIN.right);
  const plotTop = MARGIN.top;
  const plotBottom = height - MARGIN.bottom;
  const sx = (x: number) => scaleLinear(x, plot.xExtent, { min: plotLeft, max: plotRight });
  const sy = (y: number) => scaleLinear(y, plot.yExtent, { min: plotBottom, max: plotTop });
  const screen = points.map((p) => ({ x: sx(p.x), y: sy(p.y) }));

  function scrubTo(event: GestureResponderEvent) {
    const touchX = event.nativeEvent.locationX;
    const x = plot!.xExtent.min + ((touchX - plotLeft) / (plotRight - plotLeft)) * (plot!.xExtent.max - plot!.xExtent.min);
    setCursor(nearestIndex(points.map((p) => p.x), x));
  }

  const active = cursor != null ? points[cursor] : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {active && (
          <Text style={styles.readout}>
            {formatYReadout(active.y)} · {formatXReadout(active.x)}
          </Text>
        )}
      </View>
      <View
        style={{ height }}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={scrubTo}
        onResponderMove={scrubTo}
        onResponderRelease={() => setCursor(null)}
        onResponderTerminate={() => setCursor(null)}
      >
        {width > 0 && (
          <Svg width={width} height={height}>
            {plot.yTicks.map((tick) => (
              <Line
                key={`gy${tick}`}
                x1={plotLeft}
                x2={plotRight}
                y1={sy(tick)}
                y2={sy(tick)}
                stroke={colors.divider}
                strokeWidth={1}
              />
            ))}
            {plot.yTicks.map((tick) => (
              <SvgText
                key={`ty${tick}`}
                x={plotLeft - 6}
                y={sy(tick) + 3.5}
                fontSize={10}
                fill={colors.textFaint}
                textAnchor="end"
              >
                {formatYTick(tick)}
              </SvgText>
            ))}
            {plot.xTicks.map((tick) => (
              <SvgText
                key={`tx${tick}`}
                x={sx(tick)}
                y={height - 6}
                fontSize={10}
                fill={colors.textFaint}
                textAnchor="middle"
              >
                {formatXTick(tick)}
              </SvgText>
            ))}
            <Path d={areaPath(screen, plotBottom)} fill={color} fillOpacity={0.14} />
            <Path d={linePath(screen)} stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
            {active && cursor != null && (
              <>
                <Line
                  x1={screen[cursor].x}
                  x2={screen[cursor].x}
                  y1={plotTop}
                  y2={plotBottom}
                  stroke={colors.textMuted}
                  strokeWidth={1}
                  strokeDasharray="3,3"
                />
                <Circle cx={screen[cursor].x} cy={screen[cursor].y} r={4.5} fill={color} stroke={colors.surface} strokeWidth={2} />
              </>
            )}
          </Svg>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: 4 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', minHeight: 20 },
    title: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    readout: { fontSize: 13, fontWeight: '600', color: c.text },
    empty: { fontSize: 13, color: c.textFaint, paddingVertical: 12 },
  });
