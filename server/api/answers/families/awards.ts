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

interface AwardRow { season: number; code: string; name: string; type: string; placement: number; start: string | null; end: string | null }

const WINS_RULE = "Won an event: two kinds of win, listed apart. 1st place means the team was on the event's Winning Alliance (FIRST's Winning Alliance award); the Inspire Award is the event's top judged award (1st-place Inspire). Both from the event's published awards.";
const KIND_RULE = "Performance awards: Winning and Finalist Alliance. Individual awards: Dean's List, Compass and Volunteer. Every other award is a judged team award. From the events' published awards.";

/** The team's awards in the scope, newest first (one query, on awards_team): all of them, so every count is whole; the
 *  tables show the first 50. */
async function awardRows(team: number, scope: Scope): Promise<AwardRow[]> {
  const w = eventSql(scope);
  return all<AwardRow>(
    `SELECT a.season, a.code, e.name, e.type event_type, a.type award, a.placement, e.start, e.end FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code
     WHERE a.team = ? AND ${w.sql} ORDER BY e.start DESC, a.code, a.type = 'Winner' DESC, a.type = 'Inspire' DESC, a.placement`,
    [team, ...w.args]).then((rs) => rs.map((r: any) => ({ season: Number(r.season), code: r.code, name: shortEvent(r.name, r.event_type ?? null), type: r.award, placement: Number(r.placement), start: r.start, end: r.end })));
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

/** The answer for an awards intent, or null when `id` isn't one. */
export async function awardsAnswer(id: IntentId, team: AnswerTeam, scope: Scope, opts: { count: boolean }): Promise<StatAnswer | null> {
  if (!["event-wins", "inspire-awards", "finalist-finishes", "total-awards", "award-split", "awards"].includes(id)) return null;
  const rows = await awardRows(team.number, scope);
  const who = whoOf(team), where = scopePhrase(scope);
  const events = new Set(rows.map((r) => `${r.season}|${r.code}`)).size;
  const base = { team, scope: scopeChips(scope), source: rows.length ? `From ${count(rows.length, "award record")} at ${count(events, "event")}` : "No awards in this scope" };

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
  else blocks.push(table(rows, team.number, "Newest first", true));
  return {
    ...base, family: "awards", intent: id, title,
    headline: { value: count(rows.length, "award"), label: groups.filter((g) => g.xs.length).map((g) => `${g.xs.length} ${g.k.toLowerCase()}`).join(" · "), sub: `at ${count(events, "event")}` },
    blocks, definition: KIND_RULE,
  };
}
