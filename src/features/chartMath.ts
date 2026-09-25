/** Pure geometry for the track charts, kept out of the SVG component so it can be tested. */

/** Round tick values (1, 2, 5 × 10ⁿ) covering [min, max]; always at least two. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max === min) return [min];
  const rough = (max - min) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Rounding each tick to the step's decimals keeps 0.1 + 0.2 style float dust out of the labels.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = first; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(decimals)));
  return ticks;
}

export interface ChartPoint {
  x: number;
  y: number;
}

/** Pairs up x and y, dropping points whose y is unknown (the line just bridges them). */
export function toPoints(xs: number[], ys: (number | null)[]): ChartPoint[] {
  const points: ChartPoint[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (y != null && Number.isFinite(y) && Number.isFinite(xs[i])) points.push({ x: xs[i], y });
  }
  return points;
}

/**
 * Thins a long series to about `maxPoints` for drawing. Each bucket keeps its lowest and highest point (in x
 * order) rather than an average, so a peak or dip survives the thinning.
 */
export function downsample(points: ChartPoint[], maxPoints: number): ChartPoint[] {
  if (points.length <= maxPoints || maxPoints < 4) return points;
  const bucketCount = Math.floor(maxPoints / 2) - 1;
  const bucketSize = (points.length - 2) / bucketCount;
  const out: ChartPoint[] = [points[0]];
  for (let b = 0; b < bucketCount; b++) {
    const start = 1 + Math.floor(b * bucketSize);
    const end = Math.min(points.length - 1, 1 + Math.floor((b + 1) * bucketSize));
    let lowest = start;
    let highest = start;
    for (let i = start; i < end; i++) {
      if (points[i].y < points[lowest].y) lowest = i;
      if (points[i].y > points[highest].y) highest = i;
    }
    if (lowest === highest) out.push(points[lowest]);
    else out.push(...(lowest < highest ? [points[lowest], points[highest]] : [points[highest], points[lowest]]));
  }
  out.push(points[points.length - 1]);
  return out;
}

export interface Extent {
  min: number;
  max: number;
}

export function extentOf(values: number[]): Extent | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** Maps `value` from `domain` onto `range`; a zero-width domain lands in the middle of the range. */
export function scaleLinear(value: number, domain: Extent, range: Extent): number {
  if (domain.max === domain.min) return (range.min + range.max) / 2;
  return range.min + ((value - domain.min) / (domain.max - domain.min)) * (range.max - range.min);
}

/** SVG path data for a polyline through already-scaled screen points. */
export function linePath(screenPoints: { x: number; y: number }[]): string {
  return screenPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** The same polyline closed down to `baselineY`, for the shaded area under a line. */
export function areaPath(screenPoints: { x: number; y: number }[], baselineY: number): string {
  if (screenPoints.length === 0) return '';
  const first = screenPoints[0];
  const last = screenPoints[screenPoints.length - 1];
  return `${linePath(screenPoints)} L${last.x.toFixed(1)} ${baselineY.toFixed(1)} L${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
}

/** Index of the point whose x is nearest `x`; `xs` must be sorted ascending. */
export function nearestIndex(xs: number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}
