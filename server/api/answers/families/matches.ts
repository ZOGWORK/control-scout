// Families 3 and 4 over a team's matches (../matchSet.ts), filtered by the scope clauses (../clauses.ts):
//   superlative  one best or worst match (one scan, a different order per intent)
//   aggregate    a count, a mean, a record or a streak
// The rules every answer below states:
//   Scores: the alliance's official score, penalties included, as the team page's match list and its "avg alliance
//     score" show it (the score without penalties beside it), in a match the team was on the field for, at an official
//     event (qualifiers, league play, championships, premier events; never scrimmages or off-season events).
//   Highest/lowest score: the match is picked by the alliance's own points (without penalties, as the season records
//     in server/api/searchHighScores.ts: another alliance's fouls never make a record), and shown at its official
//     score. A higher official score made by fouls is shown beside it, said so.
//   Results, records, margins and streaks: the official result (scores with penalties), counted by the site's one
//     record rule (src/shared/eventRecord.ts: playoffs included, a qualification surrogate match not).
//   Blowout: a win by at least double the other alliance's score, and by 20 points or more.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { RECORD_RULE } from "../../../../src/shared/eventRecord.js";
import { RANKED_MIN_MATCHES } from "../../../../src/shared/rankings.js";
import { teamPageSql } from "../../../../src/shared/teamPages.js";
import { get } from "../../../db.js";
import { inScope, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import { eventHref, matchRow, teamLinks, type TeamMatch } from "../matchSet.js";
import type { IntentId } from "../read.js";

export interface AnswerTeam { number: number; name: string | null }
export const whoOf = (t: AnswerTeam) => (t.name ? `${t.name} (${t.number})` : `Team ${t.number}`);

export const SCORE_RULE = "Scores are the alliance's official score, penalties included, as the team page's match list shows it (the score without penalties beside it), in matches the team was on the field for, at official events: qualifiers, league play, championships and premier events, never scrimmages or off-season events.";
const HIGH_RULE = "The highest and lowest score are picked by the alliance's own points, without penalties (as the season records are: the other alliance's fouls never make a record), and shown at the official score, penalties included, as the match list shows it. A higher official score that fouls made is shown beside it.";
export const RESULT_RULE = `Results use the official scores, penalties included. ${RECORD_RULE}`;
export const BLOWOUT = { factor: 2, min: 20 };
export const LIST_CAP = 25;

/** "214 matches at 31 events, 2023–24 to 2025–26". */
export function sourceOf(ms: TeamMatch[]): string {
  if (!ms.length) return "No matches in this scope";
  const events = new Set(ms.map((m) => `${m.season}|${m.code}`)).size;
  const seasons = [...new Set(ms.map((m) => m.season))].sort();
  const span = seasons.length === 1 ? seasonLabel(seasons[0]) : `${seasonLabel(seasons[0])} to ${seasonLabel(seasons[seasons.length - 1])}`;
  return `From ${ms.length} match record${ms.length === 1 ? "" : "s"} at ${events} event${events === 1 ? "" : "s"}, ${span}`;
}

export const record = (ms: TeamMatch[]) => ({ wins: ms.filter((m) => m.result === "W").length, losses: ms.filter((m) => m.result === "L").length, ties: ms.filter((m) => m.result === "T").length });
export const recText = (r: { wins: number; losses: number; ties: number }) => `${r.wins}-${r.losses}-${r.ties}`;
export const pct = (r: { wins: number; losses: number; ties: number }) => { const n = r.wins + r.losses + r.ties; return n ? `${Math.round((100 * r.wins) / n)}%` : "–"; };
const newestFirst = (ms: TeamMatch[]) => [...ms].reverse();
const np = (m: TeamMatch) => m.ownNp ?? m.own;
export const bySeason = (ms: TeamMatch[]) => { const g = new Map<number, TeamMatch[]>(); for (const m of ms) g.set(m.season, [...(g.get(m.season) ?? []), m]); return [...g.entries()].sort((a, b) => b[0] - a[0]); };

/** The per-season record table, newest first. */
export function seasonTable(ms: TeamMatch[], title = "By season"): StatBlock {
  return {
    kind: "table", title,
    columns: [{ key: "season", label: "Season" }, { key: "record", label: "W-L-T" }, { key: "rate", label: "Win rate", num: true }, { key: "n", label: "Matches", num: true }],
    rows: bySeason(ms).map(([s, xs]) => { const r = record(xs); return { cells: { season: seasonLabel(s), record: recText(r), rate: pct(r), n: xs.length } }; }),
  };
}

export const WIN_RATE_RANK = `World rank by win rate: the team's place on the season's "top teams by win rate" list (wins over matches played, teams with ${RANKED_MIN_MATCHES} or more matches, then most wins, then team number), shown when that list's record for the team is the one above.`;

/** The team's place on the season's win-rate list (leaderboard.ts "win-rate": the stored season numbers, the same
 *  order), with the record that list holds for it, or null when it isn't ranked. */
export async function winRateRank(team: number, season: number): Promise<{ rank: number; of: number; wins: number; losses: number; ties: number } | null> {
  const rate = "(1.0 * s.wins / NULLIF(s.wins + s.losses + s.ties, 0))";
  const r = await get<{ rank: number; of: number; wins: number; losses: number; ties: number }>(
    `SELECT rank, of, wins, losses, ties FROM (SELECT s.team, s.wins, s.losses, s.ties, ROW_NUMBER() OVER (ORDER BY ${rate} DESC, s.wins DESC, s.team) rank, COUNT(*) OVER () of
       FROM team_season_stats s JOIN teams t ON t.number = s.team
       WHERE s.season = ? AND s.matches >= ${RANKED_MIN_MATCHES} AND ${rate} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}) WHERE team = ?`, [season, team]);
  return r ? { rank: Number(r.rank), of: Number(r.of), wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties) } : null;
}

