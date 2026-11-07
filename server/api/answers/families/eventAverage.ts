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

type Avg = { matches: number; avg: number | null; np: number | null; high: number | null };

async function averages(e: EventRow): Promise<Avg> {
  const [r] = await all<Avg>(`SELECT COUNT(*) matches, AVG((m.red_total + m.blue_total) / 2.0) avg, AVG((m.red_np + m.blue_np) / 2.0) np, MAX(MAX(m.red_total, m.blue_total)) high
    FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
    WHERE m.season = ? AND (e.code = ? OR e.division_code = ?) AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL`, [e.season, e.code, e.code]);
  return { matches: Number(r?.matches ?? 0), avg: r?.avg ?? null, np: r?.np ?? null, high: r?.high ?? null };
}

const one = (x: number | null) => (x == null ? "—" : x.toFixed(1));

/** The answer, each event found by `find` (its newest season with a played match, or the season named); null when an
 *  event isn't found. */
export async function eventAverageAnswer(qn: EventAverageQuestion, find: (words: string, season: number | null) => Promise<EventRow | null>): Promise<StatAnswer | null> {
  const evs: EventRow[] = [];
  for (const w of qn.events) {
    // A state's code in the name ("NJ Championship"), as events are named: its full name ("New Jersey Championship").
    const spelled = w.split(" ").map((x) => (x.length === 2 ? regionOf([x])?.name ?? x : x)).join(" ");
    const e = (await find(w, qn.season)) ?? (spelled !== w ? await find(spelled, qn.season) : null);
    if (!e) return null;
    evs.push(e);
  }
  // The same event twice ("NJ Championship vs New Jersey Championship") is one.
  if (evs.length === 2 && evs[0].season === evs[1].season && evs[0].code === evs[1].code) evs.pop();
  const rows = await Promise.all(evs.map(averages));
  const label = (e: EventRow) => `${e.name}, ${seasonLabel(e.season)}`;
  const definition = "An event's average match score is the mean of each alliance's score (penalties included) over its played matches, its divisions' too; the non-penalty average leaves out points from the other alliance's fouls.";
  const source = `From ${rows.reduce((n, r) => n + r.matches, 0).toLocaleString("en-US")} played matches`;
  const scope = evs.map(label);
  if (evs.length === 1) {
    const [e] = evs, [r] = rows;
    return {
      family: "event", intent: "event-average-score", title: `Average match score at ${label(e)}`, scope, definition, source,
      ...(r.matches ? { headline: { value: `${one(r.avg)} points`, label: `Average alliance score at ${e.name}`, sub: `${one(r.np)} without penalties · ${r.matches} matches · ${seasonLabel(e.season)}`, href: eventHref(e.season, e.code), type: e.type } } : { none: `No played matches at ${label(e)} on record yet.` }),
      blocks: r.matches ? [{ kind: "kpis", items: [
        { label: "Average score", value: one(r.avg), tone: "accent" }, { label: "Without penalties", value: one(r.np) },
        { label: "Highest score", value: r.high == null ? "—" : String(r.high) }, { label: "Matches", value: String(r.matches) },
      ] }] : [],
    };
  }
  const [a, b] = rows;
  const lead = a.avg != null && b.avg != null && a.avg !== b.avg ? (a.avg > b.avg ? 0 : 1) : null;
  const gap = lead == null ? null : Math.abs(a.avg! - b.avg!);
  return {
    family: "event", intent: "event-average-score-vs", title: `Average match score: ${evs.map((e) => e.name).join(" vs ")}`, scope, definition, source,
    ...(a.matches && b.matches ? { headline: {
      value: lead == null ? "Even" : `+${gap!.toFixed(1)} points`,
      label: lead == null ? "Both events average the same alliance score" : `${evs[lead].name} averages more per alliance`,
      sub: evs.map((e, i) => `${e.name} ${one(rows[i].avg)}`).join(" · "),
    } } : { none: `${evs.filter((_, i) => !rows[i].matches).map(label).join(" and ")} ha${evs.filter((_, i) => !rows[i].matches).length > 1 ? "ve" : "s"} no played matches on record yet.` }),
    blocks: [
      { kind: "bars", title: "Average alliance score", unit: "points", groups: [
        { label: "With penalties", items: evs.map((e, i) => ({ label: e.name, value: rows[i].avg == null ? null : Number(rows[i].avg!.toFixed(1)), tone: (i ? "b" : "a") as "a" | "b" })) },
        { label: "Without penalties", items: evs.map((e, i) => ({ label: e.name, value: rows[i].np == null ? null : Number(rows[i].np!.toFixed(1)), tone: (i ? "b" : "a") as "a" | "b" })) },
      ] },
      { kind: "table", title: "Side by side", columns: [{ key: "event", label: "Event" }, { key: "avg", label: "Average", num: true }, { key: "np", label: "Without penalties", num: true }, { key: "high", label: "Highest", num: true }, { key: "matches", label: "Matches", num: true }],
        rows: evs.map((e, i) => ({ cells: { event: label(e), avg: one(rows[i].avg), np: one(rows[i].np), high: rows[i].high, matches: rows[i].matches }, href: eventHref(e.season, e.code), strong: lead === i })) },
    ],
  };
}
