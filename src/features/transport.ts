/**
 * How a track was travelled: picked when recording starts (or edited on the track afterwards) and carried
 * through GPX. It also sets how often the GPS is asked for a fix (`fixEveryM`), which is most of what a
 * recorded track weighs: a truck doesn't need a point every 5 m, a hiker does.
 */

export type TransportId = 'foot' | 'horse' | 'bike' | 'atv' | 'vehicle' | 'boat' | 'other';

export interface TransportMode {
  id: TransportId;
  label: string;
  /** Free-text `<type>` written to GPX, in the words other apps use for the activity. */
  gpxType: string;
  /** Minimum distance between recorded fixes, in metres. */
  fixEveryM: number;
}

export const TRANSPORT_MODES: TransportMode[] = [
  { id: 'foot', label: 'On foot', gpxType: 'hiking', fixEveryM: 5 },
  { id: 'horse', label: 'Horse', gpxType: 'horseback riding', fixEveryM: 10 },
  { id: 'bike', label: 'Bike', gpxType: 'cycling', fixEveryM: 10 },
  { id: 'atv', label: 'ATV / UTV', gpxType: 'atv', fixEveryM: 15 },
  { id: 'vehicle', label: 'Vehicle', gpxType: 'driving', fixEveryM: 25 },
  { id: 'boat', label: 'Boat', gpxType: 'boating', fixEveryM: 25 },
  { id: 'other', label: 'Other', gpxType: 'other', fixEveryM: 10 },
];

const BY_ID = new Map<string, TransportMode>(TRANSPORT_MODES.map((mode) => [mode.id, mode]));

/** What tracks recorded before transport existed were sampled at, and what "no method chosen" records at. */
export const DEFAULT_FIX_EVERY_M = 5;

/** Metres between fixes per mode: what each mode starts at, and what the Settings screen resets to. */
export type FixSpacing = Record<TransportId, number>;
export const DEFAULT_FIX_SPACING_M = Object.fromEntries(
  TRANSPORT_MODES.map((mode) => [mode.id, mode.fixEveryM])
) as FixSpacing;

/**
 * The spacings the Settings screen steps through, in metres. Fine near what people use (a fix every few metres
 * on foot, tens of metres in a truck) and coarser past that; below 1 m is inside the GPS's own noise, above
 * 100 m a track stops following the road or trail.
 */
export const SPACING_STEPS_M = [1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100];
export const MIN_FIX_EVERY_M = SPACING_STEPS_M[0];
export const MAX_FIX_EVERY_M = SPACING_STEPS_M[SPACING_STEPS_M.length - 1];

/** A spacing kept inside what the recorder will accept. */
export function clampSpacing(metres: number): number {
  return Math.min(MAX_FIX_EVERY_M, Math.max(MIN_FIX_EVERY_M, metres));
}

/** The next larger (`1`) or smaller (`-1`) spacing on the ladder, from wherever `metres` sits on it. */
export function stepSpacing(metres: number, direction: 1 | -1): number {
  const clamped = clampSpacing(metres);
  if (direction === 1) return SPACING_STEPS_M.find((step) => step > clamped) ?? MAX_FIX_EVERY_M;
  return [...SPACING_STEPS_M].reverse().find((step) => step < clamped) ?? MIN_FIX_EVERY_M;
}

export function transportMode(id: string | null | undefined): TransportMode | null {
  return (id != null && BY_ID.get(id)) || null;
}

export function transportLabel(id: string | null | undefined): string | null {
  return transportMode(id)?.label ?? null;
}

/** Metres between fixes for a mode: the person's setting for it if `custom` has one, else its default. */
export function fixEveryM(id: string | null | undefined, custom?: Partial<Record<string, number>>): number {
  const mode = transportMode(id);
  if (!mode) return DEFAULT_FIX_EVERY_M;
  return clampSpacing(custom?.[mode.id] ?? mode.fixEveryM);
}

/**
 * Words other apps put in a GPX `<type>` (Garmin "hiking", "cycling"; Komoot "Horse riding"; free text from
 * everyone else), tried in this order: the more specific vehicles first, so "dirt bike" is an ATV and "motorcycle"
 * a vehicle, not bikes.
 * Numeric codes (Strava writes `<type>1</type>`) match nothing and come back null rather than guessed.
 */
const ALIASES: [TransportId, RegExp][] = [
  ['horse', /horse|equestrian|pack ?string/],
  ['atv', /\batv\b|\butv\b|\bohv\b|\bquad\b|side[- ]?by[- ]?side|dirt ?bike|off[- ]?road/],
  ['boat', /boat|kayak|canoe|paddl|sail|raft|rowing/],
  ['vehicle', /driv|\bcar\b|truck|vehicle|motorcycle|motorbike|4x4|jeep|\bsuv\b|\bauto/], // before bike: "motorcycle" contains "cycl"
  ['bike', /bik|cycl|\bmtb\b|bicycl/],
  ['foot', /hik|walk|\brun|jog|foot|trek|backpack|snowshoe/],
];

/** A `<type>` (or a mode's own id) to a mode, or null when it isn't one we know. */
export function parseTransport(text: string | null | undefined): TransportId | null {
  const value = text?.trim().toLowerCase();
  if (!value) return null;
  const exact = transportMode(value);
  if (exact) return exact.id;
  return ALIASES.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}
