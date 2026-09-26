import { Paths } from 'expo-file-system';

/** Bytes free on the phone's storage, or null when the platform won't say (so callers don't block on a guess). */
export function freeDiskBytes(): number | null {
  try {
    const free = Paths.availableDiskSpace;
    return Number.isFinite(free) && free > 0 ? free : null;
  } catch {
    return null;
  }
}
