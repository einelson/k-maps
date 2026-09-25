import type { HuntUnitPackEntry } from '../packs/regionPacks';
import type { InstalledHuntState } from '../state/useHuntUnitStore';

export type HuntUnitPackState =
  /** Not on this device. */
  | 'none'
  /** On this device and matches the published version. */
  | 'installed'
  /** On this device, but a newer version has been published. */
  | 'update';

/**
 * What the Downloads screen shows for a state. A record without its file (storage cleared, app data wiped) counts
 * as not installed, so the state can simply be downloaded again.
 */
export function huntUnitStatus(
  pack: HuntUnitPackEntry,
  record: InstalledHuntState | undefined,
  fileExists: boolean
): HuntUnitPackState {
  if (!record || !fileExists) return 'none';
  return record.version === pack.version ? 'installed' : 'update';
}
