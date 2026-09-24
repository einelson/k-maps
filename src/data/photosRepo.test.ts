import type { SQLiteDatabase } from 'expo-sqlite';

import { bulkDelete, deleteFeature, updateFeatureGeometry } from './featuresRepo';
import {
  addPhoto,
  countPhotosByFeature,
  deletePhoto,
  deletePhotosForFeatures,
  listPhotos,
  makePhotoFileName,
  photoExtension,
} from './photosRepo';
import type { Photo } from './types';

/**
 * In-memory stand-in for the parts of the new expo-file-system class API that
 * photosRepo uses: a set of "existing" file URIs and a set of directories.
 */
jest.mock('expo-file-system', () => {
  const state = {
    files: new Set<string>(),
    dirs: new Set<string>(),
    deleteFails: new Set<string>(),
  };

  function join(parts: unknown[]): string {
    const strings = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri));
    const joined = strings.join('/');
    // Keep the `file:///` scheme prefix intact; collapse repeated slashes and drop a trailing one after it.
    const match = /^([a-z]+:\/\/\/)(.*)$/.exec(joined);
    if (!match) return joined;
    return match[1] + match[2].replace(/\/{2,}/g, '/').replace(/\/$/, '');
  }

  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return state.dirs.has(this.uri);
    }
    create() {
      state.dirs.add(this.uri);
    }
  }

  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return state.files.has(this.uri);
    }
    async copy(destination: { uri: string }) {
      if (!state.files.has(this.uri)) throw new Error(`source missing: ${this.uri}`);
      state.files.add(destination.uri);
    }
    delete() {
      if (state.deleteFails.has(this.uri)) throw new Error('cannot delete');
      if (!state.files.has(this.uri)) throw new Error('not found');
      state.files.delete(this.uri);
    }
  }

  return {
    __state: state,
    Directory,
    File,
    Paths: { document: new Directory('file:///data/document/') },
  };
});

const fs = (jest.requireMock('expo-file-system') as {
  __state: { files: Set<string>; dirs: Set<string>; deleteFails: Set<string> };
}).__state;

/**
 * Tiny fake of the SQLiteDatabase subset used by photosRepo/featuresRepo. It
 * understands the photos statements exactly and just logs everything else
 * (features/feature_tags/features_fts deletes) so ordering can be asserted.
 */
class FakeDb {
  photos: Photo[] = [];
  nextId = 1;
  log: string[] = [];
  calls: { sql: string; params: unknown[] }[] = [];
  failPhotoInsert = false;

  async runAsync(sql: string, ...params: unknown[]) {
    const s = sql.replace(/\s+/g, ' ').trim();
    this.log.push(s);
    this.calls.push({ sql: s, params });
    if (s.startsWith('INSERT INTO photos')) {
      if (this.failPhotoInsert) throw new Error('insert failed');
      const [feature_id, path] = params as [number, string];
      const id = this.nextId++;
      this.photos.push({ id, feature_id, path });
      return { lastInsertRowId: id, changes: 1 };
    }
    if (s.startsWith('DELETE FROM photos WHERE id = ?')) {
      this.photos = this.photos.filter((p) => p.id !== params[0]);
    } else if (s.startsWith('DELETE FROM photos WHERE feature_id IN')) {
      this.photos = this.photos.filter((p) => !params.includes(p.feature_id));
    }
    return { lastInsertRowId: 0, changes: 0 };
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM photos WHERE feature_id = ?')) {
      return this.photos
        .filter((p) => p.feature_id === params[0])
        .sort((a, b) => a.id - b.id) as T[];
    }
    if (s.startsWith('SELECT * FROM photos WHERE feature_id IN')) {
      return this.photos.filter((p) => params.includes(p.feature_id)) as T[];
    }
    if (s.startsWith('SELECT feature_id, COUNT(*)')) {
      const counts = new Map<number, number>();
      for (const p of this.photos) counts.set(p.feature_id, (counts.get(p.feature_id) ?? 0) + 1);
      return [...counts].map(([feature_id, count]) => ({ feature_id, count })) as T[];
    }
    throw new Error(`FakeDb.getAllAsync: unhandled SQL: ${s}`);
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (await this.getAllAsync<T>(sql, ...params))[0] ?? null;
  }
}

function makeDb() {
  const db = new FakeDb();
  return { db, sqlite: db as unknown as SQLiteDatabase };
}

function pickFile(uri: string) {
  fs.files.add(uri);
  return uri;
}

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.deleteFails.clear();
});

