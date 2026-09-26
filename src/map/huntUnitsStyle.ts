/**
 * Hunting-unit constants that don't need any polygon data, so UI modules (layer lists, cards) can use them without
 * pulling in the map or the state registry. The data itself: src/huntUnits/ (every state).
 * The disclaimer wording lives here, once, so every place that shows it says the same thing.
 */
import type { HuntStateInfo } from '../huntUnits/types';

export type { HuntUnitProperties } from '../huntUnits/types';

export const HUNT_UNIT_COLOR = '#c2410c';

export const HUNT_UNIT_DISCLAIMER_TITLE = 'Check your local laws and regulations';

/** The short form, for cards and notes: what a hunter must take away even if they read nothing else. */
export function huntUnitDisclaimer(stateName: string): string {
  return `Reference only — may be out of date or inaccurate. Check the current ${stateName} hunting regulations and local laws for the actual boundaries before you hunt.`;
}

/** The full form, shown before hunting units are first used. */
export const HUNT_UNIT_DISCLAIMER_POINTS: readonly string[] = [
  'Hunting unit boundaries in K-Maps are for general reference only.',
  'They are copied from each state wildlife agency\'s data and simplified for display, so they can be out of date or off near a boundary.',
  "They don't show private land, closures, refuges, tribal land, or city and county rules, and seasons, tags and rules can differ inside a unit.",
  'Always confirm boundaries, seasons and rules in the current hunting regulations for your state, and follow all local laws. You are responsible for knowing where and when you may hunt.',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-27" (or an ISO timestamp) -> "Aug 27, 2026"; anything else comes back unchanged. */
export function formatDataDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : value;
}

/**
 * The card's source line: who published the units, the season if they say one, how old the source data is, and when
 * it was downloaded — so a hunter can judge the boundaries, and sees plainly when an agency doesn't publish a date.
 */
export function huntUnitSourceNote(state: HuntStateInfo, setId: string): string {
  const updated = state.sets.find((set) => set.id === setId)?.updated;
  const edited = updated ? `last edited ${formatDataDate(updated)}` : "date not published by the agency's service";
  const downloaded = state.fetchedAt ? `; downloaded ${formatDataDate(state.fetchedAt)}` : '';
  return `${state.agency}${state.vintage ? ` · ${state.vintage}` : ''}. Source data ${edited}${downloaded}.`;
}

/**
 * One line on how old a state's data is, for the Downloads list: the season the agency states (if any) and the
 * oldest last-edited date among its layers (a state is only as current as its stalest layer), or a plain note when
 * the agency's service doesn't publish dates.
 */
export function huntUnitDataSummary(info: Pick<HuntStateInfo, 'vintage' | 'sets'>): string {
  const dates = info.sets.map((set) => set.updated).filter((d): d is string => !!d).sort();
  const age = dates.length === 0 ? 'Source data date not published' : `Source data last edited ${formatDataDate(dates[0])}`;
  return [info.vintage, age].filter(Boolean).join(' · ');
}
