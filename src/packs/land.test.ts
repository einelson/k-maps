import { area } from '@turf/turf';

import { cellBounds } from '../downloads/cells.ts';
import { segmentOnBoundary } from './clip.ts';
import {
  buildOutlines,
  fetchLandPack,
  LAND_FEDERAL_SERVICE_URL,
  LAND_NONFEDERAL_URL,
  LAND_OUT_FIELDS,
} from './land.ts';
import { jsonResponse, mockFetch, square } from './testUtils.ts';
import type { Bounds, PackFeature } from './types.ts';

const CELL = cellBounds(181, 373) as Bounds;
const [W, S, E, N] = CELL;
const MID_LON = (W + E) / 2;
const MID_LAT = (S + N) / 2;

function poly(id: number, props: Record<string, unknown>, geometry: unknown) {
  return { type: 'Feature', id, properties: { Pub_Access: 'OA', Own_Type: 'FED', Mang_Name: 'BLM', ...props }, geometry };
}

/** Big unclipped polygon: west half of the cell plus a lot beyond it (the services never clip). */
const BIG_UNCLIPPED = poly(
  1,
  { Unit_Nm: 'Big Forest', Pub_Access: 'OA' },
  { type: 'Polygon', coordinates: [[[W - 1, S - 1], [MID_LON, S - 1], [MID_LON, N + 1], [W - 1, N + 1], [W - 1, S - 1]]] }
);
/** Small restricted polygon straddling the north edge. */
const STRADDLER = poly(
  2,
  { Unit_Nm: 'Straddler', Pub_Access: 'RA' },
  square(MID_LON + 0.1, N, 0.05)
);
const FAR_AWAY = poly(3, { Unit_Nm: 'Far' }, square(E + 5, N + 5, 0.1));

function landRouter(opts: { federal?: Record<number, unknown[]>; nonFederal?: (offset: number) => unknown[] }) {
  return (call: { url: string; params: URLSearchParams }) => {
    if (call.url.startsWith(LAND_FEDERAL_SERVICE_URL)) {
      const layer = Number(call.url.split('/').slice(-2)[0]);
      return jsonResponse({ type: 'FeatureCollection', features: opts.federal?.[layer] ?? [] });
    }
    if (call.url.startsWith(LAND_NONFEDERAL_URL)) {
      const offset = Number(call.params.get('resultOffset') ?? 0);
      return jsonResponse({ type: 'FeatureCollection', features: opts.nonFederal?.(offset) ?? [] });
    }
    throw new Error(`unexpected url ${call.url}`);
  };
}

