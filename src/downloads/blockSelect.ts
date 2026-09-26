/**
 * Picking download areas on the map. An area is one z10 cell (~30 km across), which is the right size for a
 * hike but hopeless for a state: selecting Idaho tap by tap is 300+ taps. So the bigger the view is zoomed
 * out, the bigger the block a tap selects — always roughly the same size on screen (a finger-sized square),
 * never smaller than a cell.
 *
 * Blocks are aligned to a grid (a block of 2^k cells is exactly the z(10-k) map tile), so blocks tile
 * perfectly, tapping the same place twice hits the same block, and zooming changes the block size without
 * ever leaving a sliver between neighbours.
 *
 * Pure (no React, no native modules) so it is unit-testable.
 */

import type { Feature, FeatureCollection, LineString } from 'geojson';

import { CELL_ZOOM, cellBounds, cellRangeInBounds, cellsInBounds } from './cells';

export interface Cell {
  cx: number;
  cy: number;
}

/** Blocks reach 16 x 16 cells (about 300 mi across); beyond that the selection cap would refuse them anyway. */
export const MAX_BLOCK_EXPONENT = 4;

/**
 * The most areas one download can hold. Idaho is 329 cells; this leaves room for a big Western state and stops
 * a stray tap at the lowest zoom from queueing tens of thousands of cells.
 */
export const MAX_SELECTED_CELLS = 500;

const WORLD_CELLS = 1 << CELL_ZOOM;

/**
 * How wide a block should look on screen, in dp: a comfortable finger target that still leaves several on a phone
 * screen. (One z10 cell is 512 * 2^(zoom - 10) dp wide, at any latitude — it is a Web Mercator tile.)
 */
export const TARGET_BLOCK_DP = 96;

/**
 * Cells per block side for a map zoom: whichever power of two makes a block look closest to TARGET_BLOCK_DP,
 * never smaller than a cell. So single squares are pickable from about zoom 7 (a square is ~70 dp there — this used
 * to be zoom 9.5, where one square is as wide as the whole phone), and the block doubles every zoom level out.
 */
export function blockSizeForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  const cellDp = 512 * 2 ** (zoom - CELL_ZOOM);
  const exponent = Math.round(Math.log2(TARGET_BLOCK_DP / cellDp));
  return 1 << Math.min(MAX_BLOCK_EXPONENT, Math.max(0, exponent));
}

const keyOf = (cx: number, cy: number) => `${cx}:${cy}`;

/** The block (of `size` cells a side) that contains a cell, as block-grid coordinates. */
export function blockOf(cell: Cell, size: number): { bx: number; by: number } {
  return { bx: Math.floor(cell.cx / size), by: Math.floor(cell.cy / size) };
}

/** Every cell in a block, row by row from its north-west corner. */
export function cellsInBlock(bx: number, by: number, size: number): Cell[] {
  const cells: Cell[] = [];
  for (let cy = by * size; cy < (by + 1) * size && cy < WORLD_CELLS; cy++) {
    for (let cx = bx * size; cx < (bx + 1) * size && cx < WORLD_CELLS; cx++) cells.push({ cx, cy });
  }
  return cells;
}

/** `[west, south, east, north]` of a block — for drawing the grid the taps will land on. */
export function blockBounds(bx: number, by: number, size: number): [number, number, number, number] {
  const [west, , , north] = cellBounds(bx * size, by * size);
  const [, south, east] = cellBounds(
    Math.min(WORLD_CELLS - 1, (bx + 1) * size - 1),
    Math.min(WORLD_CELLS - 1, (by + 1) * size - 1)
  );
  return [west, south, east, north];
}

/**
 * Block-grid range that covers a `[west, south, east, north]` view, plus one block of margin so panning shows no gap.
 * Worked out from the view's corners: zoomed all the way out the view holds a million cells, far too many to list.
 */
export function blockRangeInBounds(
  bounds: [number, number, number, number],
  size: number
): { bxMin: number; bxMax: number; byMin: number; byMax: number } {
  const { cxMin, cxMax, cyMin, cyMax } = cellRangeInBounds(bounds);
  const last = WORLD_CELLS / size - 1;
  return {
    bxMin: Math.max(0, Math.floor(cxMin / size) - 1),
    bxMax: Math.min(last, Math.floor(cxMax / size) + 1),
    byMin: Math.max(0, Math.floor(cyMin / size) - 1),
    byMax: Math.min(last, Math.floor(cyMax / size) + 1),
  };
}

export type SelectionChange =
  | { kind: 'changed'; cells: Cell[]; added: number; removed: number }
  /** The result would exceed the cap; `cells` is the selection unchanged. */
  | { kind: 'too-many'; cells: Cell[]; wouldBe: number }
  /** Nothing in the block / view is eligible (no US land); `cells` is the selection unchanged. */
  | { kind: 'no-land'; cells: Cell[] };

/** Adds `additions` to `selected` unless that would go past `max`. Cells already selected are not counted twice. */
function addCells(selected: readonly Cell[], additions: readonly Cell[], max: number): SelectionChange {
  const have = new Set(selected.map((c) => keyOf(c.cx, c.cy)));
  const fresh = additions.filter((c) => !have.has(keyOf(c.cx, c.cy)));
  if (selected.length + fresh.length > max) {
    return { kind: 'too-many', cells: [...selected], wouldBe: selected.length + fresh.length };
  }
  return { kind: 'changed', cells: [...selected, ...fresh], added: fresh.length, removed: 0 };
}

