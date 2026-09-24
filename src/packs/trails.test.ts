import { cellBounds } from '../downloads/cells.ts';
import {
  allowedTrailUseKeys,
  fetchTrailsPack,
  prettyTrailName,
  TRAILS_OUT_FIELDS,
  TRAILS_SERVICE_URL,
  trailClass,
  trailProperties,
} from './trails.ts';
import { jsonResponse, mockFetch } from './testUtils.ts';
import type { Bounds } from './types.ts';

const CELL = cellBounds(182, 372) as Bounds;
const [W, S, E, N] = CELL;
const MID_LON = (W + E) / 2;
const MID_LAT = (S + N) / 2;

const trail = (props: Record<string, unknown>, coordinates: unknown, type = 'LineString') => ({
  type: 'Feature',
  properties: { trail_name: 'MORES MOUNTAIN INTERPRETIVE', trail_no: '190B01', hiker_pedestrian_managed: '01/01-12/31', ...props },
  geometry: { type, coordinates },
});

describe('trail classification', () => {
  it('reads allowed uses from the managed / accepted season columns, ignoring blanks', () => {
    expect(allowedTrailUseKeys({ hiker_pedestrian_managed: '01/01-12/31', bicycle_accpt: '06/01-10/15' })).toEqual([
      'hiker_pedestrian',
      'bicycle',
    ]);
    expect(allowedTrailUseKeys({ hiker_pedestrian_managed: '  ', bicycle_managed: null, atv_restricted: '01/01-12/31' })).toEqual([]);
    expect(allowedTrailUseKeys({})).toEqual([]);
  });

  it('is motorized when flagged, or when only motor vehicles are allowed', () => {
    expect(trailClass({ terra_motorized: 'Y' })).toBe('motorized');
    expect(trailClass({ motorcycle_managed: 'x', atv_managed: 'x' })).toBe('motorized');
    expect(trailClass({ fourwd_accpt: 'x' })).toBe('motorized');
  });

  it('is non-motorized for shared, foot/horse/bike, and unrecorded trails', () => {
    expect(trailClass({ hiker_pedestrian_managed: 'x', motorcycle_managed: 'x' })).toBe('nonmotorized'); // shared with hikers
    expect(trailClass({ pack_saddle_managed: 'x' })).toBe('nonmotorized');
    expect(trailClass({ terra_motorized: 'N' })).toBe('nonmotorized');
    expect(trailClass({})).toBe('nonmotorized');
  });
});

describe('trail properties', () => {
  it('title-cases the agency\'s ALL-CAPS names', () => {
    expect(prettyTrailName('MORES MOUNTAIN INTERPRETIVE')).toBe('Mores Mountain Interpretive');
    expect(prettyTrailName('RIDGE-TO-RIVERS (NORTH)')).toBe('Ridge-To-Rivers (North)');
    expect(prettyTrailName('  ')).toBeNull();
    expect(prettyTrailName(null)).toBeNull();
  });

  it('boils ~100 service columns down to the few the card and style use', () => {
    const props = trailProperties({
      trail_name: 'BREWERS BYWAY',
      trail_no: '096-R2R',
      trail_class: '2',
      trail_surface: 'NATIVE MATERIAL',
      typical_tread_width: 'TW02 - 12-18 INCHES',
      terra_motorized: 'N',
      gis_miles: 0.858,
      hiker_pedestrian_managed: '01/01-12/31',
      bicycle_managed: '01/01-12/31',
      snowmobile_managed: 'x',
      special_mgmt_area: 'nope',
    });
    expect(props).toEqual({
      kind: 'trail',
      name: 'Brewers Byway',
      trail_no: '096-R2R',
      trailClass: 'nonmotorized',
      uses: 'Hiking, Bike',
      surface: 'Native Material',
      width: 'TW02 - 12-18 INCHES',
      tc: '2',
      miles: 0.858,
    });
  });

  it('nulls what is missing instead of inventing it', () => {
    expect(trailProperties({})).toMatchObject({ name: null, trail_no: null, uses: null, miles: null });
  });
});

describe('fetchTrailsPack', () => {
  it('queries walk/ride trails only, clips lines to the cell and stamps compact properties', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        features: [
          trail({}, [[MID_LON, MID_LAT], [E + 0.5, MID_LAT]]), // crosses the east edge
          trail({ trail_name: 'FAR AWAY' }, [[E + 1, N + 1], [E + 2, N + 2]]), // outside
          trail({ terra_motorized: 'Y', hiker_pedestrian_managed: null }, [[[W + 0.01, MID_LAT], [W + 0.03, MID_LAT]]], 'MultiLineString'),
          trail({}, [MID_LON, MID_LAT], 'Point'), // not a line
        ],
      })
    );
    const progress: number[] = [];
    const fc = await fetchTrailsPack(CELL, { onProgress: (f) => progress.push(f) });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TRAILS_SERVICE_URL}/query`);
    expect(calls[0].params.get('where')).toBe("trail_type = 'TERRA'");
    expect(calls[0].params.get('geometry')).toBe(`${W},${S},${E},${N}`);
    expect(calls[0].params.get('outFields')).toBe(TRAILS_OUT_FIELDS);
    expect(calls[0].params.get('outFields')).toContain('bicycle_managed');

    expect(fc.features).toHaveLength(2);
    const [a, b] = fc.features;
    expect(a.properties).toMatchObject({ kind: 'trail', name: 'Mores Mountain Interpretive', trailClass: 'nonmotorized', uses: 'Hiking' });
    expect(a.geometry).toEqual({ type: 'LineString', coordinates: [[MID_LON, MID_LAT], [E, MID_LAT]] });
    expect(b.properties).toMatchObject({ trailClass: 'motorized' });
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('pages through more than one page of results', async () => {
    const line = [[MID_LON, MID_LAT], [MID_LON + 0.001, MID_LAT]];
    const { calls } = mockFetch((call) =>
      Number(call.params.get('resultOffset')) === 0
        ? jsonResponse({ features: Array.from({ length: 2000 }, () => trail({}, line)) })
        : jsonResponse({ features: [trail({}, line)] })
    );
    const fc = await fetchTrailsPack(CELL);
    expect(calls.map((c) => Number(c.params.get('resultOffset')))).toEqual([0, 2000]);
    expect(fc.features).toHaveLength(2001);
  });

  it('returns an empty collection for a cell with no National Forest trails', async () => {
    mockFetch(() => jsonResponse({ features: [] }));
    expect(await fetchTrailsPack(CELL)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
