import { create } from 'zustand';

import type { FeatureType } from '../data/types';
import {
  canRemoveVertex,
  insertVertex,
  moveVertex,
  removeVertex,
  type Vertex,
} from '../features/vertexEdit';

/**
 * Geometry editing session for one saved feature (§7.3 "Edit: select feature,
 * drag vertices, delete vertex"). The vertex list is the working copy; nothing
 * touches SQLite until the map screen saves it. `history` holds prior states
 * for undo.
 */
interface EditState {
  featureId: number | null;
  type: FeatureType | null;
  vertices: Vertex[];
  selected: number | null;
  history: Vertex[][];

  begin: (featureId: number, type: FeatureType, vertices: Vertex[]) => void;
  end: () => void;
  select: (index: number | null) => void;
  move: (index: number, to: Vertex) => void;
  insert: (index: number, at: Vertex) => void;
  remove: (index: number) => void;
  undo: () => void;
}

const idle = (): Pick<EditState, 'featureId' | 'type' | 'vertices' | 'selected' | 'history'> => ({
  featureId: null,
  type: null,
  vertices: [],
  selected: null,
  history: [],
});

export const useEditStore = create<EditState>((set, get) => ({
  ...idle(),

  begin: (featureId, type, vertices) =>
    set({ featureId, type, vertices, selected: type === 'point' ? 0 : null, history: [] }),
  end: () => set(idle()),
  select: (index) => set({ selected: index }),

  move: (index, to) =>
    set((s) => ({ vertices: moveVertex(s.vertices, index, to), history: [...s.history, s.vertices] })),

  insert: (index, at) =>
    set((s) => ({
      vertices: insertVertex(s.vertices, index, at),
      selected: index,
      history: [...s.history, s.vertices],
    })),

  remove: (index) => {
    const { type, vertices, history } = get();
    if (!type || !canRemoveVertex(type, vertices)) return;
    set({ vertices: removeVertex(vertices, index), selected: null, history: [...history, vertices] });
  },

  undo: () =>
    set((s) => {
      const previous = s.history[s.history.length - 1];
      if (!previous) return s;
      return {
        vertices: previous,
        history: s.history.slice(0, -1),
        selected: s.selected != null && s.selected < previous.length ? s.selected : null,
      };
    }),
}));
