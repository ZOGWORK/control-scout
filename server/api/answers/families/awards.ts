// Family 8: a team's awards (the awards table, filtered by the scope clauses: season, event, Worlds, states), as a
// labelled list or a count.
//   "Won an event" is two kinds of achievement, never conflated: 1st place (on the event's Winning Alliance: FIRST's
//   Winner award) and the Inspire Award (1st-place Inspire; 2nd- and 3rd-place Inspire are listed as such, not as wins).
//   Performance awards are the Winning and Finalist Alliances; individual awards are Dean's List, Compass and
//   Volunteer; every other award is a judged team award.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { awardLabel, dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { all } from "../../../db.js";
import { eventSql, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import { eventHref, shortEvent } from "../matchSet.js";
import type { IntentId } from "../read.js";
import { whoOf, type AnswerTeam } from "./matches.js";

export const PERFORMANCE = new Set(["Winner", "Finalist"]);
export const INDIVIDUAL = new Set(["DeansList", "Compass", "Volunteer"]);
const kindOf = (type: string) => (PERFORMANCE.has(type) ? "Performance" : INDIVIDUAL.has(type) ? "Individual" : "Judged");

interface AwardRow { season: number; code: string; name: string; type: string; placement: number; start: string | null; end: string | null; award: string | null }

const WINS_RULE = "Won an event: two kinds of win, listed apart. 1st place means the team was on the event's Winning Alliance (FIRST's Winning Alliance award); the Inspire Award is the event's top judged award (1st-place Inspire). Both from the event's published awards.";
const KIND_RULE = "Performance awards: Winning and Finalist Alliance. Individual awards: Dean's List, Compass and Volunteer. Every other award is a judged team award. From the events' published awards.";

/** The team's awards in the scope, newest first (one query, on awards_team): all of them, so every count is whole; the
 *  tables show the first 50. */
async function awardRows(team: number, scope: Scope): Promise<AwardRow[]> {
  const w = eventSql(scope);
  return all<AwardRow>(
    `SELECT a.season, a.code, e.name, e.type event_type, a.type award, a.name award_name, a.placement, e.start, e.end FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code
     WHERE a.team = ? AND ${w.sql} ORDER BY e.start DESC, a.code, a.type = 'Winner' DESC, a.type = 'Inspire' DESC, a.placement`,
    [team, ...w.args]).then((rs) => rs.map((r: any) => ({ season: Number(r.season), code: r.code, name: shortEvent(r.name, r.event_type ?? null), type: r.award, placement: Number(r.placement), start: r.start, end: r.end, award: r.award_name ?? null })));
}

const label = (r: AwardRow) => (r.type === "Winner" ? "1st place (Winning Alliance)" : r.type === "Inspire" && r.placement === 1 ? "Inspire Award" : awardLabel(r.type, r.placement));

function table(rows: AwardRow[], team: number, title: string, withKind = false): StatBlock {
  return {
    kind: "table", title,
    columns: [{ key: "award", label: "Award" }, { key: "event", label: "Event" }, { key: "season", label: "Season" }, { key: "date", label: "Date" }, ...(withKind ? [{ key: "kind", label: "Kind" }] : [])],
    rows: rows.slice(0, 50).map((r) => ({ cells: { award: label(r), event: r.name, season: seasonLabel(r.season), date: dateRange(r.start, r.end), kind: kindOf(r.type) }, href: eventHref(r.season, r.code, team), strong: r.type === "Winner" || (r.type === "Inspire" && r.placement === 1) })),
    ...(rows.length > 50 ? { more: `Showing 50 of ${rows.length}` } : {}),
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One award's name as a heading: "Design Award", "Judges' Choice Award", "Winning Alliance". */
const awardName = (type: string) => (PERFORMANCE.has(type) ? awardLabel(type, 1) : `${awardLabel(type, 1)} Award`);

/** The heading for an awards question: one award named ("Design Award"), or the newest or earliest only. */
export function awardsTitle(id: IntentId, opts: { award?: string; pick?: "first" | "latest" }): string | null {
  const what = opts.award ? (opts.award === "Winner" ? "Winning Alliance awards" : awardName(opts.award)) : id === "inspire-awards" ? "Inspire Award" : "award";
  if (opts.pick) return `${opts.pick === "latest" ? "Most recent" : "First"} ${what}`;
  return opts.award ? what : null;
}

/** The answer for an awards intent, or null when `id` isn't one. */
export async function awardsAnswer(id: IntentId, team: AnswerTeam, scope: Scope, opts: { count: boolean; award?: string; pick?: "first" | "latest" }): Promise<StatAnswer | null> {
  if (!["event-wins", "inspire-awards", "finalist-finishes", "total-awards", "award-split", "awards"].includes(id)) return null;
  const every = await awardRows(team.number, scope);
  // One award named ("4215 design award"), or Inspire for its newest or earliest: only those rows.
  // FIRST stores its Leadership Award as a Winner too: never a Winning Alliance (as winners.ts reads them).
  const rows = opts.award ? every.filter((r) => r.type === opts.award && !(r.type === "Winner" && /leadership/i.test(r.award ?? ""))) : id === "inspire-awards" && opts.pick ? every.filter((r) => r.type === "Inspire") : every;
  const who = whoOf(team), where = scopePhrase(scope);
  const events = new Set(rows.map((r) => `${r.season}|${r.code}`)).size;
  const base = { team, scope: scopeChips(scope), source: rows.length ? `From ${count(rows.length, "award record")} at ${count(events, "event")}` : "No awards in this scope" };
  const checked = scope.season == null && !scope.event ? " (every season on record checked)" : "";

  if (opts.pick) {
    // Newest first already: the newest event's awards, or the earliest event's, every one given there.
    const title = `${awardsTitle(id, opts)}${where}`;
    const def = `${opts.pick === "latest" ? "Most recent" : "First"}: by the event's date, from the events' published awards; every award the team won at that event is listed.`;
    const top = opts.pick === "latest" ? rows[0] : rows[rows.length - 1];
    if (!top) return { ...base, family: "awards", intent: id, title, blocks: [], definition: def, none: `No ${opts.award ? awardName(opts.award) : id === "inspire-awards" ? "Inspire Award" : "awards"}${where} found for ${who} in the published awards${checked}.` };
    const there = every.filter((r) => r.season === top.season && r.code === top.code);
    return {
      ...base, family: "awards", intent: id, title,
      headline: { value: label(top), label: top.name, sub: [seasonLabel(top.season), dateRange(top.start, top.end), there.length > 1 ? `also ${there.filter((r) => r !== top).map(label).join(", ")} there` : ""].filter(Boolean).join(" · "), href: eventHref(top.season, top.code, team.number) },
      blocks: [table(there, team.number, there.length > 1 ? "Every award at that event" : "The award")],
      definition: def,
    };
  }
  if (opts.award) {
    // A performance award once per event (FIRST lists each of the alliance's slots).
    const xs = PERFORMANCE.has(opts.award) ? [...new Map(rows.map((r) => [`${r.season}|${r.code}`, r])).values()] : rows;
    const name = awardName(opts.award), title = `${awardsTitle(id, opts)}${where}`;
    const def = `${name}: as the events' published awards list it, every placement (2nd and 3rd included, said so). ${KIND_RULE}`;
    if (!xs.length) return { ...base, family: "awards", intent: id, title, blocks: [{ kind: "related", title: "Their awards", queries: [`${team.number} awards`] }], definition: def, none: `No ${name} found for ${who}${where} in the published awards${checked}.` };
    const one = xs.length === 1 ? xs[0] : null;
    return {
      ...base, family: "awards", intent: id, title,
      headline: one ? { value: label(one), label: one.name, sub: [seasonLabel(one.season), dateRange(one.start, one.end)].filter(Boolean).join(" · "), href: eventHref(one.season, one.code, team.number) }
        : { value: count(xs.length, opts.award === "Winner" ? "Winning Alliance" : name, opts.award === "Winner" ? "Winning Alliances" : `${name}s`), label: `at ${count(new Set(xs.map((r) => `${r.season}|${r.code}`)).size, "event")}`, sub: "Every one below, newest first" },
      blocks: [table(xs, team.number, "Newest first")], definition: def,
    };
  }

  if (id === "event-wins") {
    const wins = rows.filter((r) => r.type === "Winner");
    // One Winning Alliance row per event (FIRST lists each of its teams' slots).
    const firsts = [...new Map(wins.map((r) => [`${r.season}|${r.code}`, r])).values()];
    const inspire = rows.filter((r) => r.type === "Inspire" && r.placement === 1);
    const both = [...firsts, ...inspire].sort((a, b) => String(b.start).localeCompare(String(a.start)) || (a.type === "Winner" ? -1 : 1));
    const title = `Event wins${where}`;
    if (!both.length) return { ...base, family: "awards", intent: id, title, blocks: [], definition: WINS_RULE, none: `None found: no 1st-place finishes and no Inspire Awards${where} for ${who} in the published awards.` };
    return {
      ...base, family: "awards", intent: id, title,
      headline: { value: count(both.length, "win"), label: `${count(firsts.length, "1st-place finish", "1st-place finishes")} · ${count(inspire.length, "Inspire Award")}`, sub: opts.count ? undefined : "Every one below, newest first" },
      blocks: [
        { kind: "kpis", items: [{ label: "1st-place finishes", value: String(firsts.length), sub: "Winning Alliance", tone: "good" }, { label: "Inspire Award", value: String(inspire.length), tone: "accent" }] },
        table(both, team.number, "Each win, labelled"),
      ],
      definition: WINS_RULE,
    };
  }
  if (id === "inspire-awards" || id === "finalist-finishes") {
    const inspire = id === "inspire-awards";
    const xs = rows.filter((r) => r.type === (inspire ? "Inspire" : "Finalist"));
    const firsts = inspire ? xs.filter((r) => r.placement === 1) : [...new Map(xs.map((r) => [`${r.season}|${r.code}`, r])).values()];
    const title = `${inspire ? "Inspire Awards" : "Finalist finishes"}${where}`;
    const def = inspire ? "Inspire Award: 1st-place Inspire at an event (2nd- and 3rd-place Inspire are listed and counted apart). From the events' published awards." : "A finalist finish: the team was on the event's Finalist Alliance (one per event). From the events' published awards.";
    if (!xs.length) return { ...base, family: "awards", intent: id, title, blocks: [], definition: def, none: `No ${inspire ? "Inspire Awards" : "finalist finishes"}${where} found for ${who} in the published awards.` };
    return {
      ...base, family: "awards", intent: id, title,
      headline: { value: count(firsts.length, inspire ? "Inspire Award" : "finalist finish", inspire ? "Inspire Awards" : "finalist finishes"), label: inspire && xs.length > firsts.length ? `plus ${count(xs.length - firsts.length, "2nd- or 3rd-place Inspire", "2nd- or 3rd-place Inspires")}` : `at ${count(firsts.length, "event")}` },
      blocks: [table(inspire ? xs : firsts, team.number, "Newest first")], definition: def,
    };
  }
  const title = id === "award-split" ? `Judged and performance awards${where}` : id === "total-awards" ? `All awards${where}` : `Awards${where}`;
  if (!rows.length) return { ...base, family: "awards", intent: id, title, blocks: [], definition: KIND_RULE, none: `No awards${where} found for ${who} in the published awards.` };
  const groups = ["Performance", "Judged", "Individual"].map((k) => ({ k, xs: rows.filter((r) => kindOf(r.type) === k) }));
  const types = [...new Set(rows.map((r) => r.type))].map((t) => ({ t, n: rows.filter((r) => r.type === t).length })).sort((a, b) => b.n - a.n);
  const blocks: StatBlock[] = [
    { kind: "bars", title: id === "award-split" ? "By kind" : "By award", groups: [{ label: "Awards", items: id === "award-split" ? groups.map((g, i) => ({ label: g.k, value: g.xs.length, tone: (["a", "b", "c"] as const)[i] })) : types.slice(0, 8).map((x) => ({ label: awardLabel(x.t, 1).replace(/ Award$/, ""), value: x.n, tone: "a" as const })) }] },
  ];
  if (id === "award-split") blocks.push(...groups.filter((g) => g.xs.length).map((g) => table(g.xs, team.number, `${g.k} awards`)));
  else {
    // Every award, grouped by season, newest first: each season's own table (the season is its title, so not a column).
    const shown = rows.slice(0, 50);
    for (const season of [...new Set(shown.map((r) => r.season))]) {
      const xs = shown.filter((r) => r.season === season), all = rows.filter((r) => r.season === season).length;
      const t = table(xs, team.number, `${seasonLabel(season)} · ${count(all, "award")}`);
      if (t.kind === "table") t.columns = t.columns.filter((c) => c.key !== "season");
      blocks.push(t);
    }
    const last = blocks[blocks.length - 1];
    if (rows.length > 50 && last.kind === "table") last.more = `Showing the newest 50 of ${rows.length} awards`;
  }
  return {
    ...base, family: "awards", intent: id, title,
    headline: { value: count(rows.length, "award"), label: groups.filter((g) => g.xs.length).map((g) => `${g.xs.length} ${g.k.toLowerCase()}`).join(" · "), sub: `at ${count(events, "event")}` },
    blocks, definition: KIND_RULE,
  };
}
