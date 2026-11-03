// Families 3 and 4 over a team's matches (../matchSet.ts), filtered by the scope clauses (../clauses.ts):
//   superlative  one best or worst match (one scan, a different order per intent)
//   aggregate    a count, a mean, a record or a streak
// The rules every answer below states:
//   Highest/lowest score: the alliance's points without penalties (fouls the other alliance committed aren't the
//     alliance's own points; the score with them is shown beside it), in a match the team was on the field for, at an
//     official event (qualifiers, league play, championships, premier events; never scrimmages or off-season events).
//     The same rule as the season records (server/api/searchHighScores.ts).
//   Results, records, margins and streaks: the official result (scores with penalties), counted by the site's one
//     record rule (src/shared/eventRecord.ts: playoffs included, a qualification surrogate match not).
//   Blowout: a win by at least double the other alliance's score, and by 20 points or more.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { RECORD_RULE } from "../../../../src/shared/eventRecord.js";
import { inScope, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import { eventHref, matchRow, teamLinks, type TeamMatch } from "../matchSet.js";
import type { IntentId } from "../read.js";

export interface AnswerTeam { number: number; name: string | null }
export const whoOf = (t: AnswerTeam) => (t.name ? `${t.name} (${t.number})` : `Team ${t.number}`);

const SCORE_RULE = "Highest and lowest scores are the alliance's own points without penalties (the score with penalties beside it), in matches the team was on the field for, at official events: qualifiers, league play, championships and premier events, never scrimmages or off-season events.";
const RESULT_RULE = `Results use the official scores, penalties included. ${RECORD_RULE}`;
export const BLOWOUT = { factor: 2, min: 20 };
const LIST_CAP = 25;

/** "214 matches at 31 events, 2023–24 to 2025–26". */
export function sourceOf(ms: TeamMatch[]): string {
  if (!ms.length) return "No matches in this scope";
  const events = new Set(ms.map((m) => `${m.season}|${m.code}`)).size;
  const seasons = [...new Set(ms.map((m) => m.season))].sort();
  const span = seasons.length === 1 ? seasonLabel(seasons[0]) : `${seasonLabel(seasons[0])} to ${seasonLabel(seasons[seasons.length - 1])}`;
  return `From ${ms.length} match record${ms.length === 1 ? "" : "s"} at ${events} event${events === 1 ? "" : "s"}, ${span}`;
}

const record = (ms: TeamMatch[]) => ({ wins: ms.filter((m) => m.result === "W").length, losses: ms.filter((m) => m.result === "L").length, ties: ms.filter((m) => m.result === "T").length });
const recText = (r: { wins: number; losses: number; ties: number }) => `${r.wins}-${r.losses}-${r.ties}`;
const pct = (r: { wins: number; losses: number; ties: number }) => { const n = r.wins + r.losses + r.ties; return n ? `${Math.round((100 * r.wins) / n)}%` : "–"; };
const newestFirst = (ms: TeamMatch[]) => [...ms].reverse();
const np = (m: TeamMatch) => m.ownNp ?? m.own;
const bySeason = (ms: TeamMatch[]) => { const g = new Map<number, TeamMatch[]>(); for (const m of ms) g.set(m.season, [...(g.get(m.season) ?? []), m]); return [...g.entries()].sort((a, b) => b[0] - a[0]); };

/** The per-season record table, newest first. */
function seasonTable(ms: TeamMatch[], title = "By season"): StatBlock {
  return {
    kind: "table", title,
    columns: [{ key: "season", label: "Season" }, { key: "record", label: "W-L-T" }, { key: "rate", label: "Win rate", num: true }, { key: "n", label: "Matches", num: true }],
    rows: bySeason(ms).map(([s, xs]) => { const r = record(xs); return { cells: { season: seasonLabel(s), record: recText(r), rate: pct(r), n: xs.length } }; }),
  };
}

/** Which matches an intent reads: scored ones for scores (the team on the field), counted ones for results. */
function pool(id: IntentId, all: TeamMatch[], scope: Scope): TeamMatch[] {
  const keep = inScope(scope);
  const scores = id === "highest-score" || id === "lowest-score" || id === "average-score";
  return all.filter((m) => keep(m) && (scores ? m.onField : m.counted));
}

/** The answer for a match-set intent, or null when `id` isn't one of these families' match intents. */
export async function matchAnswer(id: IntentId, team: AnswerTeam, all: TeamMatch[], scope: Scope, opts: { leadEvent?: boolean; n?: number | null }): Promise<StatAnswer | null> {
  const ms = pool(id, all, scope);
  const who = whoOf(team), where = scopePhrase(scope);
  const base = { team, scope: scopeChips(scope), source: sourceOf(ms) };
  const links = await teamLinks(ms.flatMap((m) => [...m.partners, ...m.opponents]).slice(0, 2000));
  const row = (m: TeamMatch) => matchRow(m, links, team.number);
  const none = (what: string) => `No ${what}${where} found for ${who} in the recorded matches.`;
  const matchesBlock = (title: string, xs: TeamMatch[], more?: string): StatBlock => ({ kind: "matches", title, rows: xs.slice(0, LIST_CAP).map(row), ...(xs.length > LIST_CAP ? { more: more ?? `Showing ${LIST_CAP} of ${xs.length}` } : {}) });

  switch (id) {
    case "highest-score":
    case "lowest-score": {
      const high = id === "highest-score";
      const sorted = [...ms].sort((a, b) => (high ? np(b) - np(a) || b.own - a.own : np(a) - np(b) || a.own - b.own) || String(a.date).localeCompare(String(b.date)));
      const top = sorted[0];
      const title = high ? (opts.leadEvent ? `Event with the highest score${where}` : `Highest score${where}`) : `Lowest score${where}`;
      if (!top) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: SCORE_RULE, none: scope.championship ? `No Worlds matches found for ${who}.` : none("matches") };
      const r = row(top);
      const blocks: StatBlock[] = [
        { kind: "kpis", items: [
          { label: high ? "Score (no penalties)" : "Score (no penalties)", value: String(np(top)), tone: "accent", href: r.href },
          { label: "With penalties", value: String(top.own) },
          { label: "Result", value: `${top.result === "W" ? "Won" : top.result === "L" ? "Lost" : "Tied"} ${top.own}–${top.opp}`, tone: top.result === "W" ? "good" : top.result === "L" ? "bad" : undefined },
        ] },
        matchesBlock(high ? "Best scores" : "Lowest scores", sorted.slice(0, 5)),
      ];
      // Each season is a different game: its best (or worst) beside the others, never compared as one record.
      if (scope.season == null) {
        const per = bySeason(ms).map(([s, xs]) => ({ s, m: [...xs].sort((a, b) => (high ? np(b) - np(a) : np(a) - np(b)))[0] }));
        if (per.length > 1) blocks.push({ kind: "table", title: `${high ? "Best" : "Lowest"} score each season (each season is a different game)`, columns: [{ key: "season", label: "Season" }, { key: "score", label: "Score", num: true }, { key: "match", label: "Match" }, { key: "event", label: "Event" }], rows: per.map(({ s, m }) => ({ cells: { season: seasonLabel(s), score: np(m), match: m.label, event: m.event }, href: row(m).href, strong: m === top })) });
      }
      return {
        ...base, family: "superlative", intent: id, title,
        headline: opts.leadEvent
          ? { value: top.event, label: `${np(top)} points in ${top.label}`, sub: [seasonLabel(top.season), r.date].filter(Boolean).join(" · "), href: eventHref(top.season, top.code, team.number) }
          : { value: `${np(top)} points`, label: `${top.label} at ${top.event}`, sub: [seasonLabel(top.season), r.date, `${top.alliance === "red" ? "Red" : "Blue"} alliance`].filter(Boolean).join(" · "), href: r.href },
        blocks, definition: SCORE_RULE,
      };
    }

    case "biggest-win":
    case "biggest-loss":
    case "closest-match": {
      const margin = (m: TeamMatch) => m.own - m.opp;
      const xs = id === "biggest-win" ? ms.filter((m) => m.result === "W").sort((a, b) => margin(b) - margin(a))
        : id === "biggest-loss" ? ms.filter((m) => m.result === "L").sort((a, b) => margin(a) - margin(b))
        : [...ms].sort((a, b) => Math.abs(margin(a)) - Math.abs(margin(b)) || String(b.date).localeCompare(String(a.date)));
      const title = id === "biggest-win" ? `Biggest win${where}` : id === "biggest-loss" ? `Biggest loss${where}` : `Closest match${where}`;
      const top = xs[0];
      const def = `${id === "closest-match" ? "Closest: the smallest gap between the two alliances' scores (a tie is 0); the latest first on equal gaps." : "Margin: the gap between the two alliances' official scores."} ${RESULT_RULE}`;
      if (!top) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: def, none: none(id === "biggest-win" ? "wins" : id === "biggest-loss" ? "losses" : "matches") };
      return {
        ...base, family: "superlative", intent: id, title,
        headline: { value: `${Math.abs(margin(top))} point${Math.abs(margin(top)) === 1 ? "" : "s"}`, label: `${top.own}–${top.opp} in ${top.label} at ${top.event}`, sub: [seasonLabel(top.season), row(top).date].filter(Boolean).join(" · "), href: row(top).href },
        blocks: [matchesBlock(id === "closest-match" ? "Closest matches" : id === "biggest-win" ? "Biggest wins" : "Biggest losses", xs.slice(0, 5))],
        definition: def,
      };
    }

    case "first-match":
    case "recent-match": {
      const m = id === "first-match" ? ms[0] : ms[ms.length - 1];
      const title = id === "first-match" ? `First match${where}` : `Most recent match${where}`;
      if (!m) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: RESULT_RULE, none: none("matches") };
      const near = id === "first-match" ? ms.slice(0, 5) : newestFirst(ms).slice(0, 5);
      return {
        ...base, family: "superlative", intent: id, title,
        headline: { value: `${m.result === "W" ? "Won" : m.result === "L" ? "Lost" : "Tied"} ${m.own}–${m.opp}`, label: `${m.label} at ${m.event}`, sub: [seasonLabel(m.season), row(m).date].filter(Boolean).join(" · "), href: row(m).href },
        blocks: [matchesBlock(id === "first-match" ? "First matches" : "Latest matches", near)], definition: RESULT_RULE,
      };
    }

    case "wins-count":
    case "record":
    case "red-blue-record":
    case "total-matches": {
      const r = record(ms);
      const title = id === "wins-count" ? `Match wins${where}` : id === "total-matches" ? `Matches played${where}` : id === "red-blue-record" ? `Record by alliance colour${where}` : `Record${where}`;
      if (!ms.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: RESULT_RULE, none: scope.championship ? `No Worlds matches found for ${who}.` : none("matches") };
      const seasons = [...new Set(ms.map((m) => m.season))].sort();
      const blocks: StatBlock[] = [];
      if (id === "red-blue-record") {
        const red = record(ms.filter((m) => m.alliance === "red")), blue = record(ms.filter((m) => m.alliance === "blue"));
        blocks.push({ kind: "record", title: "On red", ...red }, { kind: "record", title: "On blue", ...blue },
          { kind: "bars", title: "Win rate by colour", unit: "%", groups: [{ label: "Win rate", items: [{ label: "Red", value: rate(red), tone: "a" }, { label: "Blue", value: rate(blue), tone: "b" }] }] });
      } else blocks.push({ kind: "record", title: "Wins, losses and ties", ...r });
      if (seasons.length > 1 || id !== "record") blocks.push(seasonTable(ms));
      if (scope.championship) blocks.push(eventTable(ms, "Worlds events"));
      const headline = id === "wins-count" ? { value: `${r.wins} win${r.wins === 1 ? "" : "s"}`, label: `in ${ms.length} match${ms.length === 1 ? "" : "es"}${where}`, sub: seasonsText(seasons) }
        : id === "total-matches" ? { value: `${ms.length} match${ms.length === 1 ? "" : "es"}`, label: `played${where}`, sub: `${recText(r)} · ${seasonsText(seasons)}` }
        : id === "red-blue-record" ? { value: `${recText(record(ms.filter((m) => m.alliance === "red")))} red · ${recText(record(ms.filter((m) => m.alliance === "blue")))} blue`, label: `${ms.length} matches${where}`, sub: seasonsText(seasons) }
        : { value: recText(r), label: `${pct(r)} win rate in ${ms.length} match${ms.length === 1 ? "" : "es"}${where}`, sub: seasonsText(seasons) };
      return { ...base, family: "aggregate", intent: id, title, headline, blocks, definition: RESULT_RULE };
    }

    case "average-score": {
      const title = `Average score${where}`;
      const def = "Average score: the mean of the alliance's points without penalties in every match the team was on the field for, at official events (the mean with penalties beside it).";
      if (!ms.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const events = new Map<string, TeamMatch[]>();
      for (const m of ms) events.set(`${m.season}|${m.code}`, [...(events.get(`${m.season}|${m.code}`) ?? []), m]);
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: mean(ms.map(np)).toFixed(1), label: `points a match (no penalties), over ${ms.length} match${ms.length === 1 ? "" : "es"}`, sub: scope.season != null ? seasonLabel(scope.season) : "All seasons" },
        blocks: [
          { kind: "kpis", items: [{ label: "With penalties", value: mean(ms.map((m) => m.own)).toFixed(1) }, { label: "Best", value: String(Math.max(...ms.map(np))) }, { label: "Lowest", value: String(Math.min(...ms.map(np))) }] },
          { kind: "series", title: "Average by event", unit: "points", points: [...events.values()].map((xs) => ({ x: xs[0].event, y: Number(mean(xs.map(np)).toFixed(1)), href: eventHref(xs[0].season, xs[0].code, team.number), note: `${xs.length} matches` })) },
        ],
        definition: def,
      };
    }

    case "current-streak":
    case "longest-streak": {
      const title = id === "current-streak" ? `Current streak${where}` : `Longest win streak${where}`;
      const def = `A streak: matches in a row with the same result, in date order across events and seasons (a tie ends it). ${RESULT_RULE}`;
      if (!ms.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      let run: TeamMatch[] = [];
      if (id === "current-streak") {
        const last = ms[ms.length - 1];
        for (let i = ms.length - 1; i >= 0 && ms[i].result === last.result; i--) run.unshift(ms[i]);
        if (last.result === "T") run = [last];
      } else {
        let cur: TeamMatch[] = [];
        for (const m of ms) { if (m.result === "W") { cur.push(m); if (cur.length > run.length) run = [...cur]; } else cur = []; }
      }
      if (!run.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: `${who} has no match wins${where} on record.` };
      const kind = run[0].result === "W" ? "win" : run[0].result === "L" ? "loss" : "tie";
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: `${run.length} ${kind === "win" ? "win" : kind === "loss" ? "loss" : "tie"}${run.length === 1 ? "" : kind === "loss" ? "es" : "s"}`, label: id === "current-streak" ? "in a row, up to the latest match" : "in a row, the longest on record", sub: `${run[0].label} at ${run[0].event} to ${run[run.length - 1].label} at ${run[run.length - 1].event}` },
        blocks: [matchesBlock("Matches in the streak", newestFirst(run))], definition: def,
      };
    }

    case "last-matches": {
      const n = opts.n ?? 5, xs = newestFirst(ms).slice(0, n);
      const title = `Last ${n} matches${where}`;
      if (!xs.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: RESULT_RULE, none: none("matches") };
      const r = record(xs);
      return { ...base, family: "aggregate", intent: id, title, headline: { value: recText(r), label: `in the last ${xs.length} matches`, sub: xs.map((m) => m.result).join(" ") }, blocks: [matchesBlock("Newest first", xs)], definition: RESULT_RULE };
    }

    case "blowout-wins":
    case "losses":
    case "playoff-matches":
    case "qual-matches": {
      const xs = id === "blowout-wins" ? ms.filter((m) => m.result === "W" && m.own >= BLOWOUT.factor * m.opp && m.own - m.opp >= BLOWOUT.min)
        : id === "losses" ? ms.filter((m) => m.result === "L")
        : ms.filter((m) => m.level === (id === "playoff-matches" ? "playoff" : "qual"));
      const title = id === "blowout-wins" ? `Blowout wins${where}` : id === "losses" ? `Losses${where}` : id === "playoff-matches" ? `Playoff matches${where}` : `Qualification matches${where}`;
      const def = id === "blowout-wins" ? `Blowout: a win by at least double the other alliance's score, and by ${BLOWOUT.min} points or more. ${RESULT_RULE}` : RESULT_RULE;
      if (!xs.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none(id === "blowout-wins" ? "blowout wins" : id === "losses" ? "losses" : id === "playoff-matches" ? "playoff matches" : "qualification matches") };
      const r = record(xs);
      const blocks: StatBlock[] = [];
      if (id === "playoff-matches" || id === "qual-matches") blocks.push({ kind: "record", title: "Wins, losses and ties", ...r });
      blocks.push(matchesBlock("Newest first", newestFirst(xs)));
      return { ...base, source: sourceOf(xs), family: "aggregate", intent: id, title, headline: { value: String(xs.length), label: `${title.toLowerCase().replace(where.toLowerCase(), "")}${id === "playoff-matches" || id === "qual-matches" ? ` · ${recText(r)}` : ""}`, sub: `of ${ms.length} matches${where}` }, blocks, definition: def };
    }

    case "playoff-appearances": {
      const evs = new Map<string, TeamMatch[]>();
      for (const m of ms) if (m.level === "playoff") evs.set(`${m.season}|${m.code}`, [...(evs.get(`${m.season}|${m.code}`) ?? []), m]);
      const title = `Playoff appearances${where}`;
      const def = "A playoff appearance: an event where the team played at least one playoff (elimination) match on the field.";
      const all = new Set(ms.map((m) => `${m.season}|${m.code}`)).size;
      if (!evs.size) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("playoff matches") };
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: `${evs.size} event${evs.size === 1 ? "" : "s"}`, label: `with playoff matches, of ${all} event${all === 1 ? "" : "s"} played${where}` },
        blocks: [{
          kind: "table", title: "Playoff runs, newest first", columns: [{ key: "event", label: "Event" }, { key: "season", label: "Season" }, { key: "record", label: "Playoff W-L-T" }],
          rows: [...evs.values()].reverse().slice(0, LIST_CAP).map((xs) => ({ cells: { event: xs[0].event, season: seasonLabel(xs[0].season), record: recText(record(xs)) }, href: eventHref(xs[0].season, xs[0].code, team.number) })),
        }],
        definition: def,
      };
    }
    default:
      return null;
  }
}

const rate = (r: { wins: number; losses: number; ties: number }) => { const n = r.wins + r.losses + r.ties; return n ? Math.round((100 * r.wins) / n) : null; };
const seasonsText = (ss: number[]) => (ss.length === 1 ? seasonLabel(ss[0]) : `${ss.length} seasons: ${ss.map(seasonLabel).join(", ")}`);

/** Per event: its record (newest first), each a link to the event on the team. */
function eventTable(ms: TeamMatch[], title: string): StatBlock {
  const evs = new Map<string, TeamMatch[]>();
  for (const m of ms) evs.set(`${m.season}|${m.code}`, [...(evs.get(`${m.season}|${m.code}`) ?? []), m]);
  return {
    kind: "table", title, columns: [{ key: "event", label: "Event" }, { key: "season", label: "Season" }, { key: "record", label: "W-L-T" }, { key: "n", label: "Matches", num: true }],
    rows: [...evs.values()].reverse().map((xs) => ({ cells: { event: xs[0].event, season: seasonLabel(xs[0].season), record: recText(record(xs)), n: xs.length }, href: eventHref(xs[0].season, xs[0].code) })),
  };
}

