import {
  BASE_MAP_TILE_URLS,
  OSM_ATTRIBUTION,
  USGS_ATTRIBUTION,
  USGS_IMAGERY_TILE_URL,
  USGS_IMAGERY_TOPO_TILE_URL,
  USGS_MAX_NATIVE_ZOOM,
  USGS_SHADED_RELIEF_MAX_ZOOM,
  USGS_SHADED_RELIEF_TILE_URL,
  USGS_TILE_SIZE,
  USGS_TOPO_TILE_URL,
} from './usgsSources';

const ALL_URLS = {
  topo: USGS_TOPO_TILE_URL,
  imagery: USGS_IMAGERY_TILE_URL,
  hybrid: USGS_IMAGERY_TOPO_TILE_URL,
  shadedRelief: USGS_SHADED_RELIEF_TILE_URL,
};

describe('USGS tile URL templates', () => {
  it.each(Object.entries(ALL_URLS))('%s is an https URL on the USGS National Map host', (_name, url) => {
    expect(url.startsWith('https://basemap.nationalmap.gov/arcgis/rest/services/')).toBe(true);
  });

  it.each(Object.entries(ALL_URLS))(
    '%s uses the Esri MapServer z/y/x order (not the XYZ z/x/y order)',
    (_name, url) => {
      expect(url.endsWith('/MapServer/tile/{z}/{y}/{x}')).toBe(true);
      expect(url.indexOf('{y}')).toBeLessThan(url.indexOf('{x}'));
    }
  );

  it.each(Object.entries(ALL_URLS))('%s contains each placeholder exactly once', (_name, url) => {
    for (const token of ['{z}', '{y}', '{x}']) {
      expect(url.split(token)).toHaveLength(2);
    }
  });

  it('points each layer at its own service', () => {
    expect(USGS_TOPO_TILE_URL).toContain('/USGSTopo/');
    expect(USGS_IMAGERY_TILE_URL).toContain('/USGSImageryOnly/');
    expect(USGS_IMAGERY_TOPO_TILE_URL).toContain('/USGSImageryTopo/');
    expect(USGS_SHADED_RELIEF_TILE_URL).toContain('/USGSShadedReliefOnly/');
    expect(new Set(Object.values(ALL_URLS)).size).toBe(4);
  });

  it('never references a source whose licence forbids offline caching (spec §2)', () => {
    const forbidden = [
      'google',
      'bing',
      'virtualearth',
      'arcgisonline.com', // Esri World Imagery
      'tile.openstreetmap.org',
    ];
    for (const url of Object.values(ALL_URLS)) {
      for (const host of forbidden) {
        expect(url.toLowerCase()).not.toContain(host);
      }
    }
  });
});

describe('BASE_MAP_TILE_URLS', () => {
  it('has exactly the three base map modes', () => {
    expect(Object.keys(BASE_MAP_TILE_URLS).sort()).toEqual(['hybrid', 'satellite', 'topo']);
  });

  it('maps each mode to the matching service', () => {
    expect(BASE_MAP_TILE_URLS.topo).toBe(USGS_TOPO_TILE_URL);
    expect(BASE_MAP_TILE_URLS.satellite).toBe(USGS_IMAGERY_TILE_URL);
    expect(BASE_MAP_TILE_URLS.hybrid).toBe(USGS_IMAGERY_TOPO_TILE_URL);
  });
});

describe('USGS constants', () => {
  it('uses 256px tiles (MapLibre defaults to 512, which renders blurry)', () => {
    expect(USGS_TILE_SIZE).toBe(256);
  });

  it('caps native zoom at z16 for base maps and z13 for shaded relief', () => {
    expect(USGS_MAX_NATIVE_ZOOM).toBe(16);
    expect(USGS_SHADED_RELIEF_MAX_ZOOM).toBe(13);
    expect(USGS_SHADED_RELIEF_MAX_ZOOM).toBeLessThan(USGS_MAX_NATIVE_ZOOM);
  });

  it('carries attribution strings', () => {
    expect(USGS_ATTRIBUTION).toContain('USGS');
    expect(OSM_ATTRIBUTION).toContain('OpenStreetMap');
  });
});
