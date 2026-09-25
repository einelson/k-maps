import type { Feature, Polygon } from 'geojson';

import { normalizeSet } from './normalize.ts';
import { HUNT_STATE_BY_CODE, HUNT_STATES } from './registry.ts';

const SQUARE: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const featureOf = (attributes: Record<string, any>): Feature<Polygon, Record<string, any>> => ({ type: 'Feature', geometry: SQUARE, properties: attributes });

describe('hunt unit registry', () => {
  it('lists each state once, with two-letter codes', () => {
    const codes = HUNT_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(Object.keys(HUNT_STATE_BY_CODE).sort()).toEqual([...codes].sort());
  });

  it('gives every state an agency, an https regulations page and at least one set', () => {
    for (const state of HUNT_STATES) {
      expect(state.name).toBeTruthy();
      expect(state.agency).toBeTruthy();
      expect(typeof state.vintage).toBe('string'); // empty when the agency states no season / year
      expect(state.vintage).not.toMatch(/current/i); // dates come from the service, never a claim of being current
      expect(state.regsUrl).toMatch(/^https:\/\//);
      expect(state.sets.length).toBeGreaterThan(0);
    }
  });

  it('uses unique set ids per state and https ArcGIS layer URLs', () => {
    for (const state of HUNT_STATES) {
      const ids = state.sets.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const set of state.sets) {
        expect(set.id).toMatch(/^[a-z][a-z0-9]*$/);
        expect(set.label).toBeTruthy();
        expect(set.noun).toBeTruthy();
        expect(set.layer).toMatch(/^https:\/\/.+\/(FeatureServer|MapServer)\/\d+$/);
      }
    }
  });

  for (const state of HUNT_STATES) {
    for (const set of state.sets) {
      it(`${state.code} ${set.id}: its real example row maps to the stated unit and title`, () => {
        const [feature] = normalizeSet(set, [featureOf(set.example.attributes)]);
        expect(feature).toBeDefined();
        expect(feature.properties.unit).toBe(set.example.unit);
        expect(feature.properties.title).toBe(set.example.title);
        expect(feature.properties.set).toBe(set.id);
      });
    }
  }

  it('drops rows a state publishes that are not hunt units', () => {
    const skip = (code: string, setId: string, attributes: Record<string, any>) => {
      const set = HUNT_STATE_BY_CODE[code].sets.find((s) => s.id === setId)!;
      return normalizeSet(set, [featureOf(attributes)]);
    };
    expect(skip('MT', 'deerelk', { NAME: 'FLATHEAD INDIAN RESERVATION', HARVTYPE: 'Indian Reservation' })).toHaveLength(0);
    expect(skip('MT', 'sheep', { NAME: 'NOT A HUNTING DISTRICT', HARVTYPE: 'No Harvest Allowed for this Species' })).toHaveLength(0);
    expect(skip('NV', 'unit', { MANAGEUNIT: 0, HUNTUNIT: ' ', SYMBOL: 'Closed', CLOSED: 'Sheldon National Wildlife Refuge' })).toHaveLength(0);
    expect(skip('HI', 'unit', { unit_name: 'Safety Zone', status: 'Safety Zone (NO HUNTING)' })).toHaveLength(0);
  });

  it('turns Idaho IDFG anchors into plain links and names Yellowstone properly', () => {
    const set = HUNT_STATE_BY_CODE.ID.sets[0];
    const [unit] = normalizeSet(set, [
      featureOf({ NAME: '60A', Elk_Zone: 'Island Park', regular_deer_url: '<a href="https://idfg.idaho.gov/node/76956">Unit 60A</a>', elkZone_url_1: '<a href="https://idfg.idaho.gov/node/76849">x</a>' }),
    ]);
    expect(unit.properties).toMatchObject({
      note: 'Elk zone: Island Park',
      url: 'https://idfg.idaho.gov/node/76956',
      urlLabel: 'IDFG deer season page',
      url2: 'https://idfg.idaho.gov/node/76849',
      url2Label: 'IDFG elk zone page',
    });
    const [park] = normalizeSet(set, [featureOf({ NAME: 'YNP' })]);
    expect(park.properties.title).toBe('Yellowstone National Park');
  });

  it("doesn't simplify Oregon, whose data terms forbid altering boundaries", () => {
    expect(HUNT_STATE_BY_CODE.OR.fullResolution).toBe(true);
  });
});
