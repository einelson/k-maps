import type { Position } from 'geojson';

import {
  MOVING_SPEED_MPS,
  computeTrackStats,
  gainAndLoss,
  haversineM,
  smoothElevations,
  type TrackSamples,
} from './trackStats';

// One degree of latitude is ~111.2 km, so a line up a meridian has an easy-to-check length.
const M_PER_DEG_LAT = 111194.9;
const north = (meters: number): Position => [-116, 43 + meters / M_PER_DEG_LAT];

describe('haversineM', () => {
  it('is zero for the same point', () => {
    expect(haversineM([-116, 43], [-116, 43])).toBe(0);
  });

  it('measures a degree of latitude at about 111.2 km', () => {
    expect(haversineM([-116, 43], [-116, 44])).toBeGreaterThan(111_000);
    expect(haversineM([-116, 43], [-116, 44])).toBeLessThan(111_400);
  });

  it('shrinks a degree of longitude with latitude', () => {
    const equator = haversineM([0, 0], [1, 0]);
    const boise = haversineM([-116, 43.6], [-115, 43.6]);
    expect(boise / equator).toBeCloseTo(Math.cos((43.6 * Math.PI) / 180), 2);
  });

  it('is symmetric', () => {
    expect(haversineM([-116, 43], [-115.5, 43.4])).toBeCloseTo(haversineM([-115.5, 43.4], [-116, 43]), 6);
  });
});

describe('smoothElevations', () => {
  it('averages each fix with its neighbours', () => {
    expect(smoothElevations([0, 10, 0, 10, 0], 1)).toEqual([5, 10 / 3, 20 / 3, 10 / 3, 5]);
  });

  it('flattens a single GPS spike', () => {
    const smoothed = smoothElevations([100, 100, 130, 100, 100]) as number[];
    expect(Math.max(...smoothed)).toBeLessThan(115);
  });

  it('keeps unknown entries unknown and ignores them in neighbours averages', () => {
    expect(smoothElevations([10, null, 30], 1)).toEqual([10, null, 30]);
  });

  it('leaves a constant series constant', () => {
    expect(smoothElevations([5, 5, 5, 5])).toEqual([5, 5, 5, 5]);
  });
});

