// Week of a Tree: read from the list name (tolerating hand typing), checked against the cards' dates,
// otherwise derived from the cards' dates. Dates are handled in UTC, days only.

import type { Season } from "../shared/types.ts";

const DAY = 86_400_000;

/**
 * A date written in a list name: `DONE 25/11/2024`, `20/11/023`, `19/02/24`, `18/08//2025`, `6/10/2025`,
 * `3/11/2025`, `DONE 01.02.2024`. Day first (French). Returns null when there is no valid date.
 */
export function parseNameDate(name: string): Date | null {
  const m = /(?<!\d)(\d{1,2})\s*[/.\-]+\s*(\d{1,2})\s*[/.\-]+\s*(\d{2,4})(?!\d)/.exec(name);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  let y = Number(m[3]);
  if (m[3].length <= 3) y += 2000; // "24" → 2024, "023" → 2023
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null; // 31/02
  return date;
}

/** True if a list name says it holds finished work: a date in it, or the word DONE. */
export function nameSaysDone(name: string): boolean {
  return /\bdone\b/i.test(name) || parseNameDate(name) !== null;
}

/** Monday (UTC) of the ISO week containing `d`, as `YYYY-MM-DD`. */
export function weekOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Northern-hemisphere meteorological season of a `YYYY-MM-DD` week. */
export function seasonOf(week: string): Season {
  const month = Number(week.slice(5, 7));
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** The dates of one card that matter for its Week. */
export interface CardDates {
  created: Date;
  lastActivity: Date;
}

/**
 * Does a done-date fit the cards of its list? A card cannot be finished long before it was created, and a
 * weekly list is not finished long after its cards' last activity. Tolerances: 7 days before the median
 * creation date, and 45 days after the latest activity (cards can be edited or archived later, never earlier).
 */
export function dateFits(date: Date, cards: CardDates[]): boolean {
  if (cards.length === 0) return true;
  const created = cards.map((c) => c.created.getTime()).sort((a, b) => a - b);
  const medianCreated = created[Math.floor((created.length - 1) / 2)];
  const lastActivity = Math.max(...cards.map((c) => c.lastActivity.getTime()));
  const t = date.getTime();
  return t >= medianCreated - 7 * DAY && t <= lastActivity + 45 * DAY;
}

/**
 * Week derived from the cards only: the median last activity, but never before the latest creation
 * (the list was finished once all its cards existed).
 */
export function weekFromCards(cards: CardDates[]): Date {
  const acts = cards.map((c) => c.lastActivity.getTime()).sort((a, b) => a - b);
  const median = acts[Math.floor((acts.length - 1) / 2)];
  const latestCreated = Math.max(...cards.map((c) => c.created.getTime()));
  return new Date(Math.max(median, latestCreated));
}

export interface WeekResult {
  week: string;
  from: "name" | "cards";
}

/**
 * The Week of a Tree. The name's date wins when it fits the cards; a date whose only error is the year
 * (`DONE 13/05/2023` holding cards of May 2024) is repaired with the cards' year when that fits; otherwise
 * the Week comes from the cards. `cards` must not be empty.
 */
export function resolveWeek(listName: string, cards: CardDates[]): WeekResult {
  const named = parseNameDate(listName);
  if (named && dateFits(named, cards)) return { week: weekOf(named), from: "name" };
  if (named) {
    const years = new Set(cards.map((c) => c.created.getUTCFullYear()));
    for (const y of [...years].sort()) {
      for (const yy of [y, y + 1]) {
        const fixed = new Date(Date.UTC(yy, named.getUTCMonth(), named.getUTCDate()));
        if (fixed.getUTCMonth() === named.getUTCMonth() && dateFits(fixed, cards)) {
          return { week: weekOf(fixed), from: "name" };
        }
      }
    }
  }
  return { week: weekOf(weekFromCards(cards)), from: "cards" };
}

/** Creation date of a Trello object, from the timestamp in the first 8 hex digits of its id. */
export function dateFromTrelloId(id: string): Date {
  const secs = parseInt(id.slice(0, 8), 16);
  return new Date(Number.isFinite(secs) ? secs * 1000 : 0);
}
