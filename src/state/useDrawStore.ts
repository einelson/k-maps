import { create } from 'zustand';
import type { Position } from 'geojson';

import type { DrawTool } from './types';

interface DrawState {
  activeTool: DrawTool;
  setActiveTool: (tool: DrawTool) => void;

  /** Vertices of the in-progress line/polygon, in [lon, lat] order. */
  draftVertices: Position[];
  addVertex: (vertex: Position) => void;
  undoVertex: () => void;
  clearDraft: () => void;
}

export const useDrawStore = create<DrawState>((set) => ({
  activeTool: 'none',
  setActiveTool: (tool) => set({ activeTool: tool, draftVertices: [] }),

  draftVertices: [],
  addVertex: (vertex) => set((s) => ({ draftVertices: [...s.draftVertices, vertex] })),
  undoVertex: () => set((s) => ({ draftVertices: s.draftVertices.slice(0, -1) })),
  clearDraft: () => set({ draftVertices: [] }),
}));