describe('fetchLandPack', () => {
  it('queries every federal layer plus non-federal with the documented parameters', async () => {
    const { calls } = mockFetch(landRouter({}));
    await fetchLandPack(CELL, {}, { skipPrivate: true });
    const urls = calls.map((c) => c.url);
    for (let layer = 0; layer <= 5; layer++) {
      expect(urls).toContain(`${LAND_FEDERAL_SERVICE_URL}/${layer}/query`);
    }
    expect(urls).toContain(`${LAND_NONFEDERAL_URL}/query`);
    const federal = calls.find((c) => c.url.includes('/MapServer/5/'))!;
    expect(federal.params.get('geometry')).toBe(`${W},${S},${E},${N}`);
    expect(federal.params.get('outFields')).toBe(LAND_OUT_FIELDS);
    expect(federal.params.get('outSR')).toBe('4326');
    const nonFederal = calls.find((c) => c.url.startsWith(LAND_NONFEDERAL_URL))!;
    expect(nonFederal.params.get('where')).toBe(
      "Mang_Type IN ('STAT','LOC','DIST','JNT') AND (Des_Tp IS NULL OR Des_Tp NOT IN ('UNKE'))"
    );
    expect(nonFederal.params.get('maxAllowableOffset')).toBe('0.0002');
  });

  it('clips to bounds, tags kinds and source layers, drops features outside the cell', async () => {
    mockFetch(
      landRouter({
        federal: { 0: [BIG_UNCLIPPED, FAR_AWAY], 5: [STRADDLER] },
        nonFederal: () => [poly(9, { Mang_Type: 'STAT', Pub_Access: 'XA' }, square(MID_LON - 0.2, MID_LAT, 0.05))],
      })
    );
    const progress: number[] = [];
    const fc = await fetchLandPack(CELL, { onProgress: (f) => progress.push(f) }, { skipPrivate: true });
    const publics = fc.features.filter((f) => f.properties.kind === 'public');
    expect(publics.map((f) => f.properties.source_layer)).toEqual(['PADUS_BLM', 'PADUS_USFS', 'PADUS4_1_STAT']);
    expect(publics.map((f) => f.properties.Unit_Nm)).toEqual(['Big Forest', 'Straddler', undefined].map((v) => v ?? null));
    // Every public polygon lies within the cell.
    for (const f of publics) {
      for (const ring of (f.geometry as any).coordinates.flat(f.geometry.type === 'MultiPolygon' ? 1 : 0) as number[][][]) {
        for (const [x, y] of ring as unknown as number[][]) {
          expect(x).toBeGreaterThanOrEqual(W);
          expect(x).toBeLessThanOrEqual(E);
          expect(y).toBeGreaterThanOrEqual(S);
          expect(y).toBeLessThanOrEqual(N);
        }
      }
    }
    // Big polygon clipped to the west half of the cell.
    const cellArea = area({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[W, S], [E, S], [E, N], [W, N], [W, S]]] } });
    expect(area(publics[0] as any)).toBeCloseTo(cellArea / 2, -6);
    expect(publics[0].properties).toMatchObject({ Pub_Access: 'OA', Own_Type: 'FED', Mang_Name: 'BLM' });
    expect(Object.keys(publics[0].properties).sort()).toEqual(
      ['kind', 'Pub_Access', 'Own_Type', 'Own_Name', 'Mang_Type', 'Mang_Name', 'Unit_Nm', 'Des_Tp', 'GAP_Sts', 'source_layer'].sort()
    );
    // Progress is monotonic and finishes at 1.
    expect(progress[progress.length - 1]).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('outlines carry Pub_Access and never lie on the clip rectangle', async () => {
    mockFetch(landRouter({ federal: { 0: [BIG_UNCLIPPED], 5: [STRADDLER] } }));
    const fc = await fetchLandPack(CELL, {}, { skipPrivate: true });
    const outlines = fc.features.filter((f) => f.properties.kind === 'outline');
    expect(outlines.map((f) => f.properties.Pub_Access).sort()).toEqual(['OA', 'RA']);
    for (const o of outlines) {
      expect(['LineString', 'MultiLineString']).toContain(o.geometry.type);
      const lines = o.geometry.type === 'LineString' ? [o.geometry.coordinates] : (o.geometry as any).coordinates;
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines as number[][][]) {
        for (let i = 0; i < line.length - 1; i++) {
          expect(segmentOnBoundary(line[i], line[i + 1], CELL)).toBe(false);
        }
      }
    }
    // The big polygon's interior edge (x = MID_LON) is still outlined.
    const oa = outlines.find((f) => f.properties.Pub_Access === 'OA')!;
    const oaLines = oa.geometry.type === 'LineString' ? [oa.geometry.coordinates] : (oa.geometry as any).coordinates;
    expect((oaLines as number[][][]).flat().some(([x]) => x === MID_LON)).toBe(true);
  });

  it('paginates the non-federal service (1000 per page)', async () => {
    const tiny = (i: number) =>
      poly(i, { Mang_Type: 'LOC', Unit_Nm: `P${i}` }, square(W + 0.001 * (i % 100) + 0.01, S + 0.001 * Math.floor(i / 100) + 0.01, 0.0002));
    const { calls } = mockFetch(
      landRouter({
        nonFederal: (offset) => {
          if (offset === 0) return Array.from({ length: 1000 }, (_, i) => tiny(i));
          if (offset === 1000) return [tiny(1000), tiny(1001), tiny(1002)];
          return [];
        },
      })
    );
    const fc = await fetchLandPack(CELL, {}, { skipPrivate: true });
    const nonFederalCalls = calls.filter((c) => c.url.startsWith(LAND_NONFEDERAL_URL));
    expect(nonFederalCalls.map((c) => c.params.get('resultOffset'))).toEqual(['0', '1000']);
    expect(fc.features.filter((f) => f.properties.kind === 'public')).toHaveLength(1003);
  });

  it('federal truncation (1000-record cap, no pagination) falls back to fetching by objectIds', async () => {
    const { calls } = mockFetch((call) => {
      if (call.url.startsWith(LAND_NONFEDERAL_URL)) return jsonResponse({ features: [] });
      if (!call.url.includes('/MapServer/2/')) return jsonResponse({ features: [] });
      if (call.params.get('returnIdsOnly') === 'true') return jsonResponse({ objectIdFieldName: 'FID', objectIds: [7, 8] });
      if (call.params.get('objectIds')) return jsonResponse({ features: [poly(7, { Unit_Nm: 'seven' }, square(MID_LON, MID_LAT, 0.05)), poly(8, { Unit_Nm: 'eight' }, square(MID_LON + 0.2, MID_LAT, 0.05))] });
      return jsonResponse({ features: [poly(7, {}, square(MID_LON, MID_LAT, 0.05))], exceededTransferLimit: true });
    });
    const fc = await fetchLandPack(CELL, {}, { skipPrivate: true });
    expect(fc.features.filter((f) => f.properties.kind === 'public').map((f) => f.properties.Unit_Nm)).toEqual(['seven', 'eight']);
    expect(calls.some((c) => c.params.get('returnIdsOnly') === 'true')).toBe(true);
  });

  it('adds the likely-private remainder: cell minus public area', async () => {
    mockFetch(landRouter({ federal: { 0: [BIG_UNCLIPPED] } }));
    const fc = await fetchLandPack(CELL);
    const priv = fc.features.filter((f) => f.properties.kind === 'private');
    expect(priv).toHaveLength(1);
    expect(Object.keys(priv[0].properties)).toEqual(['kind']);
    const cellArea = area({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[W, S], [E, S], [E, N], [W, N], [W, S]]] } });
    expect(area(priv[0] as any)).toBeCloseTo(cellArea / 2, -6);
  });

  it('an empty cell yields a single full-cell private polygon and no outlines', async () => {
    mockFetch(landRouter({}));
    const fc = await fetchLandPack(CELL);
    expect(fc.features.map((f) => f.properties.kind)).toEqual(['private']);
  });

  it('propagates abort', async () => {
    const controller = new AbortController();
    mockFetch(() => {
      controller.abort();
      return jsonResponse({ features: [] });
    });
    await expect(fetchLandPack(CELL, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('buildOutlines', () => {
  it('groups by Pub_Access and defaults a missing value to UK', () => {
    const f = (access: string | null, g: unknown) =>
      ({ type: 'Feature', properties: { kind: 'public', Pub_Access: access }, geometry: g }) as PackFeature;
    const out = buildOutlines(
      [f('OA', square(0.3, 0.3, 0.1)), f('OA', square(0.7, 0.7, 0.1)), f(null, square(0.5, 0.5, 0.05))],
      [0, 0, 1, 1]
    );
    expect(out.map((o) => o.properties.Pub_Access).sort()).toEqual(['OA', 'UK']);
    const oa = out.find((o) => o.properties.Pub_Access === 'OA')!;
    expect(oa.geometry.type).toBe('MultiLineString');
  });
});