describe('gainAndLoss', () => {
  it('adds up a steady climb', () => {
    expect(gainAndLoss([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ gainM: 9, lossM: 0 });
  });

  it('adds up a steady descent', () => {
    expect(gainAndLoss([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])).toEqual({ gainM: 0, lossM: 9 });
  });

  it('ignores wiggles smaller than the threshold', () => {
    expect(gainAndLoss([100, 101, 100, 102, 100, 101.5, 100])).toEqual({ gainM: 0, lossM: 0 });
  });

  it('counts an up-and-down of real size', () => {
    expect(gainAndLoss([100, 150, 100])).toEqual({ gainM: 50, lossM: 50 });
  });

  it('honours a custom threshold', () => {
    expect(gainAndLoss([0, 2, 0, 2, 0], 1)).toEqual({ gainM: 4, lossM: 4 });
  });

  it('handles empty and single-value input', () => {
    expect(gainAndLoss([])).toEqual({ gainM: 0, lossM: 0 });
    expect(gainAndLoss([5])).toEqual({ gainM: 0, lossM: 0 });
  });
});

describe('computeTrackStats', () => {
  // 11 points, 100 m apart, one every 60 s, climbing 10 m each: 1 km in 10 minutes.
  const coords = Array.from({ length: 11 }, (_, i) => north(i * 100));
  const samples: TrackSamples = {
    times: Array.from({ length: 11 }, (_, i) => 1_000_000 + i * 60_000),
    elevations: Array.from({ length: 11 }, (_, i) => 1000 + i * 10),
  };

  it('measures distance along the line', () => {
    const stats = computeTrackStats(coords, samples);
    expect(stats.distanceM).toBeCloseTo(1000, 0);
    expect(stats.series.distanceM).toHaveLength(11);
    expect(stats.series.distanceM[0]).toBe(0);
    expect(stats.series.distanceM[10]).toBeCloseTo(1000, 0);
  });

  it('reports elapsed and moving time, start and end', () => {
    const stats = computeTrackStats(coords, samples);
    expect(stats.elapsedMs).toBe(600_000);
    expect(stats.movingMs).toBe(600_000);
    expect(stats.startedAt).toBe(1_000_000);
    expect(stats.endedAt).toBe(1_600_000);
    expect(stats.series.elapsedS).toEqual([0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
  });

  it('averages speed over moving time', () => {
    expect(computeTrackStats(coords, samples).avgSpeedMps).toBeCloseTo(1000 / 600, 2);
  });

  it('takes elevation stats from the smoothed series', () => {
    const { elevation } = computeTrackStats(coords, samples);
    expect(elevation).not.toBeNull();
    // A true 100 m climb; smoothing pulls the two ends in by 10 m each.
    expect(elevation!.gainM).toBeGreaterThanOrEqual(80);
    expect(elevation!.gainM).toBeLessThanOrEqual(100);
    expect(elevation!.lossM).toBe(0);
    expect(elevation!.minM).toBeGreaterThanOrEqual(1000);
    expect(elevation!.maxM).toBeLessThanOrEqual(1100);
    expect(elevation!.startM).toBeLessThan(elevation!.endM);
  });

  it('leaves stopped time out of moving time', () => {
    // 10 minutes standing still at the third point, on the same coordinates.
    const stopped = [north(0), north(100), north(200), north(200), north(300)];
    const times = [0, 60_000, 120_000, 720_000, 780_000];
    const stats = computeTrackStats(stopped, { times, elevations: null });
    expect(stats.elapsedMs).toBe(780_000);
    expect(stats.movingMs).toBe(180_000);
    expect(stats.avgSpeedMps).toBeCloseTo(300 / 180, 2);
  });

  it('counts a slow crawl just above the threshold as moving, just below as stopped', () => {
    const dt = 100_000;
    const fast = computeTrackStats([north(0), north(MOVING_SPEED_MPS * 100 * 1.1)], { times: [0, dt], elevations: null });
    const slow = computeTrackStats([north(0), north(MOVING_SPEED_MPS * 100 * 0.9)], { times: [0, dt], elevations: null });
    expect(fast.movingMs).toBe(dt);
    expect(slow.movingMs).toBe(0);
    expect(slow.avgSpeedMps).toBeNull();
  });

  it('ignores a fix whose clock went backwards', () => {
    const stats = computeTrackStats([north(0), north(100), north(200)], { times: [0, 60_000, 30_000], elevations: null });
    expect(stats.movingMs).toBe(60_000);
    expect(stats.elapsedMs).toBe(30_000);
  });

  it('gives distance only when there are no samples', () => {
    const stats = computeTrackStats(coords, null);
    expect(stats.distanceM).toBeCloseTo(1000, 0);
    expect(stats.elapsedMs).toBeNull();
    expect(stats.movingMs).toBeNull();
    expect(stats.avgSpeedMps).toBeNull();
    expect(stats.elevation).toBeNull();
    expect(stats.series.elapsedS).toBeNull();
    expect(stats.series.elevationM).toBeNull();
    expect(stats.samplesMismatch).toBe(false);
  });

  it('handles samples with times but no elevations, and the reverse', () => {
    const timesOnly = computeTrackStats(coords, { times: samples.times, elevations: null });
    expect(timesOnly.elapsedMs).toBe(600_000);
    expect(timesOnly.elevation).toBeNull();
    const elevationsOnly = computeTrackStats(coords, { times: null, elevations: samples.elevations });
    expect(elevationsOnly.elapsedMs).toBeNull();
    expect(elevationsOnly.elevation).not.toBeNull();
  });

  it('treats an all-zero altitude track as having no elevation (phones report 0 when they have none)', () => {
    const stats = computeTrackStats(coords, { times: samples.times, elevations: new Array(11).fill(0) });
    expect(stats.elevation).toBeNull();
    expect(stats.series.elevationM).toBeNull();
  });

  it('treats an all-null elevation array as none', () => {
    expect(computeTrackStats(coords, { times: null, elevations: new Array(11).fill(null) }).elevation).toBeNull();
  });

  it('keeps unknown elevations out of the gain and the extremes', () => {
    const elevations = [1000, null, 1010, null, 1020, null, 1030, null, 1040, null, 1050];
    const { elevation, series } = computeTrackStats(coords, { times: null, elevations });
    expect(elevation!.minM).toBeGreaterThanOrEqual(1000);
    expect(elevation!.maxM).toBeLessThanOrEqual(1050);
    expect(series.elevationM!.filter((e) => e == null)).toHaveLength(5);
  });

  it('ignores samples that no longer match the line, and says so', () => {
    const stats = computeTrackStats(coords.slice(0, 8), samples); // vertices edited away after recording
    expect(stats.samplesMismatch).toBe(true);
    expect(stats.elapsedMs).toBeNull();
    expect(stats.elevation).toBeNull();
    expect(stats.distanceM).toBeCloseTo(700, 0);
  });

  it('copes with tiny and empty lines', () => {
    expect(computeTrackStats([], null).distanceM).toBe(0);
    expect(computeTrackStats([north(0)], null).distanceM).toBe(0);
    const single = computeTrackStats([north(0)], { times: [5], elevations: [10] });
    expect(single.elapsedMs).toBeNull(); // one fix has no duration
    expect(single.elevation).toBeNull();
  });
});
