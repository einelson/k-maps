import type { CoverageRow } from '../data/types';
import { lonLatToCell } from './cells';
import { estimateDownload, jobLabel, placeLabel, planDownload, type DownloadJob } from './downloadPlan';

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
    expect(jobs.map((j) => `${j.kind}:${j.layer}:${j.cx}`)).toEqual([
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
});
