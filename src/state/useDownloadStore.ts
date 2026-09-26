import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { LayerId } from '../downloads/types';
import { PACK_LAYER_IDS, type PackLayerId } from '../packs/types';
import { kvStorage } from './kvStorage';
import { asRecord } from './persistHelpers';

export interface QueuedCell {
  layer: LayerId;
  cx: number;
  cy: number;
  maxZoom: number;
  progress: number; // 0..1
}

interface DownloadState {
  selectedCells: { cx: number; cy: number }[];
  selectCell: (cx: number, cy: number) => void;
  deselectCell: (cx: number, cy: number) => void;
  clearSelection: () => void;
  /** Replaces the whole selection at once (picking a block adds many cells; one by one would be quadratic). */
  setSelectedCells: (cells: { cx: number; cy: number }[]) => void;

  selectedLayers: LayerId[];
  setSelectedLayers: (layers: LayerId[]) => void;

  /** Vector overlay datasets to fetch per cell (land+likely-private, MVUM, POIs, OSM roads/trails). */
  selectedPackLayers: PackLayerId[];
  setSelectedPackLayers: (layers: PackLayerId[]) => void;

  maxZoom: number;
  setMaxZoom: (z: number) => void;

  queue: QueuedCell[];
  enqueue: (cell: QueuedCell) => void;
  updateProgress: (layer: LayerId, cx: number, cy: number, progress: number) => void;
  dequeue: (layer: LayerId, cx: number, cy: number) => void;
}

const TILE_LAYER_IDS: readonly LayerId[] = ['topo', 'satellite', 'hybrid'];

/** A saved list narrowed to the ids this version knows; `fallback` when it isn't a list at all. */
function knownIds<T extends string>(saved: unknown, known: readonly T[], fallback: T[]): T[] {
  return Array.isArray(saved) ? known.filter((id) => saved.includes(id)) : fallback;
}

/**
 * What you chose to download (map tiles, overlay data, zoom) is remembered, so the next download starts from
 * the same choices. The selected cells and the queue are not: they belong to one download, not to a setting.
 */
export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      selectedCells: [],
      selectCell: (cx, cy) =>
        set((s) =>
          s.selectedCells.some((c) => c.cx === cx && c.cy === cy)
            ? s
            : { selectedCells: [...s.selectedCells, { cx, cy }] }
        ),
      deselectCell: (cx, cy) =>
        set((s) => ({ selectedCells: s.selectedCells.filter((c) => c.cx !== cx || c.cy !== cy) })),
      clearSelection: () => set({ selectedCells: [] }),
      setSelectedCells: (cells) => set({ selectedCells: cells }),

      selectedLayers: ['topo'],
      setSelectedLayers: (layers) => set({ selectedLayers: layers }),

      selectedPackLayers: ['land'],
      setSelectedPackLayers: (layers) => set({ selectedPackLayers: layers }),

      maxZoom: 16,
      setMaxZoom: (z) => set({ maxZoom: z }),

      queue: [],
      enqueue: (cell) => set((s) => ({ queue: [...s.queue, cell] })),
      updateProgress: (layer, cx, cy, progress) =>
        set((s) => ({
          queue: s.queue.map((c) => (c.layer === layer && c.cx === cx && c.cy === cy ? { ...c, progress } : c)),
        })),
      dequeue: (layer, cx, cy) =>
        set((s) => ({
          queue: s.queue.filter((c) => !(c.layer === layer && c.cx === cx && c.cy === cy)),
        })),
    }),
    {
      name: 'kmaps.downloadOptions',
      storage: createJSONStorage(() => kvStorage),
      partialize: (s) => ({
        selectedLayers: s.selectedLayers,
        selectedPackLayers: s.selectedPackLayers,
        maxZoom: s.maxZoom,
      }),
      merge: (persisted, current) => {
        const saved = asRecord(persisted);
        const maxZoom = saved.maxZoom;
        return {
          ...current,
          selectedLayers: knownIds(saved.selectedLayers, TILE_LAYER_IDS, current.selectedLayers),
          selectedPackLayers: knownIds(saved.selectedPackLayers, PACK_LAYER_IDS, current.selectedPackLayers),
          maxZoom:
            typeof maxZoom === 'number' && Number.isInteger(maxZoom) && maxZoom >= 1 && maxZoom <= 22
              ? maxZoom
              : current.maxZoom,
        };
      },
    }
  )
);
