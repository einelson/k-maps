import type { FeatureType } from '../data/types';

/** §7.2 filter state shape, shared between the map filter expression and SQL list/search queries. */
export interface Filters {
  folderIds: number[] | null; // null = all
  types: FeatureType[] | null;
  colors: string[] | null;
  tagIds: number[] | null;
  tagMode: 'any' | 'all';
  text?: string;
}

export const EMPTY_FILTERS: Filters = {
  folderIds: null,
  types: null,
  colors: null,
  tagIds: null,
  tagMode: 'any',
};

export type DrawTool = 'none' | 'point' | 'line' | 'polygon' | 'measure';
