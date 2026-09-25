/**
 * Old source data. A unit layer whose agency last edited it three or more years ago may no longer match the
 * regulations, so the hunter must accept an explicit notice before using it (at download, and on the map for anything
 * already installed — data can age past the line after it was downloaded). Pure, with `now` injectable for tests.
 */
import type { HuntStateInfo } from '../huntUnits/types';
import { formatDataDate } from './huntUnitsStyle';

/** A layer edited this many whole years ago (or more) counts as old. */
export const STALE_AFTER_YEARS = 3;

export interface StaleNotice {
  state: string;
  stateName: string;
  setId: string;
  layer: string;
  /** The layer's last-edited date, YYYY-MM-DD. */
  updated: string;
  /** Whole years since. */
  years: number;
}

/** Whole calendar years from a YYYY-MM-DD date to `now` (UTC); null for anything that isn't such a date. */
export function yearsSince(date: string, now: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let years = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) years -= 1;
  return years;
}

export const ageText = (years: number) => (years === 1 ? '1 year ago' : `${years} years ago`);

/** The layers of a state whose source data is old. Layers with no published date aren't included — that is said separately. */
export function staleNotices(info: HuntStateInfo, now: Date = new Date()): StaleNotice[] {
  const notices: StaleNotice[] = [];
  for (const set of info.sets) {
    if (!set.updated) continue;
    const years = yearsSince(set.updated, now);
    if (years !== null && years >= STALE_AFTER_YEARS) {
      notices.push({ state: info.state, stateName: info.name, setId: set.id, layer: set.label, updated: set.updated, years });
    }
  }
  return notices;
}

/**
 * Identifies exactly what the hunter accepted: the old layers and their dates. Accepting "MA: zones edited 2021-09-17"
 * doesn't carry over to a later download whose data is a different (still old) date.
 */
export function staleSignature(info: HuntStateInfo, now: Date = new Date()): string {
  return staleNotices(info, now)
    .map((n) => `${n.setId}:${n.updated}`)
    .sort()
    .join(',');
}

/** The states among `infos` with old data the hunter hasn't accepted yet (`accepted` maps state code -> accepted signature). */
export function unacceptedStale(
  infos: readonly HuntStateInfo[],
  accepted: Readonly<Record<string, string>>,
  now: Date = new Date()
): StaleNotice[] {
  return infos.flatMap((info) => {
    const signature = staleSignature(info, now);
    return signature !== '' && accepted[info.state] !== signature ? staleNotices(info, now) : [];
  });
}

/** For the tap card: a plain warning when the tapped unit's own layer is old, else null. */
export function staleWarningFor(info: HuntStateInfo, setId: string, now: Date = new Date()): string | null {
  const notice = staleNotices(info, now).find((n) => n.setId === setId);
  if (!notice) return null;
  return `Warning: this layer's source data was last edited ${ageText(notice.years)} (${formatDataDate(notice.updated)}). Boundaries may have changed — confirm them in the current regulations.`;
}

/** For the Downloads list: the oldest layer's age, or null when nothing is old. */
export function staleSummary(info: HuntStateInfo, now: Date = new Date()): string | null {
  const notices = staleNotices(info, now).sort((a, b) => a.updated.localeCompare(b.updated));
  if (notices.length === 0) return null;
  const oldest = notices[0];
  return `Old data: ${notices.length === 1 ? 'this layer was' : `${notices.length} layers were`} last edited ${ageText(oldest.years)} (${formatDataDate(oldest.updated)})`;
}

/** What to record when the hunter accepts the notices for `infos`: state code -> signature, for the states that have old data. */
export function acceptanceFor(infos: readonly HuntStateInfo[], now: Date = new Date()): Record<string, string> {
  const accepted: Record<string, string> = {};
  for (const info of infos) {
    const signature = staleSignature(info, now);
    if (signature !== '') accepted[info.state] = signature;
  }
  return accepted;
}
