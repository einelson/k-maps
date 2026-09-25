import JSZip from 'jszip';

import { writeHuntUnits } from '../huntUnits/storage';
import { HUNT_UNITS_ENTRY_NAME, type HuntUnitPackEntry } from '../packs/regionPacks.ts';
import { installHuntUnitPack } from './huntUnitInstaller';

const mockTempFiles = new Map<string, Uint8Array>();
let mockDownload: (url: string, dest: { uri: string }, options: any) => Promise<void>;

jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    get exists() {
      return mockTempFiles.has(this.uri);
    }
    delete() {
      mockTempFiles.delete(this.uri);
    }
    async bytes() {
      return mockTempFiles.get(this.uri)!;
    }
    static downloadFileAsync = jest.fn((url: string, dest: FakeFile, options: unknown) => mockDownload(url, dest, options));
  }
  return { File: FakeFile, Paths: { cache: { uri: 'file:///cache' } } };
});
jest.mock('../huntUnits/storage', () => ({ writeHuntUnits: jest.fn((_state: string, json: string) => json.length) }));

const MANIFEST_URL = 'https://example.test/data/manifest.json';

const feature = (set: string, unit: string) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  properties: { set, unit, title: `Unit ${unit}`, note: null, url: null, urlLabel: null, url2: null, url2Label: null },
});
const collection = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });

const pack = (over: Partial<HuntUnitPackEntry> = {}): HuntUnitPackEntry => ({
  state: 'OR',
  name: 'Oregon',
  agency: 'ODFW',
  regsUrl: 'https://example.test/regs',
  vintage: '2026',
  file: 'hunt-or.zip',
  bytes: 5000,
  version: '2026-09-25T00:00:00.000Z',
  bbox: [-124, 42, -116, 46],
  unitCount: 2,
  sets: [{ id: 'wmu', label: 'Wildlife Management Units', count: 2 }],
  ...over,
});

async function zipOf(units: string, entryName = HUNT_UNITS_ENTRY_NAME): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(entryName, units);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function serve(bytes: Uint8Array) {
  mockDownload = async (_url, dest, options) => {
    options.onProgress?.({ bytesWritten: bytes.length / 2, totalBytes: bytes.length });
    mockTempFiles.set(dest.uri, bytes);
    options.onProgress?.({ bytesWritten: bytes.length, totalBytes: bytes.length });
  };
}

const good = () => collection([feature('wmu', '1'), feature('wmu', '2')]);

beforeEach(() => {
  mockTempFiles.clear();
  jest.clearAllMocks();
});

describe('installHuntUnitPack', () => {
  it('downloads next to the manifest, stores the units, reports progress, and cleans up', async () => {
    serve(await zipOf(good()));
    const progress: number[] = [];

    const bytes = await installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL, onProgress: (f) => progress.push(f) });

    const File = jest.requireMock('expo-file-system').File;
    expect(File.downloadFileAsync.mock.calls[0][0]).toBe('https://example.test/data/hunt-or.zip');
    expect(writeHuntUnits).toHaveBeenCalledWith('OR', good());
    expect(bytes).toBe(good().length);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b)); // never goes backwards
    expect(mockTempFiles.size).toBe(0); // the temp zip is gone
  });

  it('stores nothing when the download is not a zip (e.g. an HTML error page)', async () => {
    serve(new TextEncoder().encode('<html>Not Found</html>'));
    await expect(installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL })).rejects.toThrow(/Oregon hunting units didn't download correctly/);
    expect(writeHuntUnits).not.toHaveBeenCalled();
    expect(mockTempFiles.size).toBe(0);
  });

  it('stores nothing when the zip lacks units.json', async () => {
    serve(await zipOf(good(), 'other.json'));
    await expect(installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL })).rejects.toThrow(/didn't download correctly/);
    expect(writeHuntUnits).not.toHaveBeenCalled();
  });

  it('stores nothing when units.json is not JSON, not a collection, or the wrong size', async () => {
    for (const body of [
      'not json',
      JSON.stringify({ type: 'Feature' }),
      JSON.stringify({ type: 'FeatureCollection', features: 'nope' }),
      collection([feature('wmu', '1')]), // manifest promised 2
      collection([feature('wmu', '1'), feature('wmu', '2'), feature('wmu', '3')]),
    ]) {
      serve(await zipOf(body));
      await expect(installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL })).rejects.toThrow(/didn't download correctly/);
    }
    expect(writeHuntUnits).not.toHaveBeenCalled();
  });

  it('stores nothing when a feature belongs to a set the manifest does not list', async () => {
    serve(await zipOf(collection([feature('wmu', '1'), feature('elk', '2')])));
    await expect(installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL })).rejects.toThrow(/didn't download correctly/);
    expect(writeHuntUnits).not.toHaveBeenCalled();
  });

  it('accepts several sets when the manifest lists them all', async () => {
    serve(await zipOf(collection([feature('deer', '1'), feature('elk', 'E1')])));
    const p = pack({ sets: [{ id: 'deer', label: 'Deer', count: 1 }, { id: 'elk', label: 'Elk', count: 1 }] });
    await expect(installHuntUnitPack({ pack: p, manifestUrl: MANIFEST_URL })).resolves.toBeGreaterThan(0);
  });

  it('propagates a failed download and touches nothing', async () => {
    mockDownload = async () => {
      throw new Error('Network request failed');
    };
    await expect(installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL })).rejects.toThrow('Network request failed');
    expect(writeHuntUnits).not.toHaveBeenCalled();
  });

  it('an already-aborted signal does nothing at all, and an abort during the download throws AbortError', async () => {
    const already = new AbortController();
    already.abort();
    await expect(installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL, signal: already.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const File = jest.requireMock('expo-file-system').File;
    expect(File.downloadFileAsync).not.toHaveBeenCalled();

    const during = new AbortController();
    mockDownload = async () => {
      during.abort();
      throw new Error('cancelled'); // whatever the native layer throws
    };
    await expect(installHuntUnitPack({ pack: pack(), manifestUrl: MANIFEST_URL, signal: during.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(writeHuntUnits).not.toHaveBeenCalled();
  });
});
