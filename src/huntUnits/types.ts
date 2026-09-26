/**
 * Hunting units: the management/hunt units (GMUs, WMUs, hunt districts, deer zones ...) each state wildlife agency
 * publishes, normalized to one shape so the app can draw and describe any state's the same way.
 *
 * Pure types only — shared by the build tools (loaded with node's type stripping) and the app.
 */

/** What every hunt-unit feature carries once normalized (all flat: MapLibre hands feature properties back as plain values). */
export interface HuntUnitProperties {
  /** Which of the state's unit sets (species / layer) this belongs to: `deer`, `elk`, `gmu` ... */
  set: string;
  /** Short unit label drawn on the map: `27`, `60A`, `Book Cliffs`. */
  unit: string;
  /** Full name for the tap card: `Unit 27 – Chetco`. */
  title: string;
  /** Secondary line for the card (season, elk zone ...), or null. */
  note: string | null;
  /** Up to two regulation / info links for this unit, with their button labels. */
  url: string | null;
  urlLabel: string | null;
  url2: string | null;
  url2Label: string | null;
}

/** What a set's `map` returns for one source feature (null = leave the feature out). */
export interface UnitInfo {
  unit: string;
  title?: string;
  note?: string | null;
  url?: string | null;
  urlLabel?: string;
  url2?: string | null;
  url2Label?: string;
}

export interface HuntSetConfig {
  id: string;
  /** Plural, for lists: `Deer Management Units`. */
  label: string;
  /** Singular, prefixed to the unit on the card when `map` gives no title: `Deer Management Unit`. */
  noun: string;
  /** Full URL of the ArcGIS layer (`.../FeatureServer/0`). */
  layer: string;
  where?: string;
  /** Merge features that share this attribute into one polygon (e.g. counties -> zones). */
  dissolveBy?: string;
  /** Layer supports resultOffset paging (only needed for layers over ~1000 features). */
  paginate?: boolean;
  /** Source attributes -> normalized unit, or null to skip the feature. */
  map: (attributes: Record<string, any>) => UnitInfo | null;
  /** One real attribute row + what `map` should make of it — documents the mapping and is checked by a test. */
  example: { attributes: Record<string, any>; unit: string; title: string };
}

export interface HuntStateConfig {
  /** Two-letter postal code. */
  code: string;
  name: string;
  /** Publishing agency, shown as the source on the card. */
  agency: string;
  /** The agency's hunting regulations page — the authority these boundaries defer to. */
  regsUrl: string;
  /** Free text: which season / year the agency says the boundaries are for. Empty when it states none. */
  vintage: string;
  /** Skip the ~30 m display simplification: the agency's terms forbid altering its boundaries (Oregon's do). */
  fullResolution?: boolean;
  sets: HuntSetConfig[];
}

/** What the app knows about one state's hunting units — from the manifest at install time. */
export interface HuntStateInfo {
  /** Two-letter postal code. */
  state: string;
  name: string;
  agency: string;
  regsUrl: string;
  vintage: string;
  /** When the units were downloaded from the agency's service (ISO timestamp), if known. */
  fetchedAt?: string;
  /** `[west, south, east, north]` of all the state's units. */
  bbox: [number, number, number, number];
  /** The unit sets inside (species / layers); the first is shown by default. `updated` is the source layer's last-edited date (YYYY-MM-DD) when its service says. */
  sets: { id: string; label: string; count: number; updated?: string }[];
}
