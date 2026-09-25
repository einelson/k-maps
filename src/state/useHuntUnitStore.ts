import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { HuntStateInfo } from '../huntUnits/types';
import type { HuntUnitPackEntry } from '../packs/regionPacks';
import { kvStorage } from './kvStorage';

/** Everything the map needs about a downloaded state without asking the network: so it draws (and describes) offline. */
export interface InstalledHuntState extends HuntStateInfo {
  /** Manifest version (build timestamp) installed; a different published one means an update. */
  version: string;
  bytes: number;
  installedAt: number;
}

interface HuntUnitState {
  installed: Record<string, InstalledHuntState>;
  /** Which unit set (species) each state shows; absent = the state's first set. */
  activeSets: Record<string, string>;
  /** The hunter has read that boundaries are reference only and to check local laws (asked once, before first use). */
  disclaimerAccepted: boolean;
  acceptDisclaimer: () => void;
  /**
   * Old source data (edited 3+ years ago) the hunter has accepted, per state: what they saw, as a signature of the old
   * layers and their dates (src/map/huntUnitStaleness.ts). Data that changes, or newly ages past the line, asks again.
   */
  staleAccepted: Record<string, string>;
  acceptStale: (accepted: Record<string, string>) => void;
  markInstalled: (pack: HuntUnitPackEntry, bytes: number) => void;
  markRemoved: (state: string) => void;
  setActiveSet: (state: string, setId: string) => void;
}

/** The set to draw for a state: the chosen one if the state still has it, else its first. */
export function resolveActiveSet(info: Pick<HuntStateInfo, 'sets'>, chosen: string | undefined): string {
  return info.sets.find((set) => set.id === chosen)?.id ?? info.sets[0].id;
}

export const useHuntUnitStore = create<HuntUnitState>()(
  persist(
    (set) => ({
      installed: {},
      activeSets: {},
      disclaimerAccepted: false,
      acceptDisclaimer: () => set({ disclaimerAccepted: true }),
      staleAccepted: {},
      acceptStale: (accepted) => set((s) => ({ staleAccepted: { ...s.staleAccepted, ...accepted } })),
      markInstalled: (pack, bytes) =>
        set((s) => ({
          installed: {
            ...s.installed,
            [pack.state]: {
              state: pack.state,
              name: pack.name,
              agency: pack.agency,
              regsUrl: pack.regsUrl,
              vintage: pack.vintage,
              fetchedAt: pack.fetchedAt,
              bbox: pack.bbox,
              sets: pack.sets,
              version: pack.version,
              bytes,
              installedAt: Date.now(),
            },
          },
        })),
      markRemoved: (state) =>
        set((s) => {
          const { [state]: _removed, ...installed } = s.installed;
          const { [state]: _choice, ...activeSets } = s.activeSets;
          const { [state]: _accepted, ...staleAccepted } = s.staleAccepted; // removing it means asking again on the next download
          return { installed, activeSets, staleAccepted };
        }),
      setActiveSet: (state, setId) => set((s) => ({ activeSets: { ...s.activeSets, [state]: setId } })),
    }),
    { name: 'kmaps.huntUnits', storage: createJSONStorage(() => kvStorage) }
  )
);
