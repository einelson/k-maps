import {
  cellEntryName,
  layerPacks,
  packFileCells,
  parseCellEntryName,
  parseRegionManifest,
  REGION_PACK_FORMAT,
  REGION_PACK_MIN_FORMAT,
  regionPackUrl,
  type RegionEntry,
} from './regionPacks.ts';

const validManifest = () => ({
  format: REGION_PACK_FORMAT,
  regions: [
    {
      id: 'idaho',
      name: 'Idaho',
      cells: [
        [179, 351],
        [180, 351],
      ],
      packs: [{ layer: 'land', file: 'idaho-land.zip', bytes: 1234, version: '2026-09-25T00:00:00.000Z' }],
    },
  ],
});

describe('parseRegionManifest', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = parseRegionManifest(validManifest());
    expect(manifest.regions[0].id).toBe('idaho');
    expect(manifest.regions[0].cells).toEqual([
      [179, 351],
      [180, 351],
    ]);
    expect(manifest.regions[0].packs[0]).toMatchObject({ layer: 'land', file: 'idaho-land.zip', bytes: 1234 });
  });

  it('accepts a region with no packs yet', () => {
    const m = validManifest();
    m.regions[0].packs = [];
    expect(parseRegionManifest(m).regions[0].packs).toEqual([]);
  });

  it('refuses a manifest from a newer format, telling the user to update the app', () => {
    expect(() => parseRegionManifest({ ...validManifest(), format: REGION_PACK_FORMAT + 1 })).toThrow(/update the app/);
  });

  it('still reads the previous format, which only lacked parts and the OSM / POI layers', () => {
    expect(REGION_PACK_MIN_FORMAT).toBe(1);
    expect(parseRegionManifest({ ...validManifest(), format: 1 }).regions[0].id).toBe('idaho');
  });

  it('refuses a format older than that, a missing format, and non-objects', () => {
    expect(() => parseRegionManifest({ ...validManifest(), format: REGION_PACK_MIN_FORMAT - 1 })).toThrow(
      /out of date/
    );
    expect(() => parseRegionManifest({ regions: [] })).toThrow(/format/);
    expect(() => parseRegionManifest(null)).toThrow(/not valid/);
    expect(() => parseRegionManifest([])).toThrow(/not valid/);
    expect(() => parseRegionManifest({ format: REGION_PACK_FORMAT })).toThrow(/no regions/);
  });

  it('accepts every layer a state can have: land, MVUM, trails, POI pins and OSM roads', () => {
    for (const layer of ['land', 'mvum', 'trails', 'poi', 'osm']) {
      const m = validManifest();
      m.regions[0].packs[0].layer = layer;
      expect(parseRegionManifest(m).regions[0].packs[0].layer).toBe(layer);
    }
  });

  it('rejects unknown layers', () => {
    for (const layer of ['bogus', 'topo', 'Land', '']) {
      const m = validManifest();
      m.regions[0].packs[0].layer = layer;
      expect(() => parseRegionManifest(m)).toThrow(/unknown layer/);
    }
  });

  it('rejects file names that could escape the pack folder', () => {
    for (const file of ['../evil.zip', 'a/b.zip', 'a\\b.zip', '', '..']) {
      const m = validManifest();
      m.regions[0].packs[0].file = file;
      expect(() => parseRegionManifest(m)).toThrow(/bad file name/);
    }
  });

  it('rejects malformed cells and sizes', () => {
    for (const bad of [[[1]], [[1, -2]], [[1.5, 2]], [['1', 2]], ['x'], [[1, 2, 3]]]) {
      const m: any = validManifest();
      m.regions[0].cells = bad;
      expect(() => parseRegionManifest(m)).toThrow(/expected \[cx, cy\]/);
    }
    const m: any = validManifest();
    m.regions[0].packs[0].bytes = -1;
    expect(() => parseRegionManifest(m)).toThrow(/bad size/);
    m.regions[0].packs[0].bytes = 10;
    m.regions[0].packs[0].version = '';
    expect(() => parseRegionManifest(m)).toThrow(/missing version/);
  });
});

describe('regionPackUrl', () => {
  it('resolves the zip next to the manifest', () => {
    expect(
      regionPackUrl('https://github.com/einelson/k-maps/releases/download/data/manifest.json', 'idaho-land.zip')
    ).toBe('https://github.com/einelson/k-maps/releases/download/data/idaho-land.zip');
  });

  it('refuses a file name with a path in it', () => {
    expect(() => regionPackUrl('https://x.test/a/manifest.json', '../b.zip')).toThrow(/Bad pack file name/);
  });
});

describe('cell entry names', () => {
  it('round-trips and ignores anything that is not a cell file', () => {
    expect(cellEntryName(181, 373)).toBe('181_373.json');
    expect(parseCellEntryName('181_373.json')).toEqual({ cx: 181, cy: 373 });
    for (const name of ['manifest.json', '181_373.json.bak', 'a/181_373.json', '181_.json', '__MACOSX/', '']) {
      expect(parseCellEntryName(name)).toBeNull();
    }
  });
});

