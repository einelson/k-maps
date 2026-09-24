import {
  fetchWildfirePerimeters,
  normalizeWildfireFeature,
  WILDFIRE_OUT_FIELDS,
  WILDFIRE_SERVICE_URL,
} from './wildfire.ts';
import { jsonResponse, mockFetch, square } from './testUtils.ts';

const fire = (props: Record<string, unknown>, geometry: unknown = square(-116, 44, 0.05)) => ({
  type: 'Feature',
  properties: props,
  geometry,
});

const CASCADE = {
  poly_IncidentName: 'Cascade',
  poly_GISAcres: 7475.2,
  attr_PercentContained: 80,
  attr_FireDiscoveryDateTime: 1784303160000,
  poly_PolygonDateTime: 1784676983000,
  attr_POOState: 'US-ID',
  attr_POOCounty: 'Idaho',
  attr_IncidentShortDescription: '19 Miles E from Lowell, ID',
  attr_IncidentTypeCategory: 'WF',
  attr_FireCause: 'Natural',
};

describe('normalizeWildfireFeature', () => {
  it('flattens the prefixed service fields into the compact properties the map and card use', () => {
    const f = normalizeWildfireFeature(fire(CASCADE) as any)!;
    expect(f.properties).toEqual({
      name: 'Cascade',
      acres: 7475.2,
      containment: 80,
      discovered: 1784303160000,
      updated: 1784676983000,
      state: 'ID',
      county: 'Idaho',
      description: '19 Miles E from Lowell, ID',
      category: 'WF',
      cause: 'Natural',
    });
    expect(f.geometry.type).toBe('Polygon');
  });

  it('keeps MultiPolygons and drops anything that is not a polygon', () => {
    const multi = { type: 'MultiPolygon', coordinates: [square(-116, 44, 0.05).coordinates] };
    expect(normalizeWildfireFeature(fire(CASCADE, multi) as any)!.geometry.type).toBe('MultiPolygon');
    expect(normalizeWildfireFeature(fire(CASCADE, { type: 'Point', coordinates: [1, 2] }) as any)).toBeNull();
    expect(normalizeWildfireFeature(fire(CASCADE, null) as any)).toBeNull();
  });

  it('falls back sensibly when the feed leaves fields out', () => {
    const f = normalizeWildfireFeature(
      fire({ attr_IncidentName: 'Backup Name', attr_IncidentSize: 12, poly_DateCurrent: 555 }) as any
    )!;
    expect(f.properties).toMatchObject({
      name: 'Backup Name', // poly name missing -> attr name
      acres: 12, // GIS acres missing -> reported size
      updated: 555, // polygon time missing -> record-current time
      containment: null, // never reported: null, not 0
      state: null,
      category: 'WF',
    });
    expect(normalizeWildfireFeature(fire({}) as any)!.properties?.name).toBe('Unnamed fire');
  });

  it('clamps containment into 0-100 and trims blank strings to null', () => {
    const over = normalizeWildfireFeature(fire({ ...CASCADE, attr_PercentContained: 140 }) as any)!;
    const under = normalizeWildfireFeature(fire({ ...CASCADE, attr_PercentContained: -5 }) as any)!;
    expect(over.properties?.containment).toBe(100);
    expect(under.properties?.containment).toBe(0);
    const blank = normalizeWildfireFeature(fire({ ...CASCADE, attr_FireCause: '  ', attr_POOCounty: '' }) as any)!;
    expect(blank.properties).toMatchObject({ cause: null, county: null });
  });

  it('keeps prescribed burns distinguishable from wildfires', () => {
    expect(normalizeWildfireFeature(fire({ ...CASCADE, attr_IncidentTypeCategory: 'RX' }) as any)!.properties?.category).toBe('RX');
  });
});

describe('fetchWildfirePerimeters', () => {
  it('queries the open WFIGS "current perimeters" layer for everything, in WGS84, simplified', async () => {
    const { calls } = mockFetch(() => jsonResponse({ features: [fire(CASCADE)] }));
    const progress: number[] = [];
    const fc = await fetchWildfirePerimeters({ onProgress: (f) => progress.push(f) });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WILDFIRE_SERVICE_URL}/query`);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].params.get('where')).toBe('1=1');
    expect(calls[0].params.get('outSR')).toBe('4326');
    expect(calls[0].params.get('f')).toBe('geojson');
    expect(calls[0].params.get('outFields')).toBe(WILDFIRE_OUT_FIELDS);
    expect(Number(calls[0].params.get('maxAllowableOffset'))).toBeGreaterThan(0);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.name).toBe('Cascade');
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('uses the open service, not the token-gated one from the original request', () => {
    expect(WILDFIRE_SERVICE_URL).toContain('WFIGS_Interagency_Perimeters_Current');
    expect(WILDFIRE_SERVICE_URL).not.toContain('Public_Wildfire_Perimeters_View');
  });

  it('pages when the service returns a full page, then stops on a short one', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => fire({ ...CASCADE, poly_IncidentName: `Fire ${i}` }));
    const { calls } = mockFetch((call) =>
      Number(call.params.get('resultOffset')) === 0 ? jsonResponse({ features: page(500) }) : jsonResponse({ features: page(37) })
    );
    const fc = await fetchWildfirePerimeters();
    expect(calls.map((c) => Number(c.params.get('resultOffset')))).toEqual([0, 500]);
    expect(fc.features).toHaveLength(537);
  });

  it('skips non-polygon rows instead of failing', async () => {
    mockFetch(() => jsonResponse({ features: [fire(CASCADE), fire(CASCADE, { type: 'Point', coordinates: [0, 0] })] }));
    expect((await fetchWildfirePerimeters()).features).toHaveLength(1);
  });

  it('returns an empty collection when nothing is burning', async () => {
    mockFetch(() => jsonResponse({ features: [] }));
    expect(await fetchWildfirePerimeters()).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('surfaces a service error (e.g. the token-required response) instead of returning nothing quietly', async () => {
    mockFetch(() => jsonResponse({ error: { code: 499, message: 'Token Required' } }));
    await expect(fetchWildfirePerimeters()).rejects.toThrow(/Token Required/);
  });

  it('rejects with an AbortError when already aborted, without touching the network', async () => {
    const { fn } = mockFetch(() => jsonResponse({ features: [] }));
    const controller = new AbortController();
    controller.abort();
    await expect(fetchWildfirePerimeters({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
  });
});
