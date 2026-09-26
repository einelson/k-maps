import type { CoverageRow } from '../data/types';
import { BUNDLED_CELL_RECT } from '../packs/region';
import type { RegionEntry, RegionPackFile } from '../packs/regionPacks';
import { lonLatToCell } from './cells';
import { estimateDownload, jobLabel, placeLabel, planDownload, type DownloadJob } from './downloadPlan';

/** "pack:land:1" for an area job, "region:land:test" for a whole-state pack job. */
const tag = (job: DownloadJob) =>
  job.kind === 'region' ? `region:${job.layer}:${job.region.id}` : `${job.kind}:${job.layer}:${job.cx}`;

const row = (layer: string, cx: number, cy: number, status: CoverageRow['status'], maxZoom = 0): CoverageRow => ({
  layer,
  cell_x: cx,
  cell_y: cy,
  max_zoom: maxZoom,
  status,
  bytes: 1,
  updated_at: 0,
});

const cells = [
  { cx: 1, cy: 1 },
  { cx: 2, cy: 1 },
];

describe('planDownload', () => {
  it('plans every layer of every area, one area at a time with overlay data first', () => {
    const { jobs, skipped } = planDownload({
      cells,
      tileLayers: ['topo'],
      packLayers: ['land', 'mvum'],
      maxZoom: 14,
      coverage: [],
    });
    expect(skipped).toBe(0);
    expect(jobs.map(tag)).toEqual([
      'pack:land:1',
      'pack:mvum:1',
      'tiles:topo:1',
      'pack:land:2',
      'pack:mvum:2',
      'tiles:topo:2',
    ]);
  });

  it('leaves out overlay data that is already on the device', () => {
    const { jobs, skipped } = planDownload({
      cells,
      tileLayers: [],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: [row('land', 1, 1, 'complete')],
    });
    expect(jobs).toEqual([{ kind: 'pack', layer: 'land', cx: 2, cy: 1 }]);
    expect(skipped).toBe(1);
  });

  it('redoes anything partial, failed or in flight', () => {
    for (const status of ['partial', 'failed', 'downloading'] as const) {
      const { jobs } = planDownload({
        cells: [cells[0]],
        tileLayers: [],
        packLayers: ['land'],
        maxZoom: 14,
        coverage: [row('land', 1, 1, status)],
      });
      expect(jobs).toHaveLength(1);
    }
  });

  it('keeps map pictures that already reach the zoom asked for, and tops up ones that stop short', () => {
    const base = {
      cells: [cells[0]],
      tileLayers: ['topo' as const],
      packLayers: [],
      coverage: [row('topo', 1, 1, 'complete', 14)],
    };
    expect(planDownload({ ...base, maxZoom: 14 }).jobs).toEqual([]);
    expect(planDownload({ ...base, maxZoom: 13 }).jobs).toEqual([]);
    expect(planDownload({ ...base, maxZoom: 16 }).jobs).toHaveLength(1);
  });

  it('does not mix up layers or areas', () => {
    const { jobs } = planDownload({
      cells: [cells[0]],
      tileLayers: ['satellite'],
      packLayers: ['mvum'],
      maxZoom: 14,
      coverage: [row('topo', 1, 1, 'complete', 16), row('land', 1, 1, 'complete'), row('mvum', 9, 9, 'complete')],
    });
    expect(jobs).toHaveLength(2);
  });

  it('plans nothing for nothing chosen', () => {
    expect(planDownload({ cells, tileLayers: [], packLayers: [], maxZoom: 14, coverage: [] })).toEqual({
      jobs: [],
      skipped: 0,
    });
    expect(
      planDownload({ cells: [], tileLayers: ['topo'], packLayers: ['land'], maxZoom: 14, coverage: [] }).jobs
    ).toEqual([]);
  });
});

