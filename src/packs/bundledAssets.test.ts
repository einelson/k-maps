/** Guards the regenerated bundled starter data (tools/build_starter_pack.mjs) against the pack contract. */
import { segmentOnBoundary } from './clip.ts';
import { mvumVehicleClass } from './mvumClass.ts';
import { bundledBounds, BUNDLED_CELL_RECT } from './region.ts';

const land = require('../../assets/land/public-land.json');
const landMeta = require('../../assets/land/public-land.meta.json');
const mvum = require('../../assets/mvum/mvum.json');
const mvumMeta = require('../../assets/mvum/mvum.meta.json');
const boats = require('../../assets/poi/boat-launches.json');
const camps = require('../../assets/poi/campsites-trails.json');

const BOUNDS = bundledBounds();

describe('bundled starter assets', () => {
  it('meta describes the cell-aligned region', () => {
    expect(landMeta.bbox).toEqual(BOUNDS);
    expect(mvumMeta.bbox).toEqual(BOUNDS);
    expect(landMeta.cellRect).toEqual(BUNDLED_CELL_RECT);
    expect(landMeta.pubAccessVintage).toContain('PAD-US');
    expect(typeof landMeta.fetchedAt).toBe('string');
    expect(landMeta.agencies).toHaveLength(6);
  });

  it('land has public / outline / private kinds matching the meta counts', () => {
    const counts: Record<string, number> = {};
    for (const f of land.features) counts[f.properties.kind] = (counts[f.properties.kind] ?? 0) + 1;
    expect(counts).toEqual(landMeta.kinds);
    expect(counts.public).toBe(landMeta.featureCount);
    expect(counts.public).toBeGreaterThan(100);
    expect(counts.outline).toBeGreaterThan(0);
    expect(counts.private).toBeGreaterThan(0);
    for (const f of land.features) {
      if (f.properties.kind === 'public') {
        expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
        expect(f.properties).toHaveProperty('Pub_Access');
        expect(f.properties.source_layer).toMatch(/^PADUS/);
      } else if (f.properties.kind === 'outline') {
        expect(['LineString', 'MultiLineString']).toContain(f.geometry.type);
        expect(f.properties.Pub_Access).toBeDefined();
      } else {
        expect(f.geometry.type).toBe('Polygon');
      }
    }
  });

  it('no outline segment lies on the region boundary', () => {
    for (const f of land.features.filter((x: any) => x.properties.kind === 'outline')) {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of lines) {
        for (let i = 0; i < line.length - 1; i++) {
          expect(segmentOnBoundary(line[i], line[i + 1], BOUNDS)).toBe(false);
        }
      }
    }
  });

  it('mvum features carry a consistent vehicleClass and kind', () => {
    expect(mvum.features.length).toBe(mvumMeta.featureCount);
    for (const f of mvum.features) {
      expect(['road', 'trail']).toContain(f.properties.kind);
      expect(f.properties.vehicleClass).toBe(mvumVehicleClass(f.properties));
    }
  });

  it('poi pins use camelCase categories', () => {
    expect(boats.features.length).toBeGreaterThan(0);
    expect(camps.features.length).toBeGreaterThan(0);
    for (const f of boats.features) {
      expect(f.geometry.type).toBe('Point');
      expect(f.properties.category).toBe('boatLaunches');
      expect(typeof f.properties.osm_id).toBe('number');
    }
    for (const f of camps.features) expect(f.properties.category).toBe('campsitesTrails');
  });
});
