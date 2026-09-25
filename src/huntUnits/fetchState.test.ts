import { jsonResponse, mockFetch } from '../packs/testUtils.ts';
import { fetchState, layerLastEdited } from './fetchState.ts';
import type { HuntStateConfig } from './types.ts';

const square = (x: number) => ({ type: 'Polygon', coordinates: [[[x, 40], [x + 1, 40], [x + 1, 41], [x, 41], [x, 40]]] });
const layer = (name: string) => `https://example.test/rest/services/${name}/FeatureServer/0`;

const state = (over: Partial<HuntStateConfig> = {}): HuntStateConfig => ({
  code: 'XX',
  name: 'Testland',
  agency: 'Testland DNR',
  regsUrl: 'https://example.test/regs',
  vintage: '2026',
  sets: [
    {
      id: 'deer',
      label: 'Deer Units',
      noun: 'Deer Unit',
      layer: layer('deer'),
      map: (a) => (a.U ? { unit: String(a.U) } : null),
      example: { attributes: { U: 1 }, unit: '1', title: 'Deer Unit 1' },
    },
    {
      id: 'elk',
      label: 'Elk Units',
      noun: 'Elk Unit',
      layer: layer('elk'),
      map: (a) => (a.E ? { unit: String(a.E) } : null),
      example: { attributes: { E: 'E1' }, unit: 'E1', title: 'Elk Unit E1' },
    },
  ],
  ...over,
});

const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features });

describe('fetchState', () => {
  it('queries each set, normalizes, and reports counts and the state bbox', async () => {
    const { calls } = mockFetch((call) =>
      jsonResponse(
        call.url.includes('/deer/')
          ? collection([
              { type: 'Feature', geometry: square(-116), properties: { U: 1 } },
              { type: 'Feature', geometry: square(-115), properties: { U: 2 } },
              { type: 'Feature', geometry: square(-114), properties: {} }, // rejected by the mapping
            ])
          : collection([{ type: 'Feature', geometry: square(-110), properties: { E: 'E1' } }])
      )
    );
    const result = await fetchState(state(), { retries: 0 });

    expect(result.sets).toEqual([
      { id: 'deer', label: 'Deer Units', fetched: 3, kept: 2, updated: null },
      { id: 'elk', label: 'Elk Units', fetched: 1, kept: 1, updated: null },
    ]);
    expect(new Date(result.fetchedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(result.features.map((f) => `${f.properties.set}:${f.properties.unit}`)).toEqual(['deer:1', 'deer:2', 'elk:E1']);
    expect(result.bbox[0]).toBeLessThanOrEqual(-116);
    expect(result.bbox[2]).toBeGreaterThanOrEqual(-109);

    // Asks for WGS84 GeoJSON with light simplification, all attributes.
    const first = calls[0];
    expect(first.url).toBe(`${layer('deer')}/query`);
    expect(first.params.get('f')).toBe('geojson');
    expect(first.params.get('outSR')).toBe('4326');
    expect(first.params.get('maxAllowableOffset')).toBe('0.0003');
    expect(first.params.get('where')).toBe('1=1');
  });

  it('simplifies by default, but not for a state whose terms forbid altering its boundaries', async () => {
    const one = collection([{ type: 'Feature', geometry: square(-116), properties: { U: 1 } }]);
    let { calls } = mockFetch(() => jsonResponse(one));
    const s = state();
    s.sets = [s.sets[0]];
    await fetchState(s, { retries: 0 });
    expect(calls[0].params.get('maxAllowableOffset')).toBe('0.0003');

    ({ calls } = mockFetch(() => jsonResponse(one)));
    await fetchState({ ...s, fullResolution: true }, { retries: 0 });
    expect(calls[0].params.has('maxAllowableOffset')).toBe(false);
    expect(calls[0].params.get('geometryPrecision')).toBe('5'); // ~1 m coordinates, not generalization
  });

  it('uses a set\'s own where clause', async () => {
    const { calls } = mockFetch(() => jsonResponse(collection([{ type: 'Feature', geometry: square(-116), properties: { U: 1 } }])));
    const s = state();
    s.sets = [{ ...s.sets[0], where: "status='Active'" }];
    await fetchState(s, { retries: 0 });
    expect(calls[0].params.get('where')).toBe("status='Active'");
  });

  it('fails the build when a set comes back with nothing usable, rather than publishing an empty state', async () => {
    mockFetch(() => jsonResponse(collection([{ type: 'Feature', geometry: square(-116), properties: {} }])));
    await expect(fetchState(state(), { retries: 0 })).rejects.toThrow(/deer: 1 features fetched but none usable/);
  });

  it('surfaces a service error instead of returning partial data', async () => {
    mockFetch(() => jsonResponse({ error: { code: 400, message: 'Invalid query' } }));
    await expect(fetchState(state(), { retries: 0 })).rejects.toThrow(/Invalid query/);
  });
});

describe('layerLastEdited', () => {
  const layer = 'https://example.test/rest/services/x/FeatureServer/0';
  const ms = Date.UTC(2026, 7, 27, 15, 0, 0); // Aug 27 2026

  it('reads the layer\'s last-edit date from its service metadata', async () => {
    const { calls } = mockFetch(() => jsonResponse({ editingInfo: { lastEditDate: ms } }));
    await expect(layerLastEdited(layer, { retries: 0 })).resolves.toBe('2026-08-27');
    expect(calls[0].url).toBe(`${layer}?f=json`);
  });

  it('falls back to dataLastEditDate', async () => {
    mockFetch(() => jsonResponse({ editingInfo: { dataLastEditDate: ms } }));
    await expect(layerLastEdited(layer, { retries: 0 })).resolves.toBe('2026-08-27');
  });

  it('is null when the service publishes no date (older map servers), or the value is not a date', async () => {
    mockFetch(() => jsonResponse({ name: 'x' }));
    await expect(layerLastEdited(layer, { retries: 0 })).resolves.toBeNull();
    mockFetch(() => jsonResponse({ editingInfo: { lastEditDate: 'yesterday' } }));
    await expect(layerLastEdited(layer, { retries: 0 })).resolves.toBeNull();
    mockFetch(() => jsonResponse({ editingInfo: { lastEditDate: 0 } }));
    await expect(layerLastEdited(layer, { retries: 0 })).resolves.toBeNull();
  });

  it('never fails the build: a broken metadata request just means no date', async () => {
    mockFetch(() => jsonResponse({}, 500));
    await expect(layerLastEdited(layer, { retries: 0 })).resolves.toBeNull();
  });

  it('is recorded per set by fetchState', async () => {
    mockFetch((call) =>
      call.url.endsWith('?f=json')
        ? jsonResponse({ editingInfo: { lastEditDate: ms } })
        : jsonResponse({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square(-116), properties: { U: 1 } }] })
    );
    const s = state();
    s.sets = [s.sets[0]];
    const result = await fetchState(s, { retries: 0 });
    expect(result.sets[0].updated).toBe('2026-08-27');
  });
});