/** Which cells may be picked at all (the app only deals in US land, so the picker passes "holds US land"). */
export type CellFilter = (cell: Cell) => boolean;

/**
 * A tap on `tap` with blocks of `size`: selects the whole block, or — if every cell of it is already selected —
 * deselects it. A block that is partly selected is completed rather than cleared. Cells `eligible` rejects are
 * left out of the block, so a block over a coast picks just its land; a block with nothing eligible changes nothing.
 */
export function toggleBlock(
  selected: readonly Cell[],
  tap: Cell,
  size: number,
  max: number = MAX_SELECTED_CELLS,
  eligible?: CellFilter
): SelectionChange {
  const { bx, by } = blockOf(tap, size);
  const block = eligible ? cellsInBlock(bx, by, size).filter(eligible) : cellsInBlock(bx, by, size);
  if (block.length === 0) return { kind: 'no-land', cells: [...selected] };
  const blockKeys = new Set(block.map((c) => keyOf(c.cx, c.cy)));
  const have = new Set(selected.map((c) => keyOf(c.cx, c.cy)));
  if (block.every((c) => have.has(keyOf(c.cx, c.cy)))) {
    const kept = selected.filter((c) => !blockKeys.has(keyOf(c.cx, c.cy)));
    return { kind: 'changed', cells: kept, added: 0, removed: selected.length - kept.length };
  }
  return addCells(selected, block, max);
}

/** How much of the block under `tap` is already selected — what a "pick this block" button says it will do. */
export function blockPickState(
  selected: readonly Cell[],
  tap: Cell,
  size: number,
  eligible?: CellFilter
): { total: number; picked: number } {
  const { bx, by } = blockOf(tap, size);
  const block = eligible ? cellsInBlock(bx, by, size).filter(eligible) : cellsInBlock(bx, by, size);
  const have = new Set(selected.map((c) => keyOf(c.cx, c.cy)));
  return { total: block.length, picked: block.filter((c) => have.has(keyOf(c.cx, c.cy))).length };
}

/** A view of more cells than this isn't listed to be filtered — the whole US is only ~15,000 cells. */
const MAX_LISTED_VIEW = 40_000;

/**
 * Adds every cell the view touches that `eligible` allows ("Select what's in view"), unless that goes past `max`.
 * Counts the view from its corners first, so a view of the whole map is refused without listing its million cells.
 */
export function selectCellsInView(
  selected: readonly Cell[],
  bounds: [number, number, number, number],
  max: number = MAX_SELECTED_CELLS,
  eligible?: CellFilter
): SelectionChange {
  const { cxMin, cxMax, cyMin, cyMax } = cellRangeInBounds(bounds);
  const inView = (cxMax - cxMin + 1) * (cyMax - cyMin + 1);
  // Without a filter every cell in view counts, so the corners already decide; with one, count what passes.
  if (inView > (eligible ? MAX_LISTED_VIEW : max)) return { kind: 'too-many', cells: [...selected], wouldBe: inView };
  const cells = eligible ? cellsInBounds(bounds).filter(eligible) : cellsInBounds(bounds);
  if (cells.length === 0) return { kind: 'no-land', cells: [...selected] };
  return addCells(selected, cells, max);
}

/** Rough area of a cell in km² (a cell is a Web Mercator tile, so it shrinks toward the poles). */
export function cellAreaKm2({ cx, cy }: Cell): number {
  const [west, south, east, north] = cellBounds(cx, cy);
  const midLat = (south + north) / 2;
  const widthKm = (east - west) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const heightKm = (north - south) * 110.57;
  return widthKm * heightKm;
}

/** Total rough area of a selection, km². */
export function selectionAreaKm2(cells: readonly Cell[]): number {
  return cells.reduce((sum, cell) => sum + cellAreaKm2(cell), 0);
}

/** Centre of a cell as `[lon, lat]`. */
export function cellCenter({ cx, cy }: Cell): [number, number] {
  const [west, south, east, north] = cellBounds(cx, cy);
  return [(west + east) / 2, (south + north) / 2];
}

/** The block grid over a range of blocks, as GeoJSON lines: one meridian per block edge and one parallel per block edge. */
export function blockGridLines(
  range: { bxMin: number; bxMax: number; byMin: number; byMax: number },
  size: number
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  if (range.bxMax < range.bxMin || range.byMax < range.byMin) return { type: 'FeatureCollection', features };
  const [west, south, east, north] = [
    blockBounds(range.bxMin, range.byMin, size)[0],
    blockBounds(range.bxMax, range.byMax, size)[1],
    blockBounds(range.bxMax, range.byMax, size)[2],
    blockBounds(range.bxMin, range.byMin, size)[3],
  ];
  const line = (coordinates: [number, number][]): Feature<LineString> => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  });
  for (let bx = range.bxMin; bx <= range.bxMax + 1; bx++) {
    const lon = bx > range.bxMax ? east : blockBounds(bx, range.byMin, size)[0];
    features.push(
      line([
        [lon, north],
        [lon, south],
      ])
    );
  }
  for (let by = range.byMin; by <= range.byMax + 1; by++) {
    const lat = by > range.byMax ? south : blockBounds(range.bxMin, by, size)[3];
    features.push(
      line([
        [west, lat],
        [east, lat],
      ])
    );
  }
  return { type: 'FeatureCollection', features };
}
