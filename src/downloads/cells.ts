/**
 * Download cells are XYZ zoom-10 tiles (§4.1). At Idaho's latitude each cell
 * is ~28x28 km. Cells are tile-aligned so every child tile at any zoom maps
 * cleanly to exactly one cell.
 */
export const CELL_ZOOM = 10;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** All child XYZ tiles of a z10 cell at zoom `z` (z >= CELL_ZOOM). */
export function childTiles(cx: number, cy: number, z: number): Tile[] {
  if (z < CELL_ZOOM) {
    throw new Error(`childTiles requires z >= ${CELL_ZOOM}, got ${z}`);
  }
  const n = 1 << (z - CELL_ZOOM);
  const tiles: Tile[] = [];
  for (let dx = 0; dx < n; dx++) {
    for (let dy = 0; dy < n; dy++) {
      tiles.push({ z, x: cx * n + dx, y: cy * n + dy });
    }
  }
  return tiles;
}

/** MBTiles uses TMS row order; flip the XYZ y before storing/reading a tile row. */
export function tmsY(z: number, y: number): number {
  return (1 << z) - 1 - y;
}

/** Which z10 cell a given XYZ tile belongs to. */
export function tileToCell(tile: Tile): { cx: number; cy: number } {
  const n = 1 << (tile.z - CELL_ZOOM);
  return { cx: Math.floor(tile.x / n), cy: Math.floor(tile.y / n) };
}

/** Standard slippy-map projection: which z10 cell contains a lon/lat (for tap-to-select in the Downloads screen). */
export function lonLatToCell(lon: number, lat: number): { cx: number; cy: number } {
  const n = 1 << CELL_ZOOM;
  const cx = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const cy = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { cx, cy };
}

/** Lon/lat bounds of a z10 cell, e.g. to draw its outline on the map. */
export function cellBounds(cx: number, cy: number): [number, number, number, number] {
  const n = 1 << CELL_ZOOM;
  const lonWest = (cx / n) * 360 - 180;
  const lonEast = ((cx + 1) / n) * 360 - 180;
  const latNorth =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / n))) * 180) / Math.PI;
  const latSouth =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (cy + 1)) / n))) * 180) / Math.PI;
  return [lonWest, latSouth, lonEast, latNorth];
}

/** Rough per-cell size estimates from §4.2, in bytes. Measure actual sizes in the spike. */
export const ESTIMATED_BYTES_PER_CELL: Record<
  number,
  { tiles: number; imagery: [number, number]; topo: [number, number] }
> = {
  14: { tiles: 341, imagery: [8_000_000, 12_000_000], topo: [5_000_000, 7_000_000] },
  15: { tiles: 1_365, imagery: [35_000_000, 45_000_000], topo: [20_000_000, 30_000_000] },
  16: { tiles: 5_461, imagery: [110_000_000, 190_000_000], topo: [55_000_000, 135_000_000] },
  17: { tiles: 21_845, imagery: [450_000_000, 750_000_000], topo: [220_000_000, 550_000_000] },
};
