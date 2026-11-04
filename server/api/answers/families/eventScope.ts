// Family 5: one team at one event ("4215 results at New Jersey Championship", "… rank at …", "… OPR at …", "… score in
// match 12 at …"). The match set filtered by the event clause (../clauses.ts) and the team page's own event row
// (../eventSet.ts); families 3 and 4 take an event scope the same way ("4215 record at …", "4215 highest score at …").
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { RECORD_RULE } from "../../../../src/shared/eventRecord.js";
import { dateRange, place, possessive, seasonLabel } from "../../../../src/shared/format.js";
import { inScope, scopeChips, type Scope } from "../clauses.js";
import type { TeamEvent } from "../eventSet.js";
import { eventHref, matchRow, teamLinks, type TeamMatch } from "../matchSet.js";
import type { IntentId } from "../read.js";
import { sourceOf, whoOf, type AnswerTeam } from "./matches.js";

const RANK_RULE = "Rank: the team's qualification rank at the event, out of the teams ranked there (at a league meet, the league's running standing).";
const OPR_RULE = "OPR at the event: the team's offensive power rating there without penalties, and its auto, TeleOp and endgame parts, as its team page shows (computed by the stats job, not here).";

const rec = (ms: TeamMatch[]) => ({ wins: ms.filter((m) => m.result === "W").length, losses: ms.filter((m) => m.result === "L").length, ties: ms.filter((m) => m.result === "T").length });

/** "4215 matches at worlds in 2025": the team's matches at the FIRST Championship (its division and the finals), in
 *  the season asked for or every season, with their scores. None in that season: said so, with the seasons it did play. */
export async function worldsMatchesAnswer(team: AnswerTeam, all: TeamMatch[], scope: Scope): Promise<StatAnswer> {
  const keep = inScope(scope);
  const ms = all.filter((m) => keep(m) && m.counted);
  const who = whoOf(team);
  const when = scope.season != null ? ` in ${seasonLabel(scope.season)} (the ${scope.season + 1} FIRST Championship)` : "";
  const title = `Matches at Worlds${scope.season != null ? ` in ${seasonLabel(scope.season)}` : ""}`;
  const def = `Worlds: the FIRST Championship, its divisions and its finals. A year names when the championship was held: the 2025 one is the 2024–25 season's. ${RECORD_RULE}`;
  const base = { team, scope: scopeChips(scope), source: ms.length ? sourceOf(ms) : "No Worlds matches in this scope" };
  if (!ms.length) {
    const other = [...new Set(all.filter((m) => inScope({ ...scope, season: null })(m) && m.counted).map((m) => m.season))].sort((a, b) => b - a);
    return {
      ...base, family: "event", intent: "results", title, blocks: other.length ? [{ kind: "related", title: "Worlds seasons on record", queries: other.map((s) => `${team.number} matches at worlds ${seasonLabel(s)}`) }] : [], definition: def,
      none: `No Worlds matches found for ${who}${when}.${other.length ? ` Its Worlds matches on record are from ${other.map(seasonLabel).join(", ")}.` : " It has no Worlds matches on record."}`,
    };
  }
  const links = await teamLinks(ms.flatMap((m) => [...m.partners, ...m.opponents]));
  const r = rec(ms);
  return {
    ...base, family: "event", intent: "results", title,
    headline: { value: `${r.wins}-${r.losses}-${r.ties}`, label: `in ${ms.length} match${ms.length === 1 ? "" : "es"} at Worlds${scope.season != null ? ` in ${seasonLabel(scope.season)}` : ""}`, sub: [...new Set(ms.map((m) => m.event))].join(" · ") },
    blocks: [{ kind: "record", title: "Wins, losses and ties", ...r }, { kind: "matches", title: "Matches in order", rows: ms.slice(0, 40).map((m) => matchRow(m, links, team.number)) }],
    definition: def,
  };
}