describe('photoExtension / makePhotoFileName', () => {
  it('keeps the source extension, lowercased, ignoring query strings', () => {
    expect(photoExtension('file:///cache/ImagePicker/abc.JPG')).toBe('jpg');
    expect(photoExtension('file:///cache/x.heic?token=1.png')).toBe('heic');
    expect(photoExtension('file:///cache/photo.png#frag')).toBe('png');
  });

  it('falls back to jpg when there is no usable extension', () => {
    expect(photoExtension('content://media/picker/0/1234')).toBe('jpg');
    expect(photoExtension('file:///cache.dir/noext')).toBe('jpg');
    expect(photoExtension('file:///cache/weird.extensionthatistoolong')).toBe('jpg');
  });

  it('builds <featureId>-<timestamp>-<rand>.<ext> and differs between calls', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const a = makePhotoFileName(7, 'file:///c/a.png');
    const b = makePhotoFileName(7, 'file:///c/a.png');
    now.mockRestore();
    expect(a).toMatch(/^7-1700000000000-[a-z0-9]{6}\.png$/);
    expect(b).toMatch(/^7-1700000000000-[a-z0-9]{6}\.png$/);
    expect(a).not.toBe(b);
  });
});

describe('addPhoto', () => {
  it('copies into <document>/photos/ and stores the new file URI', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/ImagePicker/shot.jpeg');

    const photo = await addPhoto(sqlite, 42, source);

    expect(photo.feature_id).toBe(42);
    expect(photo.path).toMatch(/^file:\/\/\/data\/document\/photos\/42-\d+-[a-z0-9]{6}\.jpeg$/);
    expect(photo.path).not.toBe(source);
    expect(fs.dirs.has('file:///data/document/photos')).toBe(true);
    expect(fs.files.has(photo.path)).toBe(true);
    expect(fs.files.has(source)).toBe(true);
    expect(db.photos).toEqual([photo]);
  });

  it('gives several photos added back-to-back distinct files and rows', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const a = await addPhoto(sqlite, 1, source);
    const b = await addPhoto(sqlite, 1, source);
    expect(a.path).not.toBe(b.path);
    expect(a.id).not.toBe(b.id);
    expect(db.photos).toHaveLength(2);
  });

  it('inserts nothing when the copy fails', async () => {
    const { db, sqlite } = makeDb();
    await expect(addPhoto(sqlite, 1, 'file:///cache/missing.jpg')).rejects.toThrow('source missing');
    expect(db.photos).toHaveLength(0);
  });

  it('removes the copied file when the insert fails', async () => {
    const { db, sqlite } = makeDb();
    db.failPhotoInsert = true;
    const source = pickFile('file:///cache/a.jpg');
    await expect(addPhoto(sqlite, 1, source)).rejects.toThrow('insert failed');
    expect([...fs.files]).toEqual([source]);
  });
});

describe('listPhotos / countPhotosByFeature', () => {
  it('lists only the feature’s photos in insertion order and counts per feature', async () => {
    const { sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const a1 = await addPhoto(sqlite, 1, source);
    await addPhoto(sqlite, 2, source);
    const a2 = await addPhoto(sqlite, 1, source);

    expect((await listPhotos(sqlite, 1)).map((p) => p.id)).toEqual([a1.id, a2.id]);
    expect(await listPhotos(sqlite, 99)).toEqual([]);
    expect(await countPhotosByFeature(sqlite)).toEqual(
      new Map([
        [1, 2],
        [2, 1],
      ])
    );
  });
});

describe('deletePhoto', () => {
  it('removes the row and the file, leaving other photos alone', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const keep = await addPhoto(sqlite, 1, source);
    const drop = await addPhoto(sqlite, 1, source);

    await deletePhoto(sqlite, drop);

    expect(db.photos).toEqual([keep]);
    expect(fs.files.has(drop.path)).toBe(false);
    expect(fs.files.has(keep.path)).toBe(true);
  });

  it('tolerates a file that is already gone or cannot be deleted', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const gone = await addPhoto(sqlite, 1, source);
    const stuck = await addPhoto(sqlite, 1, source);
    fs.files.delete(gone.path);
    fs.deleteFails.add(stuck.path);

    await expect(deletePhoto(sqlite, gone)).resolves.toBeUndefined();
    await expect(deletePhoto(sqlite, stuck)).resolves.toBeUndefined();
    expect(db.photos).toEqual([]);
  });
});

