import type { UnitSystem } from '../state/useSettingsStore';

const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

/** 12345 -> "12,345" (no Intl: keeps the output identical on every JS engine). */
export function withThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function distanceUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'mi' : 'km';
}

export function elevationUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'ft' : 'm';
}

export function speedUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}

/** Metres -> miles or kilometres, as a bare number (chart axes). */
export function distanceValue(meters: number, units: UnitSystem): number {
  return units === 'imperial' ? meters / METERS_PER_MILE : meters / 1000;
}

/** Metres -> feet or metres, as a bare number (chart axes). */
export function elevationValue(meters: number, units: UnitSystem): number {
  return units === 'imperial' ? meters * FEET_PER_METER : meters;
}

/** "3.42 mi" / "5.50 km"; short distances read better in feet or metres. */
export function formatDistance(meters: number, units: UnitSystem): string {
  if (units === 'imperial') {
    if (meters < 0.1 * METERS_PER_MILE) return `${withThousands(meters * FEET_PER_METER)} ft`;
    return `${(meters / METERS_PER_MILE).toFixed(2)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/** "8,432 ft" / "2,570 m". */
export function formatElevation(meters: number, units: UnitSystem): string {
  return `${withThousands(elevationValue(meters, units))} ${elevationUnit(units)}`;
}

/** Signed climb/descent, e.g. "+1,204 ft"; a change that rounds to nothing carries no sign ("0 ft", never "-0 ft"). */
export function formatElevationChange(meters: number, units: UnitSystem, sign: '+' | '-'): string {
  const text = formatElevation(meters, units);
  return Math.round(elevationValue(meters, units)) === 0 ? text : `${sign}${text}`;
}

/** "1:23:45", or "23:45" under an hour. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** Axis label for elapsed seconds: "45s", "12m", "1h 30m". */
export function formatElapsedShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "2.8 mph" / "4.5 km/h". */
export function formatSpeed(metersPerSecond: number, units: UnitSystem): string {
  const value = units === 'imperial' ? metersPerSecond * 2.236936 : metersPerSecond * 3.6;
  return `${value.toFixed(1)} ${speedUnit(units)}`;
}