/** Which matches an intent reads: scored ones for scores (the team on the field), counted ones for results. */
function pool(id: IntentId, all: TeamMatch[], scope: Scope): TeamMatch[] {
  const keep = inScope(scope);
  return all.filter((m) => keep(m) && counts(id, m));
}
/** The intents that read the alliance's points (a score, a phase, its penalties): only matches the team was on the
 *  field for. Every other intent reads results: matches on its record. */
const SCORE_IDS = new Set<IntentId>(["highest-score", "lowest-score", "average-score", "total-points", "score-range", "median-score", "score-consistency", "scores-over",
  "highest-auto", "highest-teleop", "highest-endgame", "most-penalties", "penalties"]);
/** Whether an intent reads match `m`: a score only with the team on the field, a result when it's on the record. */
export function counts(id: IntentId, m: TeamMatch): boolean {
  return SCORE_IDS.has(id) ? m.onField : m.counted;
}

/** The answer for a match-set intent, or null when `id` isn't one of these families' match intents. */
export async function matchAnswer(id: IntentId, team: AnswerTeam, all: TeamMatch[], scope: Scope, opts: { leadEvent?: boolean; n?: number | null; outcome?: "W" | "L" | null }): Promise<StatAnswer | null> {
  const ms = pool(id, all, scope);
  const who = whoOf(team), where = scopePhrase(scope);
  const base = { team, scope: scopeChips(scope), source: sourceOf(ms) };
  const links = await teamLinks(ms.flatMap((m) => [...m.partners, ...m.opponents]).slice(0, 2000));
  // The highest and lowest score rank by the points without penalties, so their rows show them beside the official
  // score; every other answer shows the official totals only, so a win never reads as a lower score than the other
  // alliance's.
  const ranksNp = id === "highest-score" || id === "lowest-score";
  const row = (m: TeamMatch) => { const r = matchRow(m, links, team.number); return ranksNp ? r : { ...r, ownNp: undefined }; };
  const none = (what: string) => `No ${what}${where} found for ${who} in the recorded matches.`;
  const matchesBlock = (title: string, xs: TeamMatch[], more?: string): StatBlock => ({ kind: "matches", title, rows: xs.slice(0, LIST_CAP).map(row), ...(xs.length > LIST_CAP ? { more: more ?? `Showing ${LIST_CAP} of ${xs.length}` } : {}) });
  // Each season is a different game, so points are never compared across seasons: with several seasons and none named,
  // the answer is the latest season's (said so) and each season's own is listed below it.
  const latestOnly = (xs: TeamMatch[]) => {
    const ss = new Set(xs.map((m) => m.season));
    if (scope.season != null || ss.size < 2) return { xs, note: "" };
    const s = Math.max(...ss);
    return { xs: xs.filter((m) => m.season === s), note: ` Each season is a different game, so points are never compared across seasons: the answer is ${seasonLabel(s)}'s, the latest here, and each season's own is listed below.` };
  };

  switch (id) {
    case "highest-score":
    case "lowest-score": {
      const high = id === "highest-score";
      const sorted = [...ms].sort((a, b) => (high ? np(b) - np(a) || b.own - a.own : np(a) - np(b) || a.own - b.own) || String(a.date).localeCompare(String(b.date)));
      const { xs: pick, note } = latestOnly(sorted);
      const top = pick[0];
      const title = high ? (opts.leadEvent ? `Event with the highest score${where}` : `Highest score${where}`) : `Lowest score${where}`;
      if (!top) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: `${SCORE_RULE} ${HIGH_RULE}`, none: scope.championship ? `No Worlds matches found for ${who}.` : none("matches") };
      const r = row(top);
      // A higher (or lower) official score in the same set, made by fouls: shown, never hidden.
      const byOfficial = pick.reduce((a, b) => (high ? (b.own > a.own ? b : a) : (b.own < a.own ? b : a)), top);
      const blocks: StatBlock[] = [
        { kind: "kpis", items: [
          { label: "Without penalties", value: String(np(top)), sub: top.own !== np(top) ? `ranked by this; +${top.own - np(top)} from fouls` : "ranked by this", href: r.href },
          { label: "Result", value: `${top.result === "W" ? "Won" : top.result === "L" ? "Lost" : "Tied"} ${top.own}–${top.opp}`, tone: top.result === "W" ? "good" : top.result === "L" ? "bad" : undefined },
          ...(byOfficial !== top ? [{ label: `${high ? "Highest" : "Lowest"} official score`, value: String(byOfficial.own), sub: `${byOfficial.label}, ${byOfficial.event}: ${byOfficial.own - np(byOfficial)} from the other alliance's fouls`, href: row(byOfficial).href }] : []),
        ] },
        matchesBlock(`${high ? "Best scores" : "Lowest scores"} by points without penalties${note ? `, ${seasonLabel(top.season)}` : ""}`, pick.slice(0, 5)),
      ];
      // Each season is a different game: its best (or worst) beside the others, never compared as one record. A date
      // window can hold two (a week across the season's start).
      if (scope.season == null || scope.window) {
        const per = bySeason(ms).map(([s, xs]) => ({ s, m: [...xs].sort((a, b) => (high ? np(b) - np(a) || b.own - a.own : np(a) - np(b) || a.own - b.own))[0] }));
        if (per.length > 1) blocks.push({ kind: "table", title: `${high ? "Best" : "Lowest"} score each season (each season is a different game)`, columns: [{ key: "season", label: "Season" }, { key: "score", label: "Score", num: true }, { key: "np", label: "Without penalties", num: true }, { key: "match", label: "Match" }, { key: "event", label: "Event" }], rows: per.map(({ s, m }) => ({ cells: { season: seasonLabel(s), score: m.own, np: np(m), match: m.label, event: m.event }, href: row(m).href, strong: m === top })) });
      }
      return {
        ...base, family: "superlative", intent: id, title,
        headline: opts.leadEvent
          ? { value: top.event, label: `${top.own} points in ${top.label} (official score, penalties included)`, sub: [seasonLabel(top.season), r.date, `${np(top)} without penalties`].filter(Boolean).join(" · "), href: eventHref(top.season, top.code, team.number) }
          : { value: `${top.own} points`, label: `${top.label} at ${top.event} (official score, penalties included)`, sub: [seasonLabel(top.season), r.date, `${top.alliance === "red" ? "Red" : "Blue"} alliance`, `${np(top)} without penalties`].filter(Boolean).join(" · "), href: r.href },
        blocks, definition: `${SCORE_RULE} ${HIGH_RULE}${note}`,
      };
    }

    case "biggest-win":
    case "biggest-loss":
    case "closest-match": {
      const margin = (m: TeamMatch) => m.own - m.opp;
      const xs = id === "biggest-win" ? ms.filter((m) => m.result === "W").sort((a, b) => margin(b) - margin(a))
        : id === "biggest-loss" ? ms.filter((m) => m.result === "L").sort((a, b) => margin(a) - margin(b))
        : ms.filter((m) => !opts.outcome || m.result === opts.outcome).sort((a, b) => Math.abs(margin(a)) - Math.abs(margin(b)) || String(b.date).localeCompare(String(a.date)));
      const closest = opts.outcome === "W" ? "Closest win" : opts.outcome === "L" ? "Closest loss" : "Closest match";
      const title = id === "biggest-win" ? `Biggest win${where}` : id === "biggest-loss" ? `Biggest loss${where}` : `${closest}${where}`;
      // A biggest margin is points too: one season's, each season's listed below (a closest gap compares fine).
      const { xs: pick, note } = id === "closest-match" ? { xs, note: "" } : latestOnly(xs);
      const top = pick[0];
      const def = `${id === "closest-match" ? "Closest: the smallest gap between the two alliances' scores (a tie is 0); the latest first on equal gaps." : "Margin: the gap between the two alliances' official scores."} ${RESULT_RULE}${note}`;
      if (!top) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: def, none: none(id === "biggest-win" || opts.outcome === "W" ? "wins" : id === "biggest-loss" || opts.outcome === "L" ? "losses" : "matches") };
      const list = id === "closest-match" ? (opts.outcome === "W" ? "Closest wins" : opts.outcome === "L" ? "Closest losses" : "Closest matches") : id === "biggest-win" ? "Biggest wins" : "Biggest losses";
      const blocks: StatBlock[] = [matchesBlock(`${list}${note ? `, ${seasonLabel(top.season)}` : ""}`, pick.slice(0, 5))];
      if (note) {
        const per = bySeason(xs).map(([s, ys]) => ({ s, m: ys[0] }));
        blocks.push({ kind: "table", title: `${id === "biggest-win" ? "Biggest win" : "Biggest loss"} each season (each season is a different game)`, columns: [{ key: "season", label: "Season" }, { key: "margin", label: "Margin", num: true }, { key: "score", label: "Score" }, { key: "event", label: "Event" }], rows: per.map(({ s, m }) => ({ cells: { season: seasonLabel(s), margin: Math.abs(margin(m)), score: `${m.own}–${m.opp}`, event: m.event }, href: row(m).href, strong: m === top })) });
      }
      return {
        ...base, family: "superlative", intent: id, title,
        headline: { value: `${Math.abs(margin(top))} point${Math.abs(margin(top)) === 1 ? "" : "s"}`, label: `${top.own}–${top.opp} in ${top.label} at ${top.event}`, sub: [seasonLabel(top.season), row(top).date].filter(Boolean).join(" · "), href: row(top).href },
        blocks, definition: def,
      };
    }

    case "first-match":
    case "recent-match": {
      // A win or a loss said ("first win", "when did they last lose"): only those matches.
      const xs = opts.outcome ? ms.filter((m) => m.result === opts.outcome) : ms;
      const noun = opts.outcome === "W" ? "win" : opts.outcome === "L" ? "loss" : "match";
      const m = id === "first-match" ? xs[0] : xs[xs.length - 1];
      const title = id === "first-match" ? `First ${noun}${where}` : `Most recent ${noun}${where}`;
      if (!m) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: RESULT_RULE, none: none(opts.outcome === "W" ? "wins" : opts.outcome === "L" ? "losses" : "matches") };
      // The headline's match is printed once: the list is the next few after it.
      const near = (id === "first-match" ? xs : newestFirst(xs)).slice(1, 5);
      const plural = near.length === 1 ? noun : opts.outcome === "W" ? "wins" : opts.outcome === "L" ? "losses" : "matches";
      return {
        ...base, family: "superlative", intent: id, title,
        headline: { value: `${m.result === "W" ? "Won" : m.result === "L" ? "Lost" : "Tied"} ${m.own}–${m.opp}`, label: `${m.label} at ${m.event}`, sub: [seasonLabel(m.season), row(m).date].filter(Boolean).join(" · "), href: row(m).href },
        blocks: near.length ? [matchesBlock(id === "first-match" ? `The next ${near.length === 1 ? "" : `${near.length} `}${plural}` : `The ${near.length === 1 ? "" : `${near.length} `}${plural} before`, near)] : [], definition: RESULT_RULE,
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
      } else {
        // Qualifications and playoffs apart, when the matches hold both ("12345 states record": 15-5-0 and 9-7-0).
        const quals = ms.filter((m) => m.level !== "playoff"), playoffs = ms.filter((m) => m.level === "playoff");
        blocks.push({ kind: "record", title: "Wins, losses and ties", ...r, ...(quals.length && playoffs.length ? { split: { quals: record(quals), playoffs: record(playoffs) } } : {}) });
      }
      // One whole season's record: its win rate, the season and the team's world rank by win rate beside the bar (the
      // rank is the season's, so it's only shown when nothing narrows the matches).
      const whole = id === "record" && seasons.length === 1 && !scope.championship && !scope.states && !scope.event && !scope.place && !scope.level && !scope.alliance;
      const listed = whole ? await winRateRank(team.number, seasons[0]) : null;
      // The list's rank only beside the same record: one the list counts differently (other events) would rank another rate.
      const ranked = listed && recText(listed) === recText(r) ? listed : null;
      if (whole) {
        blocks.unshift({ kind: "kpis", items: [
          { label: "Win rate", value: pct(r), sub: `${ms.length} match${ms.length === 1 ? "" : "es"}`, tone: "good" },
          { label: "Season", value: seasonLabel(seasons[0]) },
          ...(ranked ? [{ label: "World rank by win rate", value: `#${ranked.rank.toLocaleString("en-US")}`, sub: `of ${ranked.of.toLocaleString("en-US")} teams`, tone: "accent" as const }]
            : listed ? [] : [{ label: "World rank by win rate", value: "Not ranked", sub: `under ${RANKED_MIN_MATCHES} matches` }]),
        ] });
      }
      if (seasons.length > 1 || id !== "record") blocks.push(seasonTable(ms));
      if (scope.championship) blocks.push(eventTable(ms, "Worlds events"));
      const headline = id === "wins-count" ? { value: `${r.wins} win${r.wins === 1 ? "" : "s"}`, label: `in ${ms.length} match${ms.length === 1 ? "" : "es"}${where}`, sub: seasonsText(seasons) }
        : id === "total-matches" ? { value: `${ms.length} match${ms.length === 1 ? "" : "es"}`, label: `played${where}`, sub: `${recText(r)} · ${seasonsText(seasons)}` }
        : id === "red-blue-record" ? { value: `${recText(record(ms.filter((m) => m.alliance === "red")))} red · ${recText(record(ms.filter((m) => m.alliance === "blue")))} blue`, label: `${ms.length} matches${where}`, sub: seasonsText(seasons) }
        : { value: recText(r), label: `${pct(r)} win rate in ${ms.length} match${ms.length === 1 ? "" : "es"}${where}`, ...(whole ? {} : { sub: seasonsText(seasons) }) };
      return { ...base, family: "aggregate", intent: id, title, headline, blocks, definition: whole ? `${RESULT_RULE} ${WIN_RATE_RANK}` : RESULT_RULE };
    }

    case "average-score": {
      const title = `Average score${where}`;
      const def = "Average score: the mean of the alliance's official score, penalties included, in every match the team was on the field for, at official events, as the team page's \"avg alliance score\" (the mean without penalties beside it).";
      if (!ms.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      // Each season is a different game: over several, each season's average, never one number pooled across them.
      const seasons = bySeason(ms);
      if (seasons.length > 1) {
        const [latest, xs] = seasons[0];
        return {
          ...base, family: "aggregate", intent: id, title,
          headline: { value: mean(xs.map((m) => m.own)).toFixed(1), label: `points per match with penalties in ${seasonLabel(latest)}, over ${xs.length} match${xs.length === 1 ? "" : "es"}`, sub: `${mean(xs.map(np)).toFixed(1)} without penalties · each season is a different game: every season's average is listed apart` },
          blocks: [{ kind: "table", title: "Average each season (a different game each year)", columns: [{ key: "season", label: "Season" }, { key: "with", label: "With penalties", num: true }, { key: "avg", label: "No penalties", num: true }, { key: "n", label: "Matches", num: true }],
            rows: seasons.map(([s, ys]) => ({ cells: { season: seasonLabel(s), with: mean(ys.map((m) => m.own)).toFixed(1), avg: mean(ys.map(np)).toFixed(1), n: ys.length }, strong: s === latest })) },
            ...(scope.championship ? [eventTable(ms, "Worlds events")] : [])],
          definition: `${def} Each season is a different game, so each season's average is its own and none is pooled across seasons.`,
        };
      }
      const events = new Map<string, TeamMatch[]>();
      for (const m of ms) events.set(`${m.season}|${m.code}`, [...(events.get(`${m.season}|${m.code}`) ?? []), m]);
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: mean(ms.map((m) => m.own)).toFixed(1), label: `points per match with penalties, over ${ms.length} match${ms.length === 1 ? "" : "es"}`, sub: [seasonLabel(ms[0].season), events.size === 1 ? ms[0].event : ""].filter(Boolean).join(" · ") },
        blocks: [
          { kind: "kpis", items: [{ label: "Without penalties", value: mean(ms.map(np)).toFixed(1) }, { label: "Best", value: String(Math.max(...ms.map((m) => m.own))) }, { label: "Lowest", value: String(Math.min(...ms.map((m) => m.own))) }] },
          { kind: "series", title: "Average by event", unit: "points", points: [...events.values()].map((xs) => ({ x: xs[0].event, y: Number(mean(xs.map((m) => m.own)).toFixed(1)), href: eventHref(xs[0].season, xs[0].code, team.number), note: `${xs.length} matches` })) },
        ],
        definition: def,
      };
    }

    case "average-margin": {
      // "average winning margin": over wins only; "average losing margin": over losses only; else every match.
      const only = opts.outcome ?? null;
      const title = `Average ${only === "W" ? "winning " : only === "L" ? "losing " : ""}margin${where}`;
      const def = only
        ? `Average ${only === "W" ? "winning" : "losing"} margin: the official score of the team's alliance minus the other alliance's, averaged over its ${only === "W" ? "wins" : "losses"} only. ${RESULT_RULE}`
        : `Average margin: the official score of the team's alliance minus the other alliance's, averaged over every match on its record (a loss counts as a negative margin). ${RESULT_RULE}`;
      const picked = only ? ms.filter((m) => m.result === only) : ms;
      const unit = only === "W" ? ["win", "wins"] : only === "L" ? ["loss", "losses"] : ["match", "matches"];
      if (!picked.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none(only === "W" ? "wins" : only === "L" ? "losses" : "matches") };
      const margin = (m: TeamMatch) => m.own - m.opp;
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}`;
      // Each season is a different game: the latest season's figure up front, every season's in the table.
      const seasons = bySeason(picked);
      const [latest, xs] = seasons[0];
      const all = ms.filter((m) => m.season === latest);
      const wins = all.filter((m) => m.result === "W"), losses = all.filter((m) => m.result === "L");
      const events = new Map<string, TeamMatch[]>();
      for (const m of xs) events.set(`${m.season}|${m.code}`, [...(events.get(`${m.season}|${m.code}`) ?? []), m]);
      const kpis = [
        ...(only !== "L" ? [{ label: "In wins", value: wins.length ? signed(mean(wins.map(margin))) : "–" }] : []),
        ...(only !== "W" ? [{ label: "In losses", value: losses.length ? signed(mean(losses.map(margin))) : "–" }] : []),
        { label: "Record", value: recText(record(all)) },
      ];
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: signed(mean(xs.map(margin))), label: `points a ${unit[0]} in ${seasonLabel(latest)}, over ${xs.length} ${unit[xs.length === 1 ? 0 : 1]}`, sub: seasons.length > 1 ? "Each season is a different game: every season is listed apart" : recText(record(all)) },
        blocks: [
          { kind: "kpis", items: kpis },
          { kind: "series", title: `Average ${only === "W" ? "winning " : only === "L" ? "losing " : ""}margin by event, ${seasonLabel(latest)}`, unit: "points", points: [...events.values()].map((ys) => ({ x: ys[0].event, y: Number(mean(ys.map(margin)).toFixed(1)), href: eventHref(ys[0].season, ys[0].code, team.number), note: `${ys.length} matches` })) },
          ...(seasons.length > 1 ? [{ kind: "table" as const, title: "Each season (a different game each year)", columns: [{ key: "season", label: "Season" }, { key: "avg", label: "Average margin", num: true }, { key: "record", label: "W-L-T" }, { key: "n", label: "Matches", num: true }],
            rows: seasons.map(([s, ys]) => ({ cells: { season: seasonLabel(s), avg: signed(mean(ys.map(margin))), record: recText(record(ms.filter((m) => m.season === s))), n: ys.length }, strong: s === latest })) }] : []),
        ],
        definition: seasons.length > 1 ? `${def} Each season is a different game, so no average is pooled across seasons.` : def,
      };
    }

    case "total-points": {
      const title = `Total points${where}`;
      const def = "Total points: the alliance's points without penalties, added up over every match the team was on the field for, at official events (the total with penalties beside it). An alliance's points are both robots' together: no record splits them by robot.";
      if (!ms.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const seasons = bySeason(ms);
      const [latest, xs] = seasons[0];
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: sum(xs.map(np)).toLocaleString("en-US"), label: `alliance points (no penalties) in ${seasonLabel(latest)}, over ${xs.length} match${xs.length === 1 ? "" : "es"}`, sub: seasons.length > 1 ? "Each season is a different game: every season is listed apart" : `${sum(xs.map((m) => m.own)).toLocaleString("en-US")} with penalties` },
        blocks: [{ kind: "table", title: "Each season", columns: [{ key: "season", label: "Season" }, { key: "total", label: "No penalties", num: true }, { key: "with", label: "With penalties", num: true }, { key: "n", label: "Matches", num: true }],
          rows: seasons.map(([s, ys]) => ({ cells: { season: seasonLabel(s), total: sum(ys.map(np)).toLocaleString("en-US"), with: sum(ys.map((m) => m.own)).toLocaleString("en-US"), n: ys.length }, strong: s === latest })) }],
        definition: `${def} Each season is a different game, so no total is added up across seasons.`,
      };
    }

    case "current-streak":
    case "longest-streak": {
      const want = opts.outcome ?? null;
      const title = id === "current-streak" ? `Current ${want === "W" ? "win " : want === "L" ? "losing " : ""}streak${where}` : `Longest ${want === "L" ? "losing" : "win"} streak${where}`;
      const def = `A streak: matches in a row with the same result, in date order across events and seasons (a tie ends it). ${RESULT_RULE}`;
      if (!ms.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      let run: TeamMatch[] = [];
      if (id === "current-streak") {
        const last = ms[ms.length - 1];
        for (let i = ms.length - 1; i >= 0 && ms[i].result === last.result; i--) run.unshift(ms[i]);
        if (last.result === "T") run = [last];
        // A win (or losing) streak asked about that the latest match broke: none now, said so with the latest match.
        if (want && last.result !== want) {
          const kind = want === "W" ? "win" : "losing";
          return { ...base, family: "aggregate", intent: id, title, headline: { value: "0", label: `no ${kind} streak now: the latest match was a ${last.result === "W" ? "win" : last.result === "L" ? "loss" : "tie"}`, sub: `${last.label} at ${last.event}`, href: row(last).href }, blocks: [matchesBlock("Latest matches", newestFirst(ms).slice(0, 5))], definition: def };
        }
      } else {
        let cur: TeamMatch[] = [];
        // The longest run of wins, or of losses when a losing streak is asked.
        const of = want === "L" ? "L" : "W";
        for (const m of ms) { if (m.result === of) { cur.push(m); if (cur.length > run.length) run = [...cur]; } else cur = []; }
      }
      if (!run.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: `${who} has no match ${want === "L" ? "losses" : "wins"}${where} on record.` };
      const kind = run[0].result === "W" ? "win" : run[0].result === "L" ? "loss" : "tie";
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: `${run.length} ${kind === "win" ? "win" : kind === "loss" ? "loss" : "tie"}${run.length === 1 ? "" : kind === "loss" ? "es" : "s"}`, label: id === "current-streak" ? "in a row, up to the latest match" : "in a row, the longest on record", sub: `${run[0].label} at ${run[0].event} to ${run[run.length - 1].label} at ${run[run.length - 1].event}` },
        blocks: [matchesBlock("Matches in the streak", newestFirst(run))], definition: def,
      };
    }

    case "last-matches": {
      // A win or a loss said ("last 5 losses"): only those matches.
      const plural = opts.outcome === "W" ? "wins" : opts.outcome === "L" ? "losses" : "matches";
      const n = opts.n ?? 5, xs = newestFirst(opts.outcome ? ms.filter((m) => m.result === opts.outcome) : ms).slice(0, n);
      const title = `Last ${n} ${plural}${where}`;
      if (!xs.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: RESULT_RULE, none: none(plural) };
      const r = record(xs);
      // The form and its trend: each result oldest to newest, and the scores beside the season's average. Points are
      // never compared across seasons: when the run reaches back into an earlier season, its scores, average and
      // trend are the newest season's matches only.
      const run = [...xs].reverse().filter((m) => m.season === xs[0].season), season = ms.filter((m) => m.season === xs[0].season);
      const mixed = run.length < xs.length;
      const avg = (ys: TeamMatch[]) => (ys.reduce((a, m) => a + m.own, 0) / ys.length).toFixed(1);
      const half = Math.floor(run.length / 2);
      const early = run.slice(0, half), late = run.slice(run.length - half);
      const dir = half ? Number(avg(late)) - Number(avg(early)) : 0;
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: recText(r), label: `in the last ${xs.length} ${xs.length === 1 ? ({ wins: "win", losses: "loss", matches: "match" } as const)[plural] : plural}, oldest to newest ${[...xs].reverse().map((m) => m.result).join(" ")}`, sub: `${seasonLabel(xs[0].season)} · scores ${run.map((m) => m.own).join(", ")}${mixed ? ` (the ${run.length} in ${seasonLabel(xs[0].season)}; each season is a different game)` : ""}` },
        blocks: [
          { kind: "kpis", items: [
            { label: `Average, last ${run.length}`, value: avg(run), sub: `${avg(season)} over the season's ${season.length}` },
            ...(half ? [{ label: "Trend", value: Math.abs(dir) < 5 ? "Steady" : dir > 0 ? "Rising" : "Falling", sub: `${avg(early)} in the first ${half}, ${avg(late)} in the last ${half}`, tone: Math.abs(dir) < 5 ? undefined : dir > 0 ? "good" as const : "bad" as const }] : []),
            { label: "Highest", value: String(Math.max(...run.map((m) => m.own))) },
            { label: "Lowest", value: String(Math.min(...run.map((m) => m.own))) },
          ] },
          { kind: "series", title: "Score, match by match", unit: "points", points: run.map((m) => ({ x: `${m.label} · ${m.event}`, y: m.own, href: row(m).href, note: `${m.result === "W" ? "Won" : m.result === "L" ? "Lost" : "Tied"} ${m.own}–${m.opp}` })) },
          matchesBlock("Newest first", xs),
        ],
        definition: `${RESULT_RULE} Scores are the official ones, penalties included; the trend sets the run's first half against its last (under 5 points apart is steady).`,
      };
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

    // Every match in the scope (a season, a window, a place): the record, quals and playoffs apart, then the list.
    case "season-matches": {
      const title = `Matches${where}`;
      if (!ms.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: RESULT_RULE, none: none("matches") };
      const r = record(ms), quals = ms.filter((m) => m.level === "qual"), playoffs = ms.filter((m) => m.level === "playoff");
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: recText(r), label: `in ${ms.length} match${ms.length === 1 ? "" : "es"}${where}` },
        blocks: [
          { kind: "record", title: "Wins, losses and ties", ...r, ...(quals.length && playoffs.length ? { split: { quals: record(quals), playoffs: record(playoffs) } } : {}) },
          // Every match: a season is a few dozen at most, and the list is the answer.
          { kind: "matches", title: "Newest first", rows: newestFirst(ms).map(row) },
        ],
        definition: RESULT_RULE,
      };
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
export const seasonsText = (ss: number[]) => (ss.length === 1 ? seasonLabel(ss[0]) : `${ss.length} seasons: ${ss.map(seasonLabel).join(", ")}`);

/** Per event: its record (newest first), each a link to the event on the team. */
export function eventTable(ms: TeamMatch[], title: string): StatBlock {
  const evs = new Map<string, TeamMatch[]>();
  for (const m of ms) evs.set(`${m.season}|${m.code}`, [...(evs.get(`${m.season}|${m.code}`) ?? []), m]);
  return {
    kind: "table", title, columns: [{ key: "event", label: "Event" }, { key: "season", label: "Season" }, { key: "record", label: "W-L-T" }, { key: "n", label: "Matches", num: true }],
    rows: [...evs.values()].reverse().map((xs) => ({ cells: { event: xs[0].event, season: seasonLabel(xs[0].season), record: recText(record(xs)), n: xs.length }, href: eventHref(xs[0].season, xs[0].code) })),
  };
}

