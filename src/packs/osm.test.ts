import { cellBounds } from '../downloads/cells.ts';
import { resetOverpassEndpointPreference } from './http.ts';
import {
  createWayAccumulator,
  fetchOsmRoadsPack,
  OSM_HIGHWAY_VALUES,
  osmRoadClass,
  osmRoadsQuery,
  splitBounds,
  wayToFeature,
} from './osm.ts';
import { jsonResponse, mockFetch } from './testUtils.ts';
import type { Bounds } from './types.ts';

const CELL = cellBounds(181, 373) as Bounds;
const [W, S, E, N] = CELL;

beforeEach(() => resetOverpassEndpointPreference());

const way = (id: number, tags: Record<string, string>, pts: [number, number][]) => ({
  type: 'way',
  id,
  tags,
  geometry: pts.map(([lon, lat]) => ({ lat, lon })),
});

describe('road class mapping', () => {
  it.each([
    ['motorway', 'highway'],
    ['trunk_link', 'highway'],
    ['primary', 'primary'],
    ['secondary_link', 'primary'],
    ['tertiary', 'street'],
    ['unclassified', 'street'],
    ['residential', 'street'],
    ['living_street', 'street'],
    ['road', 'street'],
    ['track', 'track'],
    ['path', 'path'],
    ['footway', 'path'],
    ['bridleway', 'path'],
    ['cycleway', 'path'],
    ['steps', 'path'],
    ['pedestrian', 'path'],
  ])('%s -> %s', (highway, cls) => {
    expect(osmRoadClass(highway)).toBe(cls);
  });

  it.each(['service', 'proposed', 'construction', 'abandoned', 'razed', 'bus_stop', 'platform', undefined])(
    'excludes %s',
    (highway) => {
      expect(osmRoadClass(highway)).toBeNull();
    }
  );
});

describe('osmRoadsQuery', () => {
  it('filters highways server-side: no service/proposed/construction, no sidewalks/crossings, out tags geom', () => {
    const q = osmRoadsQuery([W, S, E, N]);
    expect(q).toContain(`(${S},${W},${N},${E})`);
    expect(q).toContain('["footway"!~"^(sidewalk|crossing)$"]');
    expect(q).toMatch(/\["highway"!~"\^\((?=[^)]*\bservice\b)(?=[^)]*\bproposed\b)(?=[^)]*\bconstruction\b)(?=[^)]*\babandoned\b)(?=[^)]*\brazed\b)/);
    expect(q).toContain('out tags geom');
    expect(OSM_HIGHWAY_VALUES).not.toContain('service');
  });
});

describe('wayToFeature', () => {
  it('derives cls, keeps optional tags, rounds to 5 decimals', () => {
    const f = wayToFeature(
      way(1, { highway: 'track', name: 'Old Mill Rd', surface: 'gravel', tracktype: 'grade2', ref: 'FR 12', lanes: '2' }, [
        [-116.123456789, 43.123456789],
        [-116.2, 43.2],
      ])
    )!;
    expect(f.properties).toEqual({ highway: 'track', cls: 'track', name: 'Old Mill Rd', ref: 'FR 12', surface: 'gravel', tracktype: 'grade2' });
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[-116.12346, 43.12346], [-116.2, 43.2]] });
  });

  it('omits absent optional tags and rejects sidewalks, crossings, service roads and degenerate ways', () => {
    expect(wayToFeature(way(1, { highway: 'residential' }, [[0, 0], [1, 1]]))!.properties).toEqual({ highway: 'residential', cls: 'street' });
    expect(wayToFeature(way(2, { highway: 'footway', footway: 'sidewalk' }, [[0, 0], [1, 1]]))).toBeNull();
    expect(wayToFeature(way(3, { highway: 'footway', footway: 'crossing' }, [[0, 0], [1, 1]]))).toBeNull();
    expect(wayToFeature(way(4, { highway: 'service' }, [[0, 0], [1, 1]]))).toBeNull();
    expect(wayToFeature(way(5, { highway: 'path' }, [[0, 0], [0.000001, 0.000001]]))).toBeNull(); // collapses when rounded
    expect(wayToFeature({ type: 'way', id: 6, tags: { highway: 'path' } })).toBeNull(); // no geometry
  });
});