describe('parseRegionManifest: hunting units', () => {
  const huntPack = () => ({
    state: 'OR',
    name: 'Oregon',
    agency: 'Oregon Department of Fish and Wildlife',
    regsUrl: 'https://myodfw.com/big-game-hunting',
    vintage: 'Current wildlife management units',
    file: 'hunt-or.zip',
    bytes: 250000,
    version: '2026-09-25T00:00:00.000Z',
    bbox: [-124.6, 41.9, -116.4, 46.3],
    unitCount: 69,
    sets: [{ id: 'wmu', label: 'Wildlife Management Units', count: 69 }],
  });
  const withHunt = (pack: unknown = huntPack()) => ({
    format: REGION_PACK_FORMAT,
    regions: [],
    huntUnits: [pack],
  });

  it('accepts a manifest published before hunting units existed (no huntUnits key) as having none', () => {
    const manifest = parseRegionManifest({ format: REGION_PACK_FORMAT, regions: [] });
    expect(manifest.huntUnits).toEqual([]);
  });

  it('parses a well-formed hunting-unit pack', () => {
    const [pack] = parseRegionManifest(withHunt()).huntUnits;
    expect(pack).toMatchObject({
      state: 'OR',
      name: 'Oregon',
      file: 'hunt-or.zip',
      unitCount: 69,
      bbox: [-124.6, 41.9, -116.4, 46.3],
    });
    expect(pack.sets).toEqual([{ id: 'wmu', label: 'Wildlife Management Units', count: 69 }]);
  });

  it('rejects a bad state code, link, file name, size, box, or set list', () => {
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ['lowercase code', { state: 'or' }, /bad state code/],
      ['three letters', { state: 'ORE' }, /bad state code/],
      ['non-https regs link', { regsUrl: 'javascript:alert(1)' }, /bad regulations link/],
      ['path in file name', { file: '../hunt-or.zip' }, /bad file name/],
      ['negative size', { bytes: -1 }, /bad size/],
      ['inverted box', { bbox: [-116, 46, -124, 42] }, /bad bounding box/],
      ['short box', { bbox: [-124, 42, -116] }, /bad bounding box/],
      ['no sets', { sets: [] }, /at least one set/],
      ['malformed set', { sets: [{ id: 'wmu' }] }, /expected \{id, label, count\}/],
      ['missing agency', { agency: '' }, /missing agency/],
    ];
    for (const [, override, message] of bad) {
      expect(() => parseRegionManifest(withHunt({ ...huntPack(), ...override }))).toThrow(message);
    }
  });

  it('rejects a huntUnits value that is not a list', () => {
    expect(() => parseRegionManifest({ format: REGION_PACK_FORMAT, regions: [], huntUnits: 'nope' })).toThrow(
      /bad hunting-unit list/
    );
  });
});

describe('multi-part packs', () => {
  const region: RegionEntry = {
    id: 'montana',
    name: 'Montana',
    cells: [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ],
    packs: [
      { layer: 'land', file: 'montana-land.zip', bytes: 100, version: 'v1' },
      {
        layer: 'osm',
        file: 'montana-osm-1.zip',
        bytes: 40,
        version: 'v2',
        cells: [
          [1, 1],
          [2, 1],
        ],
      },
      {
        layer: 'osm',
        file: 'montana-osm-2.zip',
        bytes: 30,
        version: 'v2',
        cells: [
          [3, 1],
          [4, 1],
        ],
      },
    ],
  };

  it('parses the cell list of a part', () => {
    const parsed = parseRegionManifest({ format: REGION_PACK_FORMAT, regions: [region] });
    expect(parsed.regions[0].packs[1].cells).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(parsed.regions[0].packs[0].cells).toBeUndefined();
  });

  it('rejects a bad cell list on a part', () => {
    const bad = { ...region, packs: [{ ...region.packs[1], cells: [[1]] }] };
    expect(() => parseRegionManifest({ format: REGION_PACK_FORMAT, regions: [bad] })).toThrow(/expected \[cx, cy\]/);
    const notAList = { ...region, packs: [{ ...region.packs[1], cells: 'all' }] };
    expect(() => parseRegionManifest({ format: REGION_PACK_FORMAT, regions: [notAList] })).toThrow(
      /cells must be a list/
    );
  });

  it("a part holds its own cells; a whole-layer file holds the region's", () => {
    expect(packFileCells(region, region.packs[1])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(packFileCells(region, region.packs[0])).toBe(region.cells);
  });

  it('groups files by layer, adding up the size of every part and keeping the shared build', () => {
    const groups = layerPacks(region);
    expect(groups.map((g) => g.layer)).toEqual(['land', 'osm']);
    expect(groups[0]).toMatchObject({ bytes: 100, version: 'v1' });
    expect(groups[0].files).toHaveLength(1);
    expect(groups[1]).toMatchObject({ bytes: 70, version: 'v2' });
    expect(groups[1].files.map((f) => f.file)).toEqual(['montana-osm-1.zip', 'montana-osm-2.zip']);
  });

  it('a region with no packs has no layers', () => {
    expect(layerPacks({ ...region, packs: [] })).toEqual([]);
  });
});
