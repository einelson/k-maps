import { cellBounds } from '../downloads/cells.ts';
import { fetchMvumPack, MVUM_SERVICE_URL } from './mvum.ts';
import { jsonResponse, mockFetch } from './testUtils.ts';
import type { Bounds } from './types.ts';

const CELL = cellBounds(182, 372) as Bounds;
const [W, S, E, N] = CELL;
const MID_LON = (W + E) / 2;
const MID_LAT = (S + N) / 2;

const road = (props: Record<string, unknown>, coords: number[][]) => ({
  type: 'Feature',
  properties: { name: 'FR 100', operationalmaintlevel: '3 - SUITABLE FOR PASSENGER CARS', passengervehicle: 'open', ...props },
  geometry: { type: 'LineString', coordinates: coords },
});

describe('fetchMvumPack', () => {
  it('fetches roads + trails, clips lines to the cell, stamps kind and vehicleClass', async () => {
    const { calls } = mockFetch((call) => {
      const layer = Number(call.url.split('/').slice(-2)[0]);
      if (layer === 1) {
        return jsonResponse({
          features: [
            road({}, [[MID_LON, MID_LAT], [E + 0.5, MID_LAT]]), // crosses the east edge
            road({ passengervehicle: 'closed', highclearancevehicle: 'open', name: 'FR 200' }, [[W + 0.01, S + 0.01], [W + 0.02, S + 0.02]]),
            road({}, [[E + 1, N + 1], [E + 2, N + 2]]), // outside
          ],
        });
      }
      return jsonResponse({
        features: [
          {
            type: 'Feature',
            properties: { name: 'Trail 1', trailclass: 'TC2', atv: 'open', motorcycle: 'open' },
            geometry: { type: 'MultiLineString', coordinates: [[[W + 0.01, MID_LAT], [W + 0.03, MID_LAT]]] },
          },
        ],
      });
    });
    const progress: number[] = [];
    const fc = await fetchMvumPack(CELL, { onProgress: (f) => progress.push(f) });

    expect(calls.map((c) => c.url)).toEqual([`${MVUM_SERVICE_URL}/1/query`, `${MVUM_SERVICE_URL}/2/query`]);
    expect(calls[0].params.get('geometry')).toBe(`${W},${S},${E},${N}`);
    expect(calls[0].params.get('outFields')).toContain('operationalmaintlevel');
    expect(calls[1].params.get('outFields')).toContain('trailclass');

    expect(fc.features).toHaveLength(3);
    const [a, b, t] = fc.features;
    expect(a.properties).toMatchObject({ kind: 'road', vehicleClass: 'passenger', name: 'FR 100', passengervehicle: 'open' });
    expect(a.geometry).toEqual({ type: 'LineString', coordinates: [[MID_LON, MID_LAT], [E, MID_LAT]] });
    expect(b.properties).toMatchObject({ kind: 'road', vehicleClass: 'highClearance', name: 'FR 200' });
    expect(t.properties).toMatchObject({ kind: 'trail', vehicleClass: 'offroad' });
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('pages through more than one page of results', async () => {
    const { calls } = mockFetch((call) => {
      const layer = Number(call.url.split('/').slice(-2)[0]);
      const offset = Number(call.params.get('resultOffset'));
      if (layer === 2) return jsonResponse({ features: [] });
      const n = offset === 0 ? 2000 : 5;
      return jsonResponse({
        features: Array.from({ length: n }, (_, i) => road({ name: `r${offset + i}` }, [[W + 0.001, S + 0.001 + i * 1e-6], [W + 0.002, S + 0.001 + i * 1e-6]])),
      });
    });
    const fc = await fetchMvumPack(CELL);
    expect(fc.features).toHaveLength(2005);
    expect(calls.filter((c) => c.url.includes('/1/')).map((c) => c.params.get('resultOffset'))).toEqual(['0', '2000']);
  });
});