describe('planDownload with whole states', () => {
  const pack = (layer: RegionPackFile['layer'], file = `${layer}.zip`, bytes = 1000): RegionPackFile => ({
    layer,
    file,
    bytes,
    version: 'v1',
  });
  // Cells well away from the bundled starter region.
  const stateCells: [number, number][] = [
    [100, 100],
    [101, 100],
    [102, 100],
  ];
  const region = (packs: RegionPackFile[]): RegionEntry => ({ id: 'test', name: 'Test', cells: stateCells, packs });
  const wholeState = stateCells.map(([cx, cy]) => ({ cx, cy }));
  const doneRows = (layer: string) => stateCells.map(([cx, cy]) => row(layer, cx, cy, 'complete'));

  it('installs the ready-made pack for a layer instead of fetching every area', () => {
    const { jobs } = planDownload({
      cells: wholeState,
      tileLayers: [],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: [],
      regions: [region([pack('land')])],
    });
    expect(jobs.map(tag)).toEqual(['region:land:test']);
  });

  it('still fetches map pictures area by area, after the pack installs', () => {
    const { jobs } = planDownload({
      cells: wholeState,
      tileLayers: ['topo'],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: [],
      regions: [region([pack('land')])],
    });
    expect(jobs.map(tag)).toEqual(['region:land:test', 'tiles:topo:100', 'tiles:topo:101', 'tiles:topo:102']);
  });

  it('falls back to area-by-area for a layer the state has no pack for', () => {
    const { jobs } = planDownload({
      cells: [wholeState[0]],
      tileLayers: [],
      packLayers: ['land', 'osm'],
      maxZoom: 14,
      coverage: [],
      regions: [region([pack('land')])],
    });
    expect(jobs.map(tag)).toEqual(['region:land:test', 'pack:osm:100']);
  });

  it('leaves out a layer that is already complete for every area of the state', () => {
    const { jobs, skipped } = planDownload({
      cells: wholeState,
      tileLayers: [],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: doneRows('land'),
      regions: [region([pack('land')])],
    });
    expect(jobs).toEqual([]);
    expect(skipped).toBe(3);
  });

  it('installs the pack when only some areas are on the phone — quicker than fetching the rest', () => {
    const { jobs } = planDownload({
      cells: wholeState,
      tileLayers: [],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: doneRows('land').slice(0, 1),
      regions: [region([pack('land')])],
    });
    expect(jobs.map(tag)).toEqual(['region:land:test']);
  });

  it('treats the bundled starter area as already there', () => {
    const { cxMin, cyMin } = BUNDLED_CELL_RECT;
    const bundled: RegionEntry = { id: 'starter', name: 'Starter', cells: [[cxMin, cyMin]], packs: [pack('land')] };
    const { jobs, skipped } = planDownload({
      cells: [{ cx: cxMin, cy: cyMin }],
      tileLayers: [],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: [],
      regions: [bundled],
    });
    expect(jobs).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('keeps areas outside the whole states on the ordinary per-area path', () => {
    const { jobs } = planDownload({
      cells: [...wholeState, { cx: 1, cy: 1 }],
      tileLayers: [],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: [],
      regions: [region([pack('land')])],
    });
    expect(jobs.map(tag)).toEqual(['region:land:test', 'pack:land:1']);
  });

  it('groups a layer split into parts as one job', () => {
    const parts = [pack('osm', 'osm-1.zip', 40), pack('osm', 'osm-2.zip', 60)];
    const { jobs } = planDownload({
      cells: wholeState,
      tileLayers: [],
      packLayers: ['osm'],
      maxZoom: 14,
      coverage: [],
      regions: [region(parts)],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind === 'region' && jobs[0].packs.files.map((f) => f.file)).toEqual(['osm-1.zip', 'osm-2.zip']);
  });

  it('is unchanged when no ready-made packs are given', () => {
    const withNone = planDownload({
      cells: wholeState,
      tileLayers: [],
      packLayers: ['land'],
      maxZoom: 14,
      coverage: [],
    });
    expect(withNone.jobs).toHaveLength(3);
  });
});

describe('estimateDownload', () => {
  const pack = (layer: DownloadJob['layer']): DownloadJob => ({ kind: 'pack', layer, cx: 0, cy: 0 });
  const tiles = (layer: DownloadJob['layer']): DownloadJob => ({ kind: 'tiles', layer, cx: 0, cy: 0 });

  it('adds up overlay data by what each layer typically weighs and how long it takes', () => {
    const { bytes, packSeconds } = estimateDownload([pack('land'), pack('land'), pack('mvum')], 14);
    expect(bytes).toBe(300_000 * 2 + 500_000);
    expect(packSeconds).toBe(10 * 2 + 2);
  });

  it('sizes map pictures by zoom, satellite bigger than topo, and does not count them toward the time', () => {
    const topo = estimateDownload([tiles('topo')], 14);
    const sat = estimateDownload([tiles('satellite')], 14);
    expect(topo.bytes).toBe(6_000_000);
    expect(sat.bytes).toBe(10_000_000);
    expect(topo.packSeconds).toBe(0);
    expect(estimateDownload([tiles('topo')], 16).bytes).toBeGreaterThan(topo.bytes);
  });

  it('sizes a hybrid picture like topo, as the picker says', () => {
    expect(estimateDownload([tiles('hybrid')], 15).bytes).toBe(estimateDownload([tiles('topo')], 15).bytes);
  });

  it('counts nothing for a zoom it has no measurements for', () => {
    expect(estimateDownload([tiles('topo')], 12).bytes).toBe(0);
  });

  it('is zero for no jobs', () => {
    expect(estimateDownload([], 14)).toEqual({ bytes: 0, packSeconds: 0 });
  });

  it('sizes a ready-made pack by what it unzips to, and times it by download plus install', () => {
    const job: DownloadJob = {
      kind: 'region',
      layer: 'land',
      region: { id: 'test', name: 'Test', cells: [[1, 1]], packs: [] },
      packs: { layer: 'land', files: [], bytes: 3_000_000, version: 'v1' },
    };
    const { bytes, packSeconds } = estimateDownload([job], 14);
    expect(bytes).toBe(12_000_000);
    expect(packSeconds).toBeCloseTo(3_000_000 / 1_500_000 + 0.05);
  });
});

describe('labels', () => {
  it('names a place by its coordinates, with hemispheres', () => {
    expect(placeLabel(lonLatToCell(-116.2, 43.6))).toMatch(/^43\.\d°N 116\.\d°W$/);
    expect(placeLabel(lonLatToCell(151.2, -33.9))).toMatch(/^33\.\d°S 151\.\d°E$/);
  });

  it('names a job by its layer and place', () => {
    const { cx, cy } = lonLatToCell(-116.2, 43.6);
    expect(jobLabel({ kind: 'pack', layer: 'land', cx, cy })).toMatch(
      /^Public land \+ private shading · 43\.\d°N 116\.\d°W$/
    );
    expect(jobLabel({ kind: 'tiles', layer: 'topo', cx, cy })).toMatch(/^Topo · /);
  });

  it('names a whole-state pack by its state', () => {
    expect(
      jobLabel({
        kind: 'region',
        layer: 'mvum',
        region: { id: 'idaho', name: 'Idaho', cells: [], packs: [] },
        packs: { layer: 'mvum', files: [], bytes: 0, version: 'v1' },
      })
    ).toBe('Forest roads (MVUM) · all of Idaho');
  });
});
