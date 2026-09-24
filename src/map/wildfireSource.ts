import type { DataDrivenPropertyValueSpecification } from '@maplibre/maplibre-gl-style-spec';

/** Styling and card text for the NIFC wildfire perimeter overlay (src/packs/wildfire.ts). */
export const WILDFIRE_COLOR = '#ef4444';
export const WILDFIRE_OUTLINE_COLOR = '#b91c1c';
/** Prescribed burns are planned and managed, so they read differently from an uncontrolled fire. */
export const PRESCRIBED_COLOR = '#f59e0b';
export const PRESCRIBED_OUTLINE_COLOR = '#b45309';

export const WILDFIRE_FILL_EXPRESSION = [
  'match',
  ['get', 'category'],
  'RX',
  PRESCRIBED_COLOR,
  WILDFIRE_COLOR,
] as unknown as DataDrivenPropertyValueSpecification<string>;

export const WILDFIRE_OUTLINE_EXPRESSION = [
  'match',
  ['get', 'category'],
  'RX',
  PRESCRIBED_OUTLINE_COLOR,
  WILDFIRE_OUTLINE_COLOR,
] as unknown as DataDrivenPropertyValueSpecification<string>;

export const WILDFIRE_CATEGORY_LABELS: Record<string, string> = {
  WF: 'Wildfire',
  CX: 'Wildfire complex',
  RX: 'Prescribed fire',
};

export function wildfireCategoryLabel(category: unknown): string {
  return (typeof category === 'string' && WILDFIRE_CATEGORY_LABELS[category]) || 'Wildfire';
}

/** `4848.0462` -> `4,848 acres`; null when unknown. */
export function formatAcres(acres: number | null | undefined): string | null {
  if (typeof acres !== 'number' || !Number.isFinite(acres)) return null;
  const rounded = acres < 10 ? Math.round(acres * 10) / 10 : Math.round(acres);
  return `${rounded.toLocaleString('en-US')} ${rounded === 1 ? 'acre' : 'acres'}`;
}

/** `41` -> `41% contained`; a fire with no report says so rather than implying 0%. */
export function formatContainment(percent: number | null | undefined): string {
  return typeof percent === 'number' && Number.isFinite(percent)
    ? `${Math.round(percent)}% contained`
    : 'Containment not reported';
}

/** "3 min ago", "2 h ago", "5 d ago" — how stale the perimeter data on screen is. */
export function formatAge(fetchedAtMs: number | null | undefined, nowMs: number = Date.now()): string | null {
  if (typeof fetchedAtMs !== 'number') return null;
  const minutes = Math.max(0, Math.round((nowMs - fetchedAtMs) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** `1783524540000` -> `Jul 8, 2026`. */
export function formatDate(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