describe('deletePhotosForFeatures', () => {
  it('removes rows and files for just the given features', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const f1 = await addPhoto(sqlite, 1, source);
    const f2 = await addPhoto(sqlite, 2, source);
    const f3 = await addPhoto(sqlite, 3, source);

    await deletePhotosForFeatures(sqlite, [1, 3]);

    expect(db.photos).toEqual([f2]);
    expect(fs.files.has(f1.path)).toBe(false);
    expect(fs.files.has(f3.path)).toBe(false);
    expect(fs.files.has(f2.path)).toBe(true);
  });

  it('is a no-op for an empty list or features without photos', async () => {
    const { db, sqlite } = makeDb();
    await deletePhotosForFeatures(sqlite, []);
    await deletePhotosForFeatures(sqlite, [5]);
    expect(db.log).toEqual([]);
  });

  it('handles more ids than fit in one statement', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const far = await addPhoto(sqlite, 1200, source);
    await deletePhotosForFeatures(
      sqlite,
      Array.from({ length: 1300 }, (_, i) => i + 1)
    );
    expect(db.photos).toEqual([]);
    expect(fs.files.has(far.path)).toBe(false);
  });
});

describe('feature deletion cascades to photos and tags', () => {
  it('deleteFeature removes photos and tag links before the feature row', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const mine = await addPhoto(sqlite, 1, source);
    const other = await addPhoto(sqlite, 2, source);
    db.log.length = 0;

    await deleteFeature(sqlite, 1);

    expect(db.photos).toEqual([other]);
    expect(fs.files.has(mine.path)).toBe(false);
    expect(fs.files.has(other.path)).toBe(true);

    const idx = (prefix: string) => db.log.findIndex((s) => s.startsWith(prefix));
    expect(idx('DELETE FROM photos')).toBeGreaterThanOrEqual(0);
    expect(idx('DELETE FROM feature_tags WHERE feature_id = ?')).toBeGreaterThanOrEqual(0);
    expect(idx('DELETE FROM photos')).toBeLessThan(idx('DELETE FROM features WHERE id = ?'));
    expect(idx('DELETE FROM feature_tags')).toBeLessThan(idx('DELETE FROM features WHERE id = ?'));
  });

  it('bulkDelete removes photos and tag links for every id before the feature rows', async () => {
    const { db, sqlite } = makeDb();
    const source = pickFile('file:///cache/a.jpg');
    const p1 = await addPhoto(sqlite, 1, source);
    const p2 = await addPhoto(sqlite, 2, source);
    const p3 = await addPhoto(sqlite, 3, source);
    db.log.length = 0;

    await bulkDelete(sqlite, [1, 2]);

    expect(db.photos).toEqual([p3]);
    expect(fs.files.has(p1.path)).toBe(false);
    expect(fs.files.has(p2.path)).toBe(false);
    expect(fs.files.has(p3.path)).toBe(true);

    const idx = (prefix: string) => db.log.findIndex((s) => s.startsWith(prefix));
    expect(idx('DELETE FROM photos')).toBeLessThan(idx('DELETE FROM features WHERE id IN'));
    expect(idx('DELETE FROM feature_tags WHERE feature_id IN')).toBeLessThan(
      idx('DELETE FROM features WHERE id IN')
    );
  });

  it('bulkDelete with no ids touches nothing', async () => {
    const { db, sqlite } = makeDb();
    await bulkDelete(sqlite, []);
    expect(db.log).toEqual([]);
  });
});

describe('updateFeatureGeometry', () => {
  it('stores the geometry with recomputed bbox/metrics, leaves type alone and bumps updated_at', async () => {
    const { db, sqlite } = makeDb();
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const line = {
      type: 'LineString' as const,
      coordinates: [
        [-105, 40],
        [-104.9, 40.1],
      ],
    };

    await updateFeatureGeometry(sqlite, 9, line);
    now.mockRestore();

    expect(db.calls).toHaveLength(1);
    const { sql, params } = db.calls[0];
    expect(sql).toMatch(/^UPDATE features SET geometry = \?/);
    expect(sql).not.toMatch(/type\s*=/);
    const [geometry, minLon, minLat, maxLon, maxLat, lengthM, areaM2, updatedAt, id] = params;
    expect(JSON.parse(geometry as string)).toEqual(line);
    expect([minLon, minLat, maxLon, maxLat]).toEqual([-105, 40, -104.9, 40.1]);
    expect(lengthM).toBeGreaterThan(10_000);
    expect(areaM2).toBeNull();
    expect(updatedAt).toBe(1_800_000_000_000);
    expect(id).toBe(9);
  });
});
