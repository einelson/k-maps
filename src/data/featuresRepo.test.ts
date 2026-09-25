import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_PIN_COLOR } from '../features/pinStyles';
import {
  DEFAULT_FEATURE_COLOR,
  DEFAULT_TRACK_COLOR,
  createFeatureWithTags,
  loadMapFeatures,
} from './featuresRepo';
import { POINT } from '../testing/featureFixtures';

/** Records every write and answers the handful of reads these functions make. */
class RecordingDb {
  writes: { sql: string; params: unknown[] }[] = [];
  private nextId = 100;
  tags = new Map<string, number>();
  featureRows: unknown[] = [];
  featureTagRows: { feature_id: number; tag_id: number }[] = [];
  folderRows: unknown[] = [];

  async runAsync(sql: string, ...params: unknown[]) {
    this.writes.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    const lastInsertRowId = this.nextId++;
    if (sql.startsWith('INSERT INTO tags')) this.tags.set(params[0] as string, lastInsertRowId);
    return { lastInsertRowId, changes: 1 };
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    if (sql.startsWith('SELECT * FROM tags WHERE name')) {
      const id = this.tags.get(params[0] as string);
      return id == null ? null : ({ id, name: params[0], color: null } as T);
    }
    throw new Error(`unhandled getFirstAsync: ${sql}`);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (sql.includes('FROM features f')) return this.featureRows as T[];
    if (sql.includes('FROM feature_tags')) return this.featureTagRows as T[];
    if (sql.includes('FROM folders')) return this.folderRows as T[];
    throw new Error(`unhandled getAllAsync: ${sql}`);
  }

  writesMatching(prefix: string) {
    return this.writes.filter((w) => w.sql.startsWith(prefix));
  }
}

function makeDb() {
  const db = new RecordingDb();
  return { db, sqlite: db as unknown as SQLiteDatabase };
}

describe('createFeatureWithTags', () => {
  it('saves name, description, color and pin style with the feature', async () => {
    const { db, sqlite } = makeDb();
    await createFeatureWithTags(
      sqlite,
      { geometry: POINT, name: 'Camp 1', notes: 'Flat, near water', color: '#22c55e', icon: 'camp' },
      []
    );

    const [insert] = db.writesMatching('INSERT INTO features (');
    // (folder_id, type, name, notes, color, icon, geometry, ...)
    expect(insert.params.slice(0, 6)).toEqual([null, 'point', 'Camp 1', 'Flat, near water', '#22c55e', 'camp']);
  });

  it('creates missing tags, reuses existing ones, and links each to the new feature', async () => {
    const { db, sqlite } = makeDb();
    db.tags.set('elk', 7);

    const id = await createFeatureWithTags(sqlite, { geometry: POINT }, ['elk', 'water']);

    const created = db.writesMatching('INSERT INTO tags').map((w) => w.params[0]);
    expect(created).toEqual(['water']);
    const links = db.writesMatching('INSERT OR IGNORE INTO feature_tags').map((w) => w.params);
    expect(links).toEqual([
      [id, 7],
      [id, db.tags.get('water')],
    ]);
  });

  it('writes no tag rows when there are no tags', async () => {
    const { db, sqlite } = makeDb();
    await createFeatureWithTags(sqlite, { geometry: POINT }, []);
    expect(db.writesMatching('INSERT INTO tags')).toHaveLength(0);
    expect(db.writesMatching('INSERT OR IGNORE INTO feature_tags')).toHaveLength(0);
  });
});

describe('loadMapFeatures pin look', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 1,
    folder_id: null,
    type: 'point',
    name: null,
    color: null,
    icon: null,
    source: 'manual',
    geometry: JSON.stringify(POINT),
    ...over,
  });

  async function propsOf(rows: unknown[]) {
    const { db, sqlite } = makeDb();
    db.featureRows = rows;
    return (await loadMapFeatures(sqlite)).features.map((f) => f.properties);
  }

  it('passes the saved style through and resolves unknown/absent icons to the plain pin', async () => {
    const props = await propsOf([
      row({ id: 1, icon: 'camp' }),
      row({ id: 2, icon: null }),
      row({ id: 3, icon: 'some-imported-free-text' }),
    ]);
    expect(props.map((p) => p.pinStyle)).toEqual(['camp', 'pin', 'pin']);
  });

  it('paints an uncolored pin red — never the location dot blue — and other kinds as before', async () => {
    const line = JSON.stringify({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    const props = await propsOf([
      row({ id: 1 }),
      row({ id: 2, type: 'line', geometry: line }),
      row({ id: 3, type: 'line', source: 'track', geometry: line }),
      row({ id: 4, color: '#a855f7' }),
    ]);
    expect(props.map((p) => p.displayColor)).toEqual([
      DEFAULT_PIN_COLOR,
      DEFAULT_FEATURE_COLOR,
      DEFAULT_TRACK_COLOR,
      '#a855f7',
    ]);
    // The raw color stays null so colour filters don't match uncolored features.
    expect(props[0].color).toBeNull();
  });
});

describe('loadMapFeatures folders', () => {
  const folder = (id: number, parent_id: number | null, visible = 1) => ({ id, name: `f${id}`, color: null, parent_id, visible, sort: 0 });
  const row = (id: number, folder_id: number | null) => ({
    id,
    folder_id,
    type: 'point',
    name: null,
    color: null,
    icon: null,
    source: 'manual',
    geometry: JSON.stringify(POINT),
  });

  async function load(folders: unknown[], rows: unknown[]) {
    const { db, sqlite } = makeDb();
    db.folderRows = folders;
    db.featureRows = rows;
    return (await loadMapFeatures(sqlite)).features.map((f) => f.properties);
  }

  it("stamps each feature with its folder and every folder above it (none when unfiled)", async () => {
    // 1 > 2 > 3
    const props = await load([folder(1, null), folder(2, 1), folder(3, 2)], [row(10, 3), row(11, 1), row(12, null)]);
    expect(props.map((p) => [p.featureId, p.folder_ids])).toEqual([
      [10, [1, 2, 3]],
      [11, [1]],
      [12, []],
    ]);
  });

  it('leaves out features in a hidden folder AND in every folder nested inside it', async () => {
    const folders = [folder(1, null, 0), folder(2, 1), folder(3, null)];
    const props = await load(folders, [row(10, 1), row(11, 2), row(12, 3), row(13, null)]);
    expect(props.map((p) => p.featureId)).toEqual([12, 13]);
  });

  it('a hidden subfolder does not hide its parent or siblings', async () => {
    const folders = [folder(1, null), folder(2, 1, 0), folder(3, 1)];
    const props = await load(folders, [row(10, 1), row(11, 2), row(12, 3)]);
    expect(props.map((p) => p.featureId)).toEqual([10, 12]);
  });
});
