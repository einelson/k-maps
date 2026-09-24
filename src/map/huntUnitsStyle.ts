/**
 * Idaho hunt unit constants that don't need the bundled polygon data, so UI modules (layer lists,
 * cards) can use them without importing a 1.3 MB JSON file. The data itself: huntUnitsSource.ts.
 */
export interface HuntUnitProperties {
  /** The unit label hunters use: `39`, `60A` (or, for the non-unit polygons in IDFG's layer, their code: `YNP`). */
  unit: string;
  /** What to call it on the map: `Unit 39`, or `Yellowstone National Park` for a polygon that isn't a hunt unit. */
  label: string;
  /** False for polygons IDFG includes that aren't hunt units (Yellowstone). */
  isUnit: boolean;
  id: number | null;
  elkZone: string | null;
  /** IDFG deer-season page for the unit. */
  deerUrl: string | null;
  /** IDFG elk-zone page (tag limits). */
  elkUrl: string | null;
}

export const HUNT_UNIT_COLOR = '#c2410c';

/** IDFG's own caveat, shown wherever units are: the booklet, not this map, is the authority. */
export const HUNT_UNIT_DISCLAIMER =
  'Best representation only — confirm unit boundaries in the current IDFG regulation booklet before hunting.';
