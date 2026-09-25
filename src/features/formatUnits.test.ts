import {
  distanceUnit,
  distanceValue,
  elevationUnit,
  elevationValue,
  formatDistance,
  formatDuration,
  formatElapsedShort,
  formatElevation,
  formatElevationChange,
  formatSpeed,
} from './formatUnits';

describe('units', () => {
  it('names the unit for each system', () => {
    expect(distanceUnit('imperial')).toBe('mi');
    expect(distanceUnit('metric')).toBe('km');
    expect(elevationUnit('imperial')).toBe('ft');
    expect(elevationUnit('metric')).toBe('m');
  });

  it('converts bare numbers for chart axes', () => {
    expect(distanceValue(1609.344, 'imperial')).toBeCloseTo(1, 6);
    expect(distanceValue(2500, 'metric')).toBe(2.5);
    expect(elevationValue(100, 'imperial')).toBeCloseTo(328.084, 3);
    expect(elevationValue(100, 'metric')).toBe(100);
  });
});

describe('formatDistance', () => {
  it('uses miles with two decimals, and feet under a tenth of a mile', () => {
    expect(formatDistance(5500, 'imperial')).toBe('3.42 mi');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatDistance(100, 'imperial')).toBe('328 ft');
    expect(formatDistance(0, 'imperial')).toBe('0 ft');
  });

  it('uses kilometres with two decimals, and metres under a kilometre', () => {
    expect(formatDistance(5500, 'metric')).toBe('5.50 km');
    expect(formatDistance(999, 'metric')).toBe('999 m');
    expect(formatDistance(1000, 'metric')).toBe('1.00 km');
  });
});

describe('formatElevation', () => {
  it('groups thousands and rounds', () => {
    expect(formatElevation(2570, 'imperial')).toBe('8,432 ft');
    expect(formatElevation(2570.4, 'metric')).toBe('2,570 m');
    expect(formatElevation(0, 'metric')).toBe('0 m');
    expect(formatElevation(999, 'metric')).toBe('999 m');
    expect(formatElevation(1234567, 'metric')).toBe('1,234,567 m');
  });

  it('prefixes a sign for climb and descent', () => {
    expect(formatElevationChange(100, 'metric', '+')).toBe('+100 m');
    expect(formatElevationChange(100, 'imperial', '-')).toBe('-328 ft');
  });

  it('drops the sign when the change rounds to zero', () => {
    expect(formatElevationChange(0, 'metric', '-')).toBe('0 m');
    expect(formatElevationChange(0.3, 'metric', '+')).toBe('0 m');
    expect(formatElevationChange(0.1, 'imperial', '-')).toBe('0 ft');
  });
});

describe('formatDuration', () => {
  it('shows m:ss under an hour and h:mm:ss after', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59_000)).toBe('0:59');
    expect(formatDuration(61_000)).toBe('1:01');
    expect(formatDuration(3_599_000)).toBe('59:59');
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(5_025_000)).toBe('1:23:45');
    expect(formatDuration(36_000_000)).toBe('10:00:00');
  });

  it('rounds to the nearest second and never goes negative', () => {
    expect(formatDuration(1_499)).toBe('0:01');
    expect(formatDuration(1_500)).toBe('0:02');
    expect(formatDuration(-5000)).toBe('0:00');
  });
});

describe('formatElapsedShort', () => {
  it('picks seconds, minutes, or hours and minutes', () => {
    expect(formatElapsedShort(0)).toBe('0s');
    expect(formatElapsedShort(45)).toBe('45s');
    expect(formatElapsedShort(60)).toBe('1m');
    expect(formatElapsedShort(750)).toBe('13m');
    expect(formatElapsedShort(3600)).toBe('1h');
    expect(formatElapsedShort(5400)).toBe('1h 30m');
  });
});

describe('formatSpeed', () => {
  it('converts m/s to mph or km/h with one decimal', () => {
    expect(formatSpeed(1, 'imperial')).toBe('2.2 mph');
    expect(formatSpeed(1, 'metric')).toBe('3.6 km/h');
    expect(formatSpeed(0, 'metric')).toBe('0.0 km/h');
  });
});
