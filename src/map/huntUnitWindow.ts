/**
 * Which downloaded states' hunting units the map mounts. Each mounted state is a MapLibre source plus three style
 * layers, and a hunter can download all fifty — so only states whose area overlaps the current view are mounted,
 * nearest the center first, capped. (Idaho, bundled, is always mounted by the caller.)
 *
 * The view is quantized to half-degree steps, so panning within a step changes nothing and doesn't re-render the map.
 * Pure so it is unit-testable.
 */

/** `[west, south, east, north]` */
export type Box = [number, number, number, number];

/** Below this the view spans a continent and unit boundaries are unreadable noise anyway. */
export const HUNT_STATE_MIN_ZOOM = 4;
/** At most this many downloaded states are mounted at once. */
export const HUNT_STATE_MAX_MOUNTED = 12;
/** States just off-screen are mounted too, so panning a little doesn't reveal a gap. */
export const HUNT_STATE_MARGIN_DEGREES = 0.5;
const STEP = 0.5;

export interface ViewBox {
  bounds: Box;
  centerLon: number;
  centerLat: number;
  /** Whole zoom level. */
  zoom: number;
}

const floorTo = (v: number) => Math.floor(v / STEP) * STEP;
const ceilTo = (v: number) => Math.ceil(v / STEP) * STEP;
const roundTo = (v: number) => Math.round(v / STEP) * STEP;

/** The quantized view for a camera position. */
export function viewBoxOf(view: { bounds: Box; center: [number, number]; zoom: number }): ViewBox {
  const [west, south, east, north] = view.bounds;
  return {
    bounds: [floorTo(west), floorTo(south), ceilTo(east), ceilTo(north)],
    centerLon: roundTo(view.center[0]),
    centerLat: roundTo(view.center[1]),
    zoom: Math.floor(view.zoom),
  };
}

/** Lets callers keep the same state object (and skip a re-render) while the quantized view is unchanged. */
export function sameViewBox(a: ViewBox | null, b: ViewBox | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.zoom === b.zoom &&
    a.centerLon === b.centerLon &&
    a.centerLat === b.centerLat &&
    a.bounds.every((v, i) => v === b.bounds[i])
  );
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** The states to mount: those overlapping the view (plus a margin), nearest the view's center first, capped. */
export function huntStatesInView<T extends { bbox: Box }>(states: readonly T[], view: ViewBox | null): T[] {
  if (view === null || view.zoom < HUNT_STATE_MIN_ZOOM) return [];
  const m = HUNT_STATE_MARGIN_DEGREES;
  const [w, s, e, n] = view.bounds;
  const area: Box = [w - m, s - m, e + m, n + m];
  return states
    .filter((state) => boxesIntersect(state.bbox, area))
    .map((state) => {
      const cx = (state.bbox[0] + state.bbox[2]) / 2;
      const cy = (state.bbox[1] + state.bbox[3]) / 2;
      return { state, distance: (cx - view.centerLon) ** 2 + (cy - view.centerLat) ** 2 };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, HUNT_STATE_MAX_MOUNTED)
    .map(({ state }) => state);
}
