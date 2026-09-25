import {
  childFolders,
  expandFolderIds,
  flattenFolders,
  folderAncestryIds,
  folderAndDescendantIds,
  folderPath,
  folderPathLabel,
  wouldCreateCycle,
} from './folderTree';
import type { Folder } from './types';

const folder = (id: number, name: string, parent_id: number | null = null, sort = 0): Folder => ({
  id,
  name,
  color: null,
  parent_id,
  visible: 1,
  sort,
});

/**
 *  Hunting (1)            Fishing (4)
 *   ├ Elk (2)
 *   │  └ Camps (3)
 *   └ Deer (5)
 */
const tree = [folder(1, 'Hunting'), folder(2, 'Elk', 1), folder(3, 'Camps', 2), folder(4, 'Fishing'), folder(5, 'Deer', 1)];

describe('folderTree', () => {
  it('childFolders lists direct children by sort then name', () => {
    expect(childFolders(tree, null).map((f) => f.name)).toEqual(['Fishing', 'Hunting']);
    expect(childFolders(tree, 1).map((f) => f.name)).toEqual(['Deer', 'Elk']);
    expect(childFolders(tree, 3)).toEqual([]);
    const sorted = [folder(1, 'B', null, 0), folder(2, 'A', null, 5)];
    expect(childFolders(sorted, null).map((f) => f.name)).toEqual(['B', 'A']); // explicit sort wins over the name
  });

  it('finds a folder and all its descendants at any depth', () => {
    expect(folderAndDescendantIds(tree, 1).sort()).toEqual([1, 2, 3, 5]);
    expect(folderAndDescendantIds(tree, 2).sort()).toEqual([2, 3]);
    expect(folderAndDescendantIds(tree, 4)).toEqual([4]);
    expect(expandFolderIds(tree, [2, 4]).sort()).toEqual([2, 3, 4]);
    expect(expandFolderIds(tree, [])).toEqual([]);
  });

  it('builds paths and labels, top level first', () => {
    expect(folderPath(tree, 3).map((f) => f.id)).toEqual([1, 2, 3]);
    expect(folderPathLabel(tree, 3)).toBe('Hunting / Elk / Camps');
    expect(folderPathLabel(tree, null)).toBe('');
    expect(folderPathLabel(tree, 999)).toBe('');
    expect(folderAncestryIds(tree, 3)).toEqual([1, 2, 3]);
    expect(folderAncestryIds(tree, null)).toEqual([]);
  });

  it('detects moves that would put a folder inside itself', () => {
    expect(wouldCreateCycle(tree, 1, 3)).toBe(true); // Hunting into its own grandchild
    expect(wouldCreateCycle(tree, 1, 1)).toBe(true);
    expect(wouldCreateCycle(tree, 2, 5)).toBe(false); // Elk into its sibling
    expect(wouldCreateCycle(tree, 3, null)).toBe(false); // to the top level is always fine
    expect(wouldCreateCycle(tree, 3, 4)).toBe(false);
  });

  it('flattens depth-first with full-path labels', () => {
    expect(flattenFolders(tree).map((r) => `${'-'.repeat(r.depth)}${r.label}`)).toEqual([
      'Fishing',
      'Hunting',
      '-Hunting / Deer',
      '-Hunting / Elk',
      '--Hunting / Elk / Camps',
    ]);
  });

  it('flattening can leave out a folder and everything under it (a move target list)', () => {
    expect(flattenFolders(tree, [2]).map((r) => r.folder.id)).toEqual([4, 1, 5]);
  });

  it('survives a corrupted cyclic parent chain instead of looping', () => {
    const cyclic = [folder(1, 'A', 2), folder(2, 'B', 1)];
    expect(folderPath(cyclic, 1).length).toBeLessThanOrEqual(2);
    expect(folderAndDescendantIds(cyclic, 1).sort()).toEqual([1, 2]);
    expect(flattenFolders(cyclic)).toEqual([]); // nothing reachable from the top level, but no hang
  });
});
