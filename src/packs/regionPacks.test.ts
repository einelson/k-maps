import {
  cellEntryName,
  parseCellEntryName,
  parseRegionManifest,
  REGION_PACK_FORMAT,
  regionPackUrl,
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

  it('refuses an older format, a missing format, and non-objects', () => {
    expect(() => parseRegionManifest({ ...validManifest(), format: REGION_PACK_FORMAT - 1 })).toThrow(/out of date/);
    expect(() => parseRegionManifest({ regions: [] })).toThrow(/format/);
    expect(() => parseRegionManifest(null)).toThrow(/not valid/);
    expect(() => parseRegionManifest([])).toThrow(/not valid/);
    expect(() => parseRegionManifest({ format: REGION_PACK_FORMAT })).toThrow(/no regions/);
  });

  it('rejects unknown layers (osm is never a region pack)', () => {
    for (const layer of ['osm', 'poi', 'bogus']) {
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
    expect(pack).toMatchObject({ state: 'OR', name: 'Oregon', file: 'hunt-or.zip', unitCount: 69, bbox: [-124.6, 41.9, -116.4, 46.3] });
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
    expect(() => parseRegionManifest({ format: REGION_PACK_FORMAT, regions: [], huntUnits: 'nope' })).toThrow(/bad hunting-unit list/);
  });
});
