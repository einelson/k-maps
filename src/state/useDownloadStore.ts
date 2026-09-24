import { create } from 'zustand';

import type { LayerId } from '../downloads/types';
import type { PackLayerId } from '../packs/types';

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

export const useDownloadStore = create<DownloadState>((set) => ({
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
      queue: s.queue.map((c) =>
        c.layer === layer && c.cx === cx && c.cy === cy ? { ...c, progress } : c
      ),
    })),
  dequeue: (layer, cx, cy) =>
    set((s) => ({
      queue: s.queue.filter((c) => !(c.layer === layer && c.cx === cx && c.cy === cy)),
    })),
}));
