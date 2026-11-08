// An event's average match score ("average match score at <event>"), or two events' side by side ("… at <event>
// versus <event>"): the mean alliance score over the played matches there (its divisions' too), with and without
// penalties. Each event by name, its newest season with a played match unless a season is named.
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { all } from "../../../db.js";
import { eventHref } from "../matchSet.js";

export interface EventAverageQuestion { events: string[]; season: number | null }

/** The event as findEvent gives it. */
export type EventRow = { season: number; code: string; name: string; type: string | null; start: string | null; division: string | null };

// "average match score", "avg alliance scores", "mean score per match"
const AVERAGE = String.raw`(?:average|avg|mean)\s+(?:(?:match|alliance|game)\s+)?scores?(?:\s+per\s+(?:match|alliance|game))?`;
const SPLIT = /\s*,?\s+(?:vs\.?|versus|v\.?|compared\s+(?:to|with)|against|and)\s+,?\s*/i;
const FRAME = /^(?:(?:what|whats|what's|is|was|show(?:\s+me)?|tell\s+me|compare|the)\s+)+/i;
const TAIL = /\s*,?\s*(?:side\s+by\s+side|compared|in\s+comparison)\s*$/i;

/** "average match score at <event> [versus <event>]", "<event> average score": the events named (one or two); null when
 *  it isn't one. A team named is the team's own question, never this. */
export function readEventAverage(q0: string): EventAverageQuestion | null {
  // A season written as one ("2024-25", "in 2024–25"): every event that season.
  const S = /\s*,?\s*(?:(?:in|during|for)\s+)?(?:the\s+)?(20\d\d)\s*[-–/]\s*\d\d(?:\s+season)?(?=\s|,|$)/i;
  const sm = S.exec(q0);
  const season = sm ? Number(sm[1]) : null;
  const q = (sm ? q0.replace(S, " ") : q0).replace(/[?!]/g, " ").replace(/\s+/g, " ").trim().replace(FRAME, "").replace(TAIL, "");
  const before = new RegExp(`^(?:the\\s+)?${AVERAGE}\\s+(?:at|in|of|for|from)\\s+(?:the\\s+)?(.+)$`, "i").exec(q);
  const after = new RegExp(`^(?:the\\s+)?(.+?)(?:'s|’s)?\\s+${AVERAGE}$`, "i").exec(q);
  const rest = (before ?? after)?.[1];
  if (!rest) return null;
  const events = rest.split(SPLIT).map((s) => s.replace(/^,|,$/g, "").replace(/^(?:the|at)\s+/i, "").trim()).filter(Boolean);
  // A team's number names a team ("12345 average score"): its own question.
  if (!events.length || events.length > 2 || events.some((e) => /^\d+$/.test(e) || e.split(" ").length > 8)) return null;
  // Worlds and states are scopes of their own (each its events, every division), never one event found by the word.
  if (events.some((e) => /^(?:worlds?|world championships?|cmp|states?|state championships?)$/i.test(e))) return null;
  return { events, season };
}

/** `npMatches`: the matches with both scores without penalties on record, the ones the non-penalty average covers. */
type Avg = { matches: number; avg: number | null; np: number | null; npMatches: number; high: number | null };

async function averages(e: EventRow): Promise<Avg> {
  const [r] = await all<Avg>(`SELECT COUNT(*) matches, AVG((m.red_total + m.blue_total) / 2.0) avg, AVG((m.red_np + m.blue_np) / 2.0) np,
    SUM(CASE WHEN m.red_np IS NOT NULL AND m.blue_np IS NOT NULL THEN 1 ELSE 0 END) npMatches, MAX(MAX(m.red_total, m.blue_total)) high
    FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
    WHERE m.season = ? AND (e.code = ? OR e.division_code = ?) AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL`, [e.season, e.code, e.code]);
  return { matches: Number(r?.matches ?? 0), avg: r?.avg ?? null, np: r?.np ?? null, npMatches: Number(r?.npMatches ?? 0), high: r?.high ?? null };
}

const one = (x: number | null) => (x == null ? "—" : x.toFixed(1));
/** The non-penalty average, with how many matches it covers when that's fewer than all of them. */
const npOf = (r: Avg) => (r.np != null && r.npMatches < r.matches ? `${one(r.np)} (${r.npMatches} of ${r.matches})` : one(r.np));

/** The answer, each event found by `find` (its newest season with a played match, or the season named); null when an
 *  event isn't found. */
export type FindEvent = (words: string, season: number | null) => Promise<EventRow | null>;

/** The events asked about, each by `find`; null when one isn't found. The same event twice is one. */
export async function eventsAsked(qn: EventAverageQuestion, find: FindEvent): Promise<EventRow[] | null> {
  const evs: EventRow[] = [];
  for (const w of qn.events) {
    // A state's code in the name ("NJ Championship"), as events are named: its full name ("New Jersey Championship").
    const spelled = w.split(" ").map((x) => (x.length === 2 ? regionOf([x])?.name ?? x : x)).join(" ");
    // The state spelled out first: "NJ Championship" is New Jersey's, never an old division with "NJ0312" in its name.
    const e = (spelled !== w ? await find(spelled, qn.season) : null) ?? (await find(w, qn.season));
    if (!e) return null;
    evs.push(e);
  }
  if (evs.length === 2 && evs[0].season === evs[1].season && evs[0].code === evs[1].code) evs.pop();
  return evs;
}

/** The title an answer about these events has. */
export const eventAverageTitle = (evs: EventRow[]) => evs.length === 1 ? `Average match score at ${evs[0].name}, ${seasonLabel(evs[0].season)}` : `Average match score: ${evs.map((e) => e.name).join(" vs ")}`;

export async function eventAverageAnswer(qn: EventAverageQuestion, find: FindEvent): Promise<StatAnswer | null> {
  const evs = await eventsAsked(qn, find);
  if (!evs) return null;
  const rows = await Promise.all(evs.map(averages));
  const label = (e: EventRow) => `${e.name}, ${seasonLabel(e.season)}`;
  const definition = "An event's average match score is the mean of each alliance's score (penalties included) over its played matches, its divisions' too; the non-penalty average leaves out points from the other alliance's fouls, over the matches with those scores on record (how many is said when that's fewer).";
  const source = `From ${rows.reduce((n, r) => n + r.matches, 0).toLocaleString("en-US")} played matches`;
  const scope = evs.map(label);
  if (evs.length === 1) {
    const [e] = evs, [r] = rows;
    return {
      family: "event", intent: "event-average-score", title: eventAverageTitle(evs), scope, definition, source,
      ...(r.matches ? { headline: { value: `${one(r.avg)} points`, label: `Average alliance score at ${e.name}`, sub: `${npOf(r)} without penalties · ${r.matches} matches · ${seasonLabel(e.season)}`, href: eventHref(e.season, e.code), type: e.type } } : { none: `No played matches at ${label(e)} on record yet.` }),
      blocks: r.matches ? [{ kind: "kpis", items: [
        { label: "Average score", value: one(r.avg), tone: "accent" }, { label: "Without penalties", value: one(r.np), ...(r.np != null && r.npMatches < r.matches ? { sub: `${r.npMatches} of ${r.matches} matches` } : {}) },
        { label: "Highest score", value: r.high == null ? "—" : String(r.high) }, { label: "Matches", value: String(r.matches) },
      ] }] : [],
    };
  }
  const [a, b] = rows;
  const lead = a.avg != null && b.avg != null && a.avg !== b.avg ? (a.avg > b.avg ? 0 : 1) : null;
  const gap = lead == null ? null : Math.abs(a.avg! - b.avg!);
  return {
    family: "event", intent: "event-average-score-vs", title: eventAverageTitle(evs), scope, definition, source,
    ...(a.matches && b.matches ? { headline: {
      value: lead == null ? "Even" : `+${gap!.toFixed(1)} points`,
      label: lead == null ? "Both events average the same alliance score" : `${evs[lead].name} averages more per alliance`,
      sub: evs.map((e, i) => `${e.name} ${one(rows[i].avg)}`).join(" · "),
    } } : { none: `${evs.filter((_, i) => !rows[i].matches).map(label).join(" and ")} ha${evs.filter((_, i) => !rows[i].matches).length > 1 ? "ve" : "s"} no played matches on record yet.` }),
    blocks: [
      // Four short columns, so a phone shows them all (each event's season is in the scope chips above).
      { kind: "table", title: "Side by side", columns: [{ key: "event", label: "Event" }, { key: "avg", label: "Average", num: true }, { key: "np", label: "No pen.", num: true }, { key: "matches", label: "Matches", num: true }],
        rows: evs.map((e, i) => ({ cells: { event: e.name, avg: one(rows[i].avg), np: npOf(rows[i]), matches: rows[i].matches }, href: eventHref(e.season, e.code), strong: lead === i })) },
    ],
  };
}
