// Which of two events came first ("did <event> happen before or after <event>", "was <event> before <event>"): both
// events found by name, in the newest season both were held unless a season is said, each with its dates, and how far
// apart they were. Read from the events' own rows: nothing here names an event, a place or a season.
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { eventHref, shortEvent } from "../matchSet.js";
import type { EventRow } from "./eventVersus.js";

// "Did/was/is <event> (happen/held/…) before or after <event>": the two sides, the words that ask the order between.
const ORDER = /^\s*(?:did|does|do|was|were|is|will|has|had)\s+(?:the\s+)?(.+?)\s+(?:(?:happen(?:ed|s)?|take\s+place|took\s+place|takes\s+place|be\s+held|held|come|came|start(?:ed|s)?|go|went)\s+)?(before\s+or\s+after|after\s+or\s+before|before|after|earlier\s+than|later\s+than)\s+(?:the\s+)?(.+?)\s*[?!.]*\s*$/i;

/** The two events' words and the order asked ("either": before or after), or null when `q` isn't such a question. */
export function readEventOrder(q: string): { a: string; b: string; asked: "before" | "after" | "either" } | null {
  const m = ORDER.exec(q);
  if (!m) return null;
  const said = m[2].toLowerCase().replace(/\s+/g, " ");
  const asked = /before or after|after or before/.test(said) ? "either" : /before|earlier/.test(said) ? "before" : "after";
  const a = m[1].trim(), b = m[3].trim();
  return a && b ? { a, b, asked } : null;
}

const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
/** "3 days", "5 weeks", "4 months" between two dates. */
function apart(from: string, to: string): string {
  const d = Math.round(Math.abs(day(to) - day(from)) / 86_400_000);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"}`;
  if (d < 62) return `${Math.round(d / 7)} weeks`;
  const m = Math.round(d / 30.44);
  return `${m} month${m === 1 ? "" : "s"}`;
}

/** The answer for events `x` (asked about) and `y` (the one it is set against), both dated. */
export function eventOrderAnswer(x: EventRow & { end?: string | null }, y: EventRow & { end?: string | null }, asked: "before" | "after" | "either"): StatAnswer | null {
  if (!x.start || !y.start) return null;
  const [nx, ny] = [shortEvent(x.name, x.type), shortEvent(y.name, y.type)];
  const xEnd = x.end ?? x.start, yEnd = y.end ?? y.start;
  // Before: it ended before the other began; after: it began after the other ended; else the two overlapped.
  const order = xEnd.slice(0, 10) < y.start.slice(0, 10) ? "before" : x.start.slice(0, 10) > yEnd.slice(0, 10) ? "after" : "during";
  const yes = asked === "either" ? null : asked === order;
  const sameSeason = x.season === y.season;
  const gap = order === "before" ? apart(xEnd, y.start) : order === "after" ? apart(yEnd, x.start) : null;
  const verdict = order === "during" ? `${nx} was held at the same time as ${ny}` : `${nx} was ${gap} ${order} ${ny}`;
  const when = (e: EventRow & { end?: string | null }) => dateRange(e.start!.slice(0, 10), (e.end ?? e.start)!.slice(0, 10));
  return {
    family: "event", intent: "event-order",
    title: `${nx} ${asked === "either" ? "before or after" : asked} ${ny}?`,
    scope: sameSeason ? [seasonLabel(x.season)] : [seasonLabel(x.season), seasonLabel(y.season)],
    headline: { value: yes == null ? order.replace(/^./, (c) => c.toUpperCase()) : yes ? "Yes" : "No", label: verdict, sub: `${verdict} (${when(x)}; ${when(y)})`, href: eventHref(x.season, x.code) },
    blocks: [{ kind: "kpis", items: [
      { label: nx, value: when(x), sub: seasonLabel(x.season), href: eventHref(x.season, x.code) },
      { label: ny, value: when(y), sub: seasonLabel(y.season), href: eventHref(y.season, y.code) },
    ] }],
    definition: `Each event by its own dates, first day to last.${sameSeason ? ` Both are ${seasonLabel(x.season)}'s editions: with no season said, the newest season both were held.` : " They were never held in the same season: each is its newest edition."}`,
    source: "From the events' dates",
  };
}
