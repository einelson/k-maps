import { cellBounds } from '../downloads/cells.ts';
import { OVERPASS_ENDPOINTS, resetOverpassEndpointPreference } from './http.ts';
import { fetchPoiPack, poiQueries } from './poi.ts';
import { jsonResponse, mockFetch } from './testUtils.ts';
import type { Bounds } from './types.ts';

const CELL = cellBounds(181, 373) as Bounds;
const [W, S, E, N] = CELL;

beforeEach(() => resetOverpassEndpointPreference());

describe('fetchPoiPack', () => {
  it('queries boat launches and campsites/trailheads over the bounds (south,west,north,east)', () => {
    const q = poiQueries(CELL);
    expect(q.boatLaunches).toContain(`node["leisure"="slipway"](${S},${W},${N},${E})`);
    expect(q.campsitesTrails).toContain(`node["tourism"="camp_site"](${S},${W},${N},${E})`);
    expect(q.campsitesTrails).toContain(`node["highway"="trailhead"](${S},${W},${N},${E})`);
    expect(q.campsitesTrails).toContain(`node["tourism"="information"]["information"="trailhead"](${S},${W},${N},${E})`);
  });

  it('returns Point features with camelCase category, name and osm_id', async () => {
    const { calls } = mockFetch((call) => {
      const data = call.params.get('data')!;
      if (data.includes('slipway')) {
        return jsonResponse({
          elements: [
            { type: 'node', id: 11, lat: S + 0.1, lon: W + 0.1, tags: { leisure: 'slipway', name: 'Ramp' } },
            { type: 'node', id: 12, lat: S + 0.2, lon: W + 0.2 },
            { type: 'way', id: 13 },
            { type: 'node', id: 14, lat: N + 1, lon: W }, // outside the cell
          ],
        });
      }
      return jsonResponse({ elements: [{ type: 'node', id: 21, lat: S + 0.05, lon: W + 0.3, tags: { tourism: 'camp_site' } }] });
    });
    const progress: number[] = [];
    const fc = await fetchPoiPack(CELL, { onProgress: (f) => progress.push(f) });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(OVERPASS_ENDPOINTS[0]);
    expect(fc.features).toEqual([
      { type: 'Feature', properties: { category: 'boatLaunches', name: 'Ramp', osm_id: 11 }, geometry: { type: 'Point', coordinates: [W + 0.1, S + 0.1] } },
      { type: 'Feature', properties: { category: 'boatLaunches', name: null, osm_id: 12 }, geometry: { type: 'Point', coordinates: [W + 0.2, S + 0.2] } },
      { type: 'Feature', properties: { category: 'campsitesTrails', name: null, osm_id: 21 }, geometry: { type: 'Point', coordinates: [W + 0.3, S + 0.05] } },
    ]);
    expect(progress).toEqual([0, 0.5, 1]);
  });
});
