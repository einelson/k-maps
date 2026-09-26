/**
 * Helpers for stores that are saved between launches (Zustand `persist` over kvStorage).
 *
 * What was saved is whatever the app looked like when it last ran, so it can be missing keys (a layer
 * added in a later version) or hold values that no longer make sense. These take what's usable from it
 * and fall back to the defaults for the rest, instead of trusting it blindly.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `defaults` with any saved value laid over it. Only keys `defaults` knows about are kept (a layer removed
 * in a later version is dropped), and only values of the same type (a corrupt entry falls back to its default).
 */
export function mergeRecord<T extends Record<string, boolean | number>>(defaults: T, saved: unknown): T {
  const merged: Record<string, boolean | number> = { ...defaults };
  if (!isRecord(saved)) return merged as T;
  for (const key of Object.keys(defaults)) {
    const value = saved[key];
    if (typeof value === typeof defaults[key] && (typeof value !== 'number' || Number.isFinite(value))) {
      merged[key] = value as boolean | number;
    }
  }
  return merged as T;
}

/** A saved value when it is one of `allowed`, otherwise `fallback`. */
export function oneOf<T extends string>(saved: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(saved as T) ? (saved as T) : fallback;
}

/** A saved boolean, or `fallback` when it isn't one. */
export function boolOr(saved: unknown, fallback: boolean): boolean {
  return typeof saved === 'boolean' ? saved : fallback;
}

/** The saved value as a plain object, or an empty one — so `saved.foo` is safe to read on anything. */
export function asRecord(saved: unknown): Record<string, unknown> {
  return isRecord(saved) ? saved : {};
}
