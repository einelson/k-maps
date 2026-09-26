import {
  BLM_AGENCY_COLORS,
  BLM_SMA_LEGEND,
  blmSmaDynamicLayers,
  LAND_MANAGER_LEGEND,
  LIVE_RASTERS,
  liveRasterTiles,
  RADAR_REFRESH_MS,
  refreshBucket,
  SLOPE_CLASSES,
  SLOPE_MIN_DEGREES,
  slopeRenderingRule,
  type LiveRasterId,
} from './liveOverlays';

const BBOX = '{bbox-epsg-3857}';
const IDS = Object.keys(LIVE_RASTERS) as LiveRasterId[];

/** Query-string params of a tile template (its `{...}` tokens are left as-is by URLSearchParams). */
const params = (template: string) => new URLSearchParams(template.slice(template.indexOf('?') + 1));

describe('live raster definitions', () => {
  it('every layer has a sane zoom range, 256px tiles and an attribution', () => {
    for (const id of IDS) {
      const def = LIVE_RASTERS[id];
      expect(def.id).toBe(id);
      expect(def.tileSize).toBe(256);
      expect(def.minzoom).toBeGreaterThanOrEqual(0);
      expect(def.maxzoom).toBeGreaterThan(def.minzoom);
      expect(def.attribution.length).toBeGreaterThan(3);
      expect(def.tiles).toMatch(/^https:\/\//);
    }
  });

  it('export-style layers ask MapLibre for each tile\'s Web Mercator box and ask for transparency', () => {
    for (const id of ['radar', 'wetlands', 'slopeAngle', 'blmSma'] as const) {
      const tiles = LIVE_RASTERS[id].tiles;
      expect(tiles).toContain(`bbox=${BBOX}`);
      const p = params(tiles);
      expect(p.get('bboxSR')).toBe('3857');
      expect(p.get('imageSR')).toBe('3857');
      expect(p.get('size')).toBe('256,256');
      expect(p.get('format')).toBe('png32'); // real alpha, not a palette + tRNS chunk
      expect(p.get('f')).toBe('image');
    }
    expect(params(LIVE_RASTERS.radar.tiles).get('transparent')).toBe('true');
    expect(params(LIVE_RASTERS.wetlands.tiles).get('transparent')).toBe('true');
    expect(params(LIVE_RASTERS.blmSma.tiles).get('transparent')).toBe('true');
  });

  it('cached-tile layers use the esri z/y/x order (not z/x/y)', () => {
    for (const id of ['nhd', 'landManager'] as const) {
      expect(LIVE_RASTERS[id].tiles).toMatch(/\/tile\/\{z\}\/\{y\}\/\{x\}$/);
    }
  });

  it('no template has a stray brace: MapLibre would leave it in the URL', () => {
    for (const id of IDS) {
      const stripped = LIVE_RASTERS[id].tiles.replace(BBOX, '').replace('{z}/{y}/{x}', '');
      expect(stripped).not.toMatch(/[{}]/);
    }
  });

  it('respects what each service can actually serve (probed limits)', () => {
    expect(LIVE_RASTERS.wetlands.minzoom).toBe(13); // draws nothing above 1:100,000
    expect(LIVE_RASTERS.landManager.maxzoom).toBe(14); // cached tiles 404 past z14
    expect(LIVE_RASTERS.nhd.maxzoom).toBe(16);
    expect(LIVE_RASTERS.blmSma.minzoom).toBe(14); // "LimitedScale": nothing is drawn above 1:36,118
    expect(LIVE_RASTERS.slopeAngle.minzoom).toBeGreaterThanOrEqual(12); // DEM is ~10 m; coarser slope is meaningless
  });

  it('only radar refreshes, every 5 minutes', () => {
    expect(LIVE_RASTERS.radar.refreshMs).toBe(RADAR_REFRESH_MS);
    expect(RADAR_REFRESH_MS).toBe(300_000);
    for (const id of IDS.filter((i) => i !== 'radar')) expect(LIVE_RASTERS[id].refreshMs).toBeUndefined();
  });
});

describe('refresh buckets', () => {
  it('stay constant within an interval and roll over at its boundary', () => {
    const start = 1_800_000_000_000 - (1_800_000_000_000 % RADAR_REFRESH_MS);
    expect(refreshBucket(start, RADAR_REFRESH_MS)).toBe(refreshBucket(start + RADAR_REFRESH_MS - 1, RADAR_REFRESH_MS));
    expect(refreshBucket(start + RADAR_REFRESH_MS, RADAR_REFRESH_MS)).toBe(refreshBucket(start, RADAR_REFRESH_MS) + 1);
  });

  it('radar tile URLs carry the bucket as a cache-buster; static layers are unchanged', () => {
    const now = 1_800_000_000_000;
    const [a] = liveRasterTiles(LIVE_RASTERS.radar, now);
    const [b] = liveRasterTiles(LIVE_RASTERS.radar, now + 1_000);
    const [c] = liveRasterTiles(LIVE_RASTERS.radar, now + RADAR_REFRESH_MS);
    expect(a).toContain(`_t=${refreshBucket(now, RADAR_REFRESH_MS)}`);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain(BBOX); // the token survives for MapLibre to fill in
    expect(liveRasterTiles(LIVE_RASTERS.nhd, now)).toEqual([LIVE_RASTERS.nhd.tiles]);
  });
});

describe('slope angle', () => {
  it('classes are contiguous, ascending, and start at the transparent cutoff', () => {
    expect(SLOPE_CLASSES[0].min).toBe(SLOPE_MIN_DEGREES);
    for (let i = 1; i < SLOPE_CLASSES.length; i++) expect(SLOPE_CLASSES[i].min).toBe(SLOPE_CLASSES[i - 1].max);
    expect(SLOPE_CLASSES[SLOPE_CLASSES.length - 1].max).toBe(90);
  });

  it('covers the 30-45° avalanche band with warm colors', () => {
    const at = (deg: number) => SLOPE_CLASSES.find((c) => deg >= c.min && deg < c.max)!;
    expect(at(29).label).toMatch(/27-30/);
    expect(at(30).min).toBe(30);
    expect(at(44).max).toBe(45);
    expect(at(10)).toBeUndefined(); // gentle terrain is not shaded at all
  });

  it('the rendering rule is a Slope -> Remap -> Colormap chain that a legend can be checked against', () => {
    const rule = slopeRenderingRule();
    expect(rule.rasterFunction).toBe('Colormap');
    const remap = rule.rasterFunctionArguments.Raster;
    expect(remap.rasterFunction).toBe('Remap');
    expect(remap.rasterFunctionArguments.Raster).toEqual({ rasterFunction: 'Slope Degrees' });
    // Below the first class is NoData -> fully transparent. (An RGBA colormap row does NOT give alpha: rows are [value, r, g, b].)
    expect(remap.rasterFunctionArguments.NoDataRanges).toEqual([0, SLOPE_MIN_DEGREES]);
    expect(remap.rasterFunctionArguments.InputRanges).toEqual(SLOPE_CLASSES.flatMap((c) => [c.min, c.max]));
    const ids = remap.rasterFunctionArguments.OutputValues;
    expect(ids).toEqual(SLOPE_CLASSES.map((_, i) => i + 1));
    expect(rule.rasterFunctionArguments.Colormap.map((row) => row[0])).toEqual(ids);
    for (const row of rule.rasterFunctionArguments.Colormap) expect(row).toHaveLength(4);
    SLOPE_CLASSES.forEach((c, i) => {
      const [, r, g, b] = rule.rasterFunctionArguments.Colormap[i];
      expect(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`).toBe(c.color);
    });
  });

  it('is embedded (URL-encoded) in the tile template and round-trips', () => {
    const tiles = LIVE_RASTERS.slopeAngle.tiles;
    const encoded = params(tiles).get('renderingRule')!;
    expect(JSON.parse(encoded)).toEqual(slopeRenderingRule());
    expect(tiles).not.toContain('"'); // percent-encoded, so nothing MapLibre or a URL parser can mangle
  });
});

describe('land manager legend', () => {
  it('has hex colors and unique labels, with the big agencies first', () => {
    for (const entry of LAND_MANAGER_LEGEND) expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(LAND_MANAGER_LEGEND.map((e) => e.label)).size).toBe(LAND_MANAGER_LEGEND.length);
    expect(LAND_MANAGER_LEGEND.slice(0, 2).map((e) => e.label)).toEqual(['BLM', 'US Forest Service']);
  });
});

describe('BLM cross-check overlay', () => {
  it('is drawn by the national service, not a bundled clip of one region', () => {
    expect(LIVE_RASTERS.blmSma.tiles).toMatch(/^https:\/\/gis\.blm\.gov\/.*\/BLM_Natl_SMA_LimitedScale\/MapServer\/export\?/);
  });

  it('re-symbolizes the FEATURES-group layer by agency code, 40% tint and no outline', () => {
    const [layer] = blmSmaDynamicLayers();
    expect(layer.source).toEqual({ type: 'mapLayer', mapLayerId: layer.id });
    expect(layer.id).toBe(31); // layer 16 (the IDENTIFY copy) exports blank
    const { renderer } = layer.drawingInfo;
    expect(renderer.field1).toBe('ADMIN_AGENCY_CODE');
    expect(renderer.uniqueValueInfos.map((i) => i.value)).toEqual(['PVT', 'UND']);
    expect(renderer.uniqueValueInfos[0].symbol.color).toEqual([156, 163, 175, 102]);
    expect(renderer.defaultSymbol.color).toEqual([168, 85, 247, 102]); // codes we don't know count as undetermined
    for (const { symbol } of renderer.uniqueValueInfos) expect(symbol.outline.style).toBe('esriSLSNull');
  });

  it('is embedded (URL-encoded) in the tile template and round-trips', () => {
    const tiles = LIVE_RASTERS.blmSma.tiles;
    expect(JSON.parse(params(tiles).get('dynamicLayers')!)).toEqual(blmSmaDynamicLayers());
    expect(tiles).not.toContain('"');
  });

  it('legend matches the colors it draws with', () => {
    expect(BLM_SMA_LEGEND).toEqual([
      { color: BLM_AGENCY_COLORS.PVT, label: 'Private' },
      { color: BLM_AGENCY_COLORS.UND, label: 'Undetermined' },
    ]);
    for (const entry of BLM_SMA_LEGEND) expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