describe('splitBounds', () => {
  it('tiles the bounds exactly with a 3x3 grid', () => {
    const boxes = splitBounds(CELL);
    expect(boxes).toHaveLength(9);
    expect(Math.min(...boxes.map((b) => b[0]))).toBe(W);
    expect(Math.max(...boxes.map((b) => b[2]))).toBe(E);
    expect(Math.min(...boxes.map((b) => b[1]))).toBe(S);
    expect(Math.max(...boxes.map((b) => b[3]))).toBe(N);
    // Neighbouring boxes share edges exactly (no gaps).
    expect(boxes[0][2]).toBe(boxes[1][0]);
    expect(boxes[0][3]).toBe(boxes[3][1]);
  });
});

describe('fetchOsmRoadsPack', () => {
  it('queries 9 sub-boxes sequentially, dedupes ways by id, clips to the cell', async () => {
    const boxes = splitBounds(CELL);
    const crossing = way(100, { highway: 'primary', name: 'Long Rd' }, [[W + 0.1, S + 0.1], [E - 0.1, S + 0.1]]); // crosses several sub-boxes
    const protruding = way(101, { highway: 'track' }, [[E - 0.05, N - 0.05], [E + 0.5, N - 0.05]]); // leaves the cell
    const outside = way(102, { highway: 'path' }, [[E + 1, N + 1], [E + 1.1, N + 1.1]]);
    let inFlight = 0;
    let maxInFlight = 0;
    const { calls } = mockFetch(async (call, i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      const elements: unknown[] = [crossing]; // every box "sees" the long way
      if (i === 8) elements.push(protruding, outside);
      elements.push(way(200 + i, { highway: 'residential' }, [[boxes[i][0] + 0.001, boxes[i][1] + 0.001], [boxes[i][0] + 0.002, boxes[i][1] + 0.002]]));
      return jsonResponse({ elements });
    });
    const progress: number[] = [];
    const fc = await fetchOsmRoadsPack(CELL, { onProgress: (f) => progress.push(f) });

    expect(calls).toHaveLength(9);
    expect(maxInFlight).toBe(1);
    boxes.forEach((b, i) => {
      expect(calls[i].params.get('data')).toContain(`(${b[1]},${b[0]},${b[3]},${b[2]})`);
    });
    expect(fc.features).toHaveLength(1 + 1 + 9); // long way once, protruding track, nine residential streets
    const longWays = fc.features.filter((f) => f.properties.name === 'Long Rd');
    expect(longWays).toHaveLength(1);
    const track = fc.features.find((f) => f.properties.cls === 'track')!;
    const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
    // Coordinates are rounded to 5 decimals first; the clip point on the cell edge stays exactly on the edge.
    expect(track.geometry).toEqual({
      type: 'LineString',
      coordinates: [[r5(E - 0.05), r5(N - 0.05)], [E, r5(N - 0.05)]],
    });
    expect(fc.features.some((f) => f.properties.cls === 'path')).toBe(false);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('survives a flaky sub-box request (retries and continues)', async () => {
    const { calls } = mockFetch((_c, i) => (i === 3 ? jsonResponse('busy', 503) : jsonResponse({ elements: [] })));
    const fc = await fetchOsmRoadsPack(CELL);
    expect(fc.features).toEqual([]);
    expect(calls).toHaveLength(10);
  });

  it('accumulator dedupes across calls', () => {
    const acc = createWayAccumulator(CELL);
    const w = way(1, { highway: 'path' }, [[W + 0.1, S + 0.1], [W + 0.2, S + 0.2]]);
    acc.add([w]);
    acc.add([w, way(2, { highway: 'path' }, [[W + 0.3, S + 0.05], [W + 0.4, S + 0.1]])]);
    expect(acc.features).toHaveLength(2);
  });

  it('aborts between requests', async () => {
    const controller = new AbortController();
    const { calls } = mockFetch(() => {
      controller.abort();
      return jsonResponse({ elements: [] });
    });
    await expect(fetchOsmRoadsPack(CELL, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(1);
  });
});
