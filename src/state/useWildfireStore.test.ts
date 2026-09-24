import type { PackFeatureCollection } from '../packs/types';
import { fetchWildfirePerimeters } from '../packs/wildfire';
import { readWildfireSnapshot, writeWildfireSnapshot } from '../packs/wildfireCache';
import { resetWildfireCacheFlag, useWildfireStore } from './useWildfireStore';

jest.mock('../packs/wildfire', () => ({
  ...jest.requireActual('../packs/wildfire'),
  fetchWildfirePerimeters: jest.fn(),
}));
jest.mock('../packs/wildfireCache', () => ({
  readWildfireSnapshot: jest.fn(),
  writeWildfireSnapshot: jest.fn(),
}));

const store = useWildfireStore;
const fetchMock = fetchWildfirePerimeters as jest.Mock;
const readMock = readWildfireSnapshot as jest.Mock;
const writeMock = writeWildfireSnapshot as jest.Mock;

const fc = (name: string): PackFeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
});

const T0 = 1_800_000_000_000;
const MIN = 60_000;
let now = T0;

beforeEach(() => {
  // mockReset (not clearAllMocks): a throwing/rejecting implementation set by one test must not leak into the next.
  fetchMock.mockReset();
  readMock.mockReset();
  writeMock.mockReset();
  store.setState({ collection: null, fetchedAt: null, status: 'idle', error: null });
  resetWildfireCacheFlag();
  now = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  readMock.mockResolvedValue(null);
});

afterEach(() => jest.restoreAllMocks());

describe('refresh', () => {
  it('fetches, stores the collection with its fetch time, and saves it for offline', async () => {
    fetchMock.mockResolvedValue(fc('Cascade'));
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ collection: fc('Cascade'), fetchedAt: T0, status: 'idle', error: null });
    expect(writeMock).toHaveBeenCalledWith({ fetchedAt: T0, collection: fc('Cascade') });
  });

  it('skips the network while the data is under 5 minutes old, refetches after', async () => {
    fetchMock.mockResolvedValue(fc('A'));
    await store.getState().refresh();
    now = T0 + 2 * MIN;
    await store.getState().refresh();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now = T0 + 5 * MIN;
    fetchMock.mockResolvedValue(fc('B'));
    await store.getState().refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getState().collection).toEqual(fc('B'));
    expect(store.getState().fetchedAt).toBe(T0 + 5 * MIN);
  });

  it('a timer tick a hair early still counts as due (timers drift)', async () => {
    fetchMock.mockResolvedValue(fc('A'));
    await store.getState().refresh();
    now = T0 + 5 * MIN - 3_000;
    await store.getState().refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('force refetches even when fresh', async () => {
    fetchMock.mockResolvedValue(fc('A'));
    await store.getState().refresh();
    await store.getState().refresh({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping refreshes into one request', async () => {
    let release!: (v: PackFeatureCollection) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const first = store.getState().refresh();
    expect(store.getState().status).toBe('loading');
    await store.getState().refresh({ force: true }); // returns immediately: one is already running
    release(fc('A'));
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('idle');
  });

  it('keeps the last known perimeters on screen when a refresh fails, and says why', async () => {
    fetchMock.mockResolvedValueOnce(fc('Cascade'));
    await store.getState().refresh();
    now = T0 + 10 * MIN;
    fetchMock.mockRejectedValueOnce(new Error('Network request failed'));
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({
      collection: fc('Cascade'),
      fetchedAt: T0, // still the old fetch time: the card shows how stale it is
      status: 'error',
      error: 'Network request failed',
    });
    // ...and a later success clears the error.
    now = T0 + 20 * MIN;
    fetchMock.mockResolvedValueOnce(fc('Fresh'));
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ collection: fc('Fresh'), status: 'idle', error: null });
  });

  it('a failed first fetch leaves no data but is not fatal', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ collection: null, fetchedAt: null, status: 'error', error: 'offline' });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('an abort is not an error', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('still shows the fresh data if saving it for offline fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(fc('A'));
    writeMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ collection: fc('A'), status: 'idle' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('loadCached', () => {
  it('puts the saved copy (and its age) on screen so there is something to show offline', async () => {
    readMock.mockResolvedValue({ fetchedAt: T0 - 3 * 60 * MIN, collection: fc('Old') });
    await store.getState().loadCached();
    expect(store.getState()).toMatchObject({ collection: fc('Old'), fetchedAt: T0 - 3 * 60 * MIN });
  });

  it('reads the file only once', async () => {
    await store.getState().loadCached();
    await store.getState().loadCached();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('never overwrites data that arrived from the network while the file was being read', async () => {
    let finishRead!: (v: unknown) => void;
    readMock.mockReturnValue(new Promise((resolve) => (finishRead = resolve)));
    const loading = store.getState().loadCached();
    fetchMock.mockResolvedValue(fc('Live'));
    await store.getState().refresh();
    finishRead({ fetchedAt: T0 - 1_000_000, collection: fc('Stale') });
    await loading;
    expect(store.getState().collection).toEqual(fc('Live'));
  });

  it('a first launch with nothing saved stays empty', async () => {
    await store.getState().loadCached();
    expect(store.getState()).toMatchObject({ collection: null, fetchedAt: null });
  });

  it('after loading the saved copy a refresh is skipped only if that copy is itself fresh', async () => {
    readMock.mockResolvedValue({ fetchedAt: T0 - 2 * MIN, collection: fc('Recent') });
    await store.getState().loadCached();
    await store.getState().refresh();
    expect(fetchMock).not.toHaveBeenCalled();

    resetWildfireCacheFlag();
    store.setState({ collection: null, fetchedAt: null });
    readMock.mockResolvedValue({ fetchedAt: T0 - 60 * MIN, collection: fc('Old') });
    fetchMock.mockResolvedValue(fc('New'));
    await store.getState().loadCached();
    await store.getState().refresh();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.getState().collection).toEqual(fc('New'));
  });
});