/** The answer for an event intent, or null when `id` isn't one. `scope.event` is set. */
export async function eventScopeAnswer(id: IntentId, team: AnswerTeam, all: TeamMatch[], ev: TeamEvent | undefined, scope: Scope, opts: { n: number | null; each?: TeamEvent[] }): Promise<StatAnswer | null> {
  if (!scope.event || !["results", "event-rank", "event-opr", "match-lookup"].includes(id)) return null;
  const keep = inScope(scope);
  // The record counts official results; one match's score is any match the team played on the field (a surrogate too).
  const ms = all.filter((m) => keep(m) && (id === "match-lookup" ? m.onField : m.counted));
  const who = whoOf(team), name = scope.event.name;
  const base = { team, scope: scopeChips(scope), source: ms.length ? sourceOf(ms) : "From the event's published rankings" };
  const links = await teamLinks(ms.flatMap((m) => [...m.partners, ...m.opponents]));
  const row = (m: TeamMatch) => matchRow(m, links, team.number);
  const where = [seasonLabel(scope.event.season), ev ? dateRange(ev.start, ev.end) : "", ev ? place(ev.city, ev.state) : ""].filter(Boolean).join(" · ");
  const href = eventHref(scope.event.season, scope.event.code, team.number);
  const rankText = ev?.rank != null ? `#${ev.rank}${ev.of ? ` of ${ev.of}` : ""}` : "–";
  const r = rec(ms);
  const kpis: StatBlock = { kind: "kpis", items: [
    { label: "Rank", value: rankText, href },
    { label: "Record", value: ms.length ? `${r.wins}-${r.losses}-${r.ties}` : "–" },
    { label: "OPR", value: ev?.opr != null ? ev.opr.toFixed(1) : "–" },
  ] };

  // Several events read as one (a division and its finals): each one's record, rank and OPR, as the team page lists them.
  const each: StatBlock[] = (opts.each?.length ?? 0) > 1 ? [{ kind: "table", title: "Each event", columns: [{ key: "event", label: "Event" }, { key: "record", label: "Record" }, { key: "rank", label: "Rank" }, { key: "opr", label: "OPR", num: true }],
    rows: opts.each!.map((e) => { const x = rec(ms.filter((m) => m.code === e.code)); return { cells: { event: e.name, record: `${x.wins}-${x.losses}-${x.ties}`, rank: e.rank != null ? `#${e.rank}${e.of ? ` of ${e.of}` : ""}` : "–", opr: e.opr != null ? e.opr.toFixed(1) : "–" }, href: eventHref(e.season, e.code, team.number), strong: e.code === ev?.code }; }) }] : [];

  if (id === "match-lookup") {
    const n = opts.n ?? 0;
    // A qualification number first ("match 12" is Q12 at most events), else a playoff match with that number.
    // Several events read as one (an AM and a PM meet) can each have a match with that number: each event's, never a pick.
    const pickAt = (xs: TeamMatch[]) => xs.find((x) => x.level === "qual" && x.number === n) ?? xs.find((x) => x.label.toUpperCase() === `M${n}` || x.label.toUpperCase() === `Q${n}`);
    const found = [...new Set(ms.map((x) => x.code))].map((c) => pickAt(ms.filter((x) => x.code === c))).filter((x): x is TeamMatch => !!x);
    const m = found[0];
    const title = `Match ${n} at ${name}`;
    if (found.length > 1) return { ...base, family: "event", intent: id, title, blocks: [{ kind: "matches", title: `Match ${n} at each event`, rows: found.map(row) }], definition: `Scores are the official result, penalties included. ${RECORD_RULE}` };
    if (!m) return { ...base, family: "event", intent: id, title, blocks: ms.length ? [{ kind: "matches", title: `${possessive(String(team.name ?? team.number))} matches there`, rows: ms.slice(0, 25).map(row) }] : [], definition: RECORD_RULE, none: `${who} didn't play a match ${n} at ${name}: its own matches there are listed below.` };
    return {
      ...base, family: "event", intent: id, title,
      headline: { value: `${m.result === "W" ? "Won" : m.result === "L" ? "Lost" : "Tied"} ${m.own}–${m.opp}`, label: `${m.label} at ${name}`, sub: [row(m).date, `${m.alliance === "red" ? "Red" : "Blue"} alliance`, m.ownNp != null && m.ownNp !== m.own ? `${m.ownNp} without penalties` : ""].filter(Boolean).join(" · "), href: row(m).href },
      blocks: [{ kind: "matches", title: "The match", rows: [row(m)] }], definition: `Scores are the official result, penalties included. ${RECORD_RULE}`,
    };
  }
  if (id === "event-opr") {
    const title = `OPR at ${name}`;
    if (ev?.opr == null) return { ...base, family: "event", intent: id, title, blocks: [kpis], definition: OPR_RULE, none: `No OPR at ${name} for ${who}: it needs scored matches there.` };
    return {
      ...base, family: "event", intent: id, title,
      headline: { value: `OPR ${ev.opr.toFixed(1)}`, label: name, sub: where, href },
      blocks: [kpis, { kind: "bars", title: "By phase", groups: [{ label: name, items: [{ label: "Auto", value: ev.auto, tone: "a" }, { label: "TeleOp", value: ev.teleop, tone: "b" }, { label: "Endgame", value: ev.endgame, tone: "c" }] }] }, ...each],
      definition: OPR_RULE,
    };
  }
  const title = id === "event-rank" ? `Rank at ${name}` : `Results at ${name}`;
  if (id === "event-rank" && ev?.rank == null) return { ...base, family: "event", intent: id, title, blocks: [kpis], definition: RANK_RULE, none: `No rank at ${name} is published for ${who} yet.` };
  if (id === "results" && !ms.length) return { ...base, family: "event", intent: id, title, blocks: [kpis], definition: RECORD_RULE, none: `No scored matches at ${name} for ${who} yet.` };
  return {
    ...base, family: "event", intent: id, title,
    headline: id === "event-rank" ? { value: rankText, label: name, sub: where, href } : { value: `${r.wins}-${r.losses}-${r.ties}`, label: `in ${ms.length} match${ms.length === 1 ? "" : "es"} at ${name}`, sub: [ev?.rank != null ? `Ranked ${rankText}` : "", where].filter(Boolean).join(" · "), href },
    blocks: [kpis, { kind: "record", title: "Wins, losses and ties", ...r }, ...each, ...(ms.length ? [{ kind: "matches" as const, title: "Matches in order", rows: ms.slice(0, 40).map(row) }] : [])],
    definition: `${RANK_RULE} ${RECORD_RULE}`,
  };
}
