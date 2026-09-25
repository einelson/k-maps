import type { SQLiteDatabase } from 'expo-sqlite';

import { createFeature, listFeatures } from './featuresRepo';
import {
  addTagToFeature,
  createTag,
  deleteTag,
  getOrCreateTag,
  listTags,
  listTagsForFeature,
  listTagsWithCounts,
  renameTag,
} from './tagsRepo';
import { POINT } from '../testing/featureFixtures';
import { createTestDb } from '../testing/sqliteTestDb';

let db: SQLiteDatabase;
beforeEach(() => {
  db = createTestDb();
});

const tagNames = async () => (await listTags(db)).map((t) => t.name);

describe('tagsRepo (real SQLite)', () => {
  it('creates a tag with no items, trimming the name', async () => {
    const id = await createTag(db, '  elk  ');
    expect(await tagNames()).toEqual(['elk']);
    expect((await listTagsWithCounts(db)).find((t) => t.id === id)?.count).toBe(0);
  });

  it('refuses an empty name and a duplicate (case-insensitive)', async () => {
    await createTag(db, 'Elk');
    await expect(createTag(db, '   ')).rejects.toThrow('Enter a tag name');
    await expect(createTag(db, 'elk')).rejects.toThrow('A tag named "elk" already exists');
    expect(await tagNames()).toEqual(['Elk']);
  });

  it('renames a tag and every item keeps it', async () => {
    const tag = await createTag(db, 'elk');
    const a = await createFeature(db, { geometry: POINT });
    const b = await createFeature(db, { geometry: POINT });
    await addTagToFeature(db, a, tag);
    await addTagToFeature(db, b, tag);

    await renameTag(db, tag, ' Elk hunting ');

    expect(await tagNames()).toEqual(['Elk hunting']);
    expect((await listTagsForFeature(db, a)).map((t) => t.name)).toEqual(['Elk hunting']);
    expect((await listTagsForFeature(db, b)).map((t) => t.name)).toEqual(['Elk hunting']);
  });

  it('renaming to another tag\'s name is refused, but changing only the case of its own name is fine', async () => {
    const elk = await createTag(db, 'elk');
    await createTag(db, 'deer');
    await expect(renameTag(db, elk, 'DEER')).rejects.toThrow('A tag named "DEER" already exists');
    await expect(renameTag(db, elk, '  ')).rejects.toThrow('Enter a tag name');
    await renameTag(db, elk, 'Elk');
    expect(await tagNames()).toEqual(['deer', 'Elk']);
  });

  it('deleting a tag removes it from every item, keeps the items, and reports how many had it', async () => {
    const elk = await createTag(db, 'elk');
    const water = await createTag(db, 'water');
    const a = await createFeature(db, { geometry: POINT });
    const b = await createFeature(db, { geometry: POINT });
    const c = await createFeature(db, { geometry: POINT });
    await addTagToFeature(db, a, elk);
    await addTagToFeature(db, b, elk);
    await addTagToFeature(db, b, water);

    expect(await deleteTag(db, elk)).toBe(2);

    expect(await tagNames()).toEqual(['water']);
    expect((await listTagsForFeature(db, a)).length).toBe(0);
    expect((await listTagsForFeature(db, b)).map((t) => t.name)).toEqual(['water']); // other tags untouched
    expect((await listFeatures(db)).map((f) => f.id).sort()).toEqual([a, b, c].sort()); // no item deleted
    expect(await db.getFirstAsync('SELECT * FROM feature_tags WHERE tag_id = ?', elk)).toBeNull(); // no orphan links
  });

  it('deleting an unused or missing tag reports 0', async () => {
    const id = await createTag(db, 'unused');
    expect(await deleteTag(db, id)).toBe(0);
    expect(await deleteTag(db, 999)).toBe(0);
  });

  it('lists tags with item counts, alphabetical, including unused ones', async () => {
    const elk = await getOrCreateTag(db, 'elk');
    await getOrCreateTag(db, 'camp');
    const a = await createFeature(db, { geometry: POINT });
    const b = await createFeature(db, { geometry: POINT });
    await addTagToFeature(db, a, elk);
    await addTagToFeature(db, b, elk);
    expect((await listTagsWithCounts(db)).map((t) => [t.name, t.count])).toEqual([
      ['camp', 0],
      ['elk', 2],
    ]);
  });
});
