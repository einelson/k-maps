import type { SQLiteDatabase } from 'expo-sqlite';

import { createFeature, listFeatures } from './featuresRepo';
import { createFolder, deleteFolder, folderItemCounts, listFolders, moveFolder, renameFolder } from './foldersRepo';
import { POINT } from '../testing/featureFixtures';
import { createTestDb } from '../testing/sqliteTestDb';

let db: SQLiteDatabase;
beforeEach(() => {
  db = createTestDb();
});

const names = async () => (await listFolders(db)).map((f) => f.name);
const parentOf = async (id: number) => (await listFolders(db)).find((f) => f.id === id)?.parent_id;
const folderOf = async (featureId: number) =>
  (await listFeatures(db)).find((f) => f.id === featureId)?.folder_id;

describe('foldersRepo (real SQLite)', () => {
  it('creates nested folders and trims names', async () => {
    const hunting = await createFolder(db, { name: '  Hunting ' });
    const elk = await createFolder(db, { name: 'Elk', parentId: hunting });
    expect(await names()).toEqual(['Elk', 'Hunting']);
    expect(await parentOf(elk)).toBe(hunting);
    expect(await parentOf(hunting)).toBeNull();
  });

  it('refuses an empty folder name', async () => {
    await expect(createFolder(db, { name: '   ' })).rejects.toThrow('Enter a folder name');
    const id = await createFolder(db, { name: 'A' });
    await expect(renameFolder(db, id, '')).rejects.toThrow('Enter a folder name');
    expect(await names()).toEqual(['A']);
  });

  it('renames a folder without touching what is in it', async () => {
    const id = await createFolder(db, { name: 'Old' });
    const pin = await createFeature(db, { geometry: POINT, folderId: id });
    await renameFolder(db, id, ' New ');
    expect(await names()).toEqual(['New']);
    expect(await folderOf(pin)).toBe(id);
  });

  it('moves a folder (with its contents) under another, or back to the top level', async () => {
    const a = await createFolder(db, { name: 'A' });
    const b = await createFolder(db, { name: 'B' });
    const inB = await createFolder(db, { name: 'InB', parentId: b });
    await moveFolder(db, b, a);
    expect(await parentOf(b)).toBe(a);
    expect(await parentOf(inB)).toBe(b); // its own subfolders come along
    await moveFolder(db, b, null);
    expect(await parentOf(b)).toBeNull();
  });

  it("won't move a folder into itself or into one of its own subfolders", async () => {
    const a = await createFolder(db, { name: 'A' });
    const b = await createFolder(db, { name: 'B', parentId: a });
    const c = await createFolder(db, { name: 'C', parentId: b });
    await expect(moveFolder(db, a, a)).rejects.toThrow(/into itself/);
    await expect(moveFolder(db, a, c)).rejects.toThrow(/into itself/);
    expect(await parentOf(a)).toBeNull(); // unchanged
  });

  it('deleting a folder keeps its pins and subfolders, moving them up a level', async () => {
    const hunting = await createFolder(db, { name: 'Hunting' });
    const elk = await createFolder(db, { name: 'Elk', parentId: hunting });
    const camps = await createFolder(db, { name: 'Camps', parentId: elk });
    const inElk = await createFeature(db, { geometry: POINT, folderId: elk });
    const inHunting = await createFeature(db, { geometry: POINT, folderId: hunting });

    await deleteFolder(db, elk);

    expect(await names()).toEqual(['Camps', 'Hunting']);
    expect(await parentOf(camps)).toBe(hunting); // subfolder promoted
    expect(await folderOf(inElk)).toBe(hunting); // pin promoted
    expect(await folderOf(inHunting)).toBe(hunting); // unaffected
  });

  it('deleting a top-level folder sends its pins to "no folder", not to a dangling id', async () => {
    const top = await createFolder(db, { name: 'Top' });
    const sub = await createFolder(db, { name: 'Sub', parentId: top });
    const pin = await createFeature(db, { geometry: POINT, folderId: top });
    await deleteFolder(db, top);
    expect(await folderOf(pin)).toBeNull();
    expect(await parentOf(sub)).toBeNull();
    expect((await listFeatures(db)).length).toBe(1); // nothing deleted
  });

  it('deleting a folder that does not exist is a no-op', async () => {
    await expect(deleteFolder(db, 999)).resolves.toBeUndefined();
  });

  it('counts the items sitting directly in each folder (subfolders excluded)', async () => {
    const a = await createFolder(db, { name: 'A' });
    const b = await createFolder(db, { name: 'B', parentId: a });
    await createFeature(db, { geometry: POINT, folderId: a });
    await createFeature(db, { geometry: POINT, folderId: b });
    await createFeature(db, { geometry: POINT, folderId: b });
    await createFeature(db, { geometry: POINT });
    const counts = await folderItemCounts(db);
    expect(counts.get(a)).toBe(1);
    expect(counts.get(b)).toBe(2);
    expect(counts.size).toBe(2); // unfiled items aren't in any folder
  });
});

describe('listFeatures with nested folders (real SQLite)', () => {
  async function setup() {
    const hunting = await createFolder(db, { name: 'Hunting' });
    const elk = await createFolder(db, { name: 'Elk', parentId: hunting });
    const fishing = await createFolder(db, { name: 'Fishing' });
    const ids = {
      hunting: await createFeature(db, { geometry: POINT, folderId: hunting, name: 'blind' }),
      elk: await createFeature(db, { geometry: POINT, folderId: elk, name: 'elk camp' }),
      fishing: await createFeature(db, { geometry: POINT, folderId: fishing, name: 'dock' }),
      loose: await createFeature(db, { geometry: POINT, name: 'loose pin' }),
    };
    return { hunting, elk, fishing, ids };
  }
  const idsOf = async (filters: Parameters<typeof listFeatures>[1]) =>
    (await listFeatures(db, filters)).map((f) => f.id).sort((a, b) => a - b);

  it('a folder filter includes everything nested inside it', async () => {
    const { hunting, elk, fishing, ids } = await setup();
    expect(await idsOf({ folderIds: [hunting] })).toEqual([ids.hunting, ids.elk]);
    expect(await idsOf({ folderIds: [elk] })).toEqual([ids.elk]);
    expect(await idsOf({ folderIds: [hunting, fishing] })).toEqual([ids.hunting, ids.elk, ids.fishing]);
  });

  it('inFolder returns only what sits directly in that folder; null means unfiled', async () => {
    const { hunting, ids } = await setup();
    expect(await idsOf({ inFolder: hunting })).toEqual([ids.hunting]);
    expect(await idsOf({ inFolder: null })).toEqual([ids.loose]);
    expect(await idsOf({})).toHaveLength(4); // no folder filter = everything
  });

  it('combines with search text', async () => {
    const { hunting, ids } = await setup();
    expect(await idsOf({ folderIds: [hunting], text: 'camp' })).toEqual([ids.elk]);
    expect(await idsOf({ inFolder: hunting, text: 'camp' })).toEqual([]);
  });
});
