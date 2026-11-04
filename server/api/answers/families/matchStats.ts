// Family 4 over a team's match rows (../matchSet.ts) beyond a record or a mean: a win rate, ties, the spread of its
// scores (range, median, consistency), scores over a number, its best match by phase, the penalty points it gave
// away, its easiest opponent, its record against top-rated or rookie opponents, and its early season against its
// late season. Everything is read from the stored matches and the stored season numbers (team_season_stats: the
// prediction rating the team page shows); nothing is recomputed or guessed, and no percent is made up for a
// "consistency": it's the spread of real scores, in points.
// The rules every answer below states:
//   Scores: the alliance's official score, penalties included, as the match list shows it (./matches.ts SCORE_RULE).
//   Phases: the alliance's Auto, TeleOp and Endgame points as the match's breakdown stores them (TeleOp as FIRST
//     reports it: from 2024–25 on it includes the endgame, as the team page's TeleOp does).
//   Penalty points given away: the points the other alliance got from fouls by the team's alliance (both robots').
//   Each season is a different game: points are never compared across seasons (the latest season's answer, each
//     season's own listed beside it).
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { reportedTeleopIncludesEndgame } from "../../../data/seasons.js";
import { all } from "../../../db.js";
import { inScope, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import { eventHref, matchRow, teamHref, teamLinks, type TeamMatch } from "../matchSet.js";
import type { IntentId } from "../read.js";
import {
  LIST_CAP, RESULT_RULE, SCORE_RULE, WIN_RATE_RANK, bySeason, counts, pct, recText, record, seasonTable, seasonsText, sourceOf, whoOf, winRateRank, type AnswerTeam,
} from "./matches.js";

/** The intents answered here. */
export const MATCH_STAT_IDS = new Set<IntentId>(["ties-count", "win-percent", "score-range", "median-score", "score-consistency", "scores-over",
  "highest-auto", "highest-teleop", "highest-endgame", "most-penalties", "penalties", "easiest-opponent", "vs-top", "vs-rookies", "early-late"]);

/** "Top teams": opponents in the season's top tenth by prediction rating (its world rank among every rated team). */
export const TOP_SHARE = 0.1;
const PEN_RULE = "Penalty points given away: the points the other alliance got from fouls by the team's alliance (both robots' fouls together; no record splits them by robot), in matches the team was on the field for, at official events.";
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const one = (x: number) => x.toFixed(1);
const plural = (n: number, w: string, ws = `${w}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? w : ws}`;
const resultWord = (m: TeamMatch) => `${m.result === "W" ? "Won" : m.result === "L" ? "Lost" : "Tied"} ${m.own}–${m.opp}`;
/** The value at fraction `p` of sorted `xs` (linear between neighbours), as a median or a quartile is read. */
const quantile = (xs: number[], p: number) => { const i = (xs.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return xs[lo] + (xs[hi] - xs[lo]) * (i - lo); };
const byEvent = (ms: TeamMatch[]) => { const g = new Map<string, TeamMatch[]>(); for (const m of ms) g.set(`${m.season}|${m.code}`, [...(g.get(`${m.season}|${m.code}`) ?? []), m]); return [...g.values()]; };

/** A phase's points in match `m`, as the team page reports that phase (TeleOp with the endgame from 2024–25 on). */
function phaseOf(id: IntentId, m: TeamMatch): number | null {
  if (id === "highest-auto") return m.ownAuto;
  if (id === "highest-endgame") return m.ownEndgame;
  if (id === "highest-teleop") return m.ownTeleop == null ? null : m.ownTeleop + (reportedTeleopIncludesEndgame(m.season) ? m.ownEndgame ?? 0 : 0);
  if (id === "most-penalties") return m.ownPen;
  return null;
}
const PHASE: Partial<Record<IntentId, { title: string; word: string; phase?: "auto" | "teleop" | "endgame" }>> = {
  "highest-auto": { title: "Highest Auto score", word: "Auto", phase: "auto" },
  "highest-teleop": { title: "Highest TeleOp score", word: "TeleOp", phase: "teleop" },
  "highest-endgame": { title: "Highest Endgame score", word: "Endgame", phase: "endgame" },
  "most-penalties": { title: "Match with the most penalty points given away", word: "penalty points given away" },
};

/** The prediction rating (and its world rank) each opponent had that season, as its team page shows it. */
async function ratingsOf(pairs: { team: number; season: number }[]): Promise<{ rating: Map<string, { rating: number; rank: number | null }>; rated: Map<number, number> }> {
  const seasons = [...new Set(pairs.map((p) => p.season))];
  const teams = [...new Set(pairs.map((p) => p.team))].slice(0, 2000);
  const rating = new Map<string, { rating: number; rank: number | null }>(), rated = new Map<number, number>();
  if (!teams.length) return { rating, rated };
  for (const season of seasons) {
    const rows = await all<{ team: number; rating_np: number | null; rating_rank: number | null }>(
      `SELECT team, rating_np, rating_rank FROM team_season_stats WHERE season = ? AND team IN (${teams.map(() => "?").join(",")}) AND rating_np IS NOT NULL`, [season, ...teams]);
    for (const r of rows) rating.set(`${r.team}|${season}`, { rating: Number(r.rating_np), rank: r.rating_rank == null ? null : Number(r.rating_rank) });
    const n = await all<{ n: number }>("SELECT COUNT(*) n FROM team_season_stats WHERE season = ? AND rating_rank IS NOT NULL", [season]);
    rated.set(season, Number(n[0]?.n ?? 0));
  }
  return { rating, rated };
}

/** The answer for one of MATCH_STAT_IDS, or null for any other intent. */
export async function matchStatAnswer(id: IntentId, team: AnswerTeam, all0: TeamMatch[], scope: Scope, opts: { n?: number | null; variant?: "per-event" | "rate" | "at-least" | null }): Promise<StatAnswer | null> {
  if (!MATCH_STAT_IDS.has(id)) return null;
  const keep = inScope(scope);
  const pool = all0.filter((m) => keep(m) && counts(id, m));
  const who = whoOf(team), where = scopePhrase(scope);
  const links = await teamLinks(pool.flatMap((m) => [...m.partners, ...m.opponents]).slice(0, 2000));
  const row = (m: TeamMatch) => ({ ...matchRow(m, links, team.number), ownNp: undefined });
  const matches = (title: string, xs: TeamMatch[]): StatBlock => ({ kind: "matches", title, rows: xs.slice(0, LIST_CAP).map(row), ...(xs.length > LIST_CAP ? { more: `Showing ${LIST_CAP} of ${xs.length}` } : {}) });
  const none = (what: string) => `No ${what}${where} found for ${who} in the recorded matches.`;
  /** "Q19 at P2-8 Northern League Meet, 200 from the other alliance's fouls". */
  const fouls = (m: TeamMatch) => `${m.label} at ${m.event}${m.ownNp != null && m.own > m.ownNp ? `, ${m.own - m.ownNp} from the other alliance's fouls` : ""}`;
  // Points are never compared across seasons: with several and none named, the latest season's (said so).
  const seasons = [...new Set(pool.map((m) => m.season))].sort((a, b) => b - a);
  const pointsSeason = scope.season ?? seasons[0] ?? null;
  const several = scope.season == null && seasons.length > 1;
  const pts = several ? pool.filter((m) => m.season === pointsSeason) : pool;
  const pointsNote = several ? ` Each season is a different game, so points are never compared across seasons: the answer is ${seasonLabel(pointsSeason!)}'s, the latest here.` : "";
  const base = { team, scope: scopeChips(several ? { ...scope, season: pointsSeason } : scope), source: sourceOf(pool) };
  const title0 = (t: string) => `${t}${scopePhrase(several ? { ...scope, season: pointsSeason } : scope)}`;

  switch (id) {
    case "ties-count": {
      const ties = pool.filter((m) => m.result === "T");
      const title = `Ties${where}`;
      if (!pool.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: RESULT_RULE, none: none("matches") };
      const ss = [...new Set(pool.map((m) => m.season))].sort();
      const blocks: StatBlock[] = [{ kind: "record", title: "Wins, losses and ties", ...record(pool) }];
      if (ties.length) blocks.push(matches("Tied matches, newest first", [...ties].reverse()));
      if (ss.length > 1) blocks.push(seasonTable(pool));
      return { ...base, family: "aggregate", intent: id, title, headline: { value: plural(ties.length, "tie"), label: `in ${plural(pool.length, "match", "matches")}${where} · ${recText(record(pool))}`, sub: seasonsText(ss) }, blocks, definition: `A tie: both alliances finished on the same official score. ${RESULT_RULE}` };
    }

    case "win-percent": {
      const title = `Win rate${where}`;
      if (!pool.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: RESULT_RULE, none: none("matches") };
      const r = record(pool), ss = [...new Set(pool.map((m) => m.season))].sort();
      const whole = ss.length === 1 && !scope.championship && !scope.states && !scope.event && !scope.place && !scope.level && !scope.alliance;
      const listed = whole ? await winRateRank(team.number, ss[0]) : null;
      const ranked = listed && recText(listed) === recText(r) ? listed : null;
      const evs = byEvent(pool);
      const blocks: StatBlock[] = [
        { kind: "kpis", items: [
          { label: "Wins", value: String(r.wins), sub: `of ${plural(pool.length, "match", "matches")}`, tone: "good" },
          { label: "Record", value: recText(r), sub: ss.length === 1 ? seasonLabel(ss[0]) : `${ss.length} seasons` },
          ...(ranked ? [{ label: "World rank by win rate", value: `#${ranked.rank.toLocaleString("en-US")}`, sub: `of ${ranked.of.toLocaleString("en-US")} teams`, tone: "accent" as const }] : []),
        ] },
        { kind: "record", title: "Wins, losses and ties", ...r },
      ];
      if (ss.length > 1) blocks.push(seasonTable(pool));
      else if (evs.length > 1) blocks.push({ kind: "series", title: "Win rate by event", unit: "%", points: evs.map((xs) => { const x = record(xs); return { x: xs[0].event, y: Math.round((100 * x.wins) / xs.length), href: eventHref(xs[0].season, xs[0].code, team.number), note: `${recText(x)} in ${xs.length}` }; }) });
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: pct(r), label: `${r.wins} wins out of ${plural(pool.length, "match", "matches")}${where}`, sub: `${recText(r)} · ${seasonsText(ss)}` },
        blocks, definition: `Win rate: wins over every match on the team's record (ties count as played), playoffs included. ${RESULT_RULE}${ranked ? ` ${WIN_RATE_RANK}` : ""}`,
      };
    }

    case "score-range":
    case "median-score":
    case "score-consistency": {
      const title = title0(id === "score-range" ? "Score range" : id === "median-score" ? "Median score" : "Score consistency");
      const def = `${SCORE_RULE} The median is the middle score; the middle half runs from the lower to the upper quartile; the spread is the standard deviation, in points. No consistency percent is given: the spread of the real scores is the measure.${pointsNote}`;
      if (!pts.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      const xs = pts.map((m) => m.own).sort((a, b) => a - b);
      const lo = pts.reduce((a, b) => (b.own < a.own ? b : a)), hi = pts.reduce((a, b) => (b.own > a.own ? b : a));
      const med = quantile(xs, 0.5), avg = mean(xs), q1 = quantile(xs, 0.25), q3 = quantile(xs, 0.75);
      const sd = Math.sqrt(mean(xs.map((x) => (x - avg) ** 2)));
      const evs = byEvent(pts).map((ys) => ({ ys, avg: mean(ys.map((m) => m.own)) }));
      const first = evs[0], last = evs[evs.length - 1];
      const trend = evs.length < 2 ? null : Math.abs(last.avg - first.avg) < 0.05 * Math.max(first.avg, last.avg, 1) ? "Steady" : last.avg > first.avg ? "Rising" : "Falling";
      const n = `${plural(xs.length, "match", "matches")}`, season = seasonLabel(pts[0].season);
      const headline = id === "score-range"
        ? { value: `${lo.own}–${hi.own}`, label: `points, lowest to highest, over ${n}`, sub: `${season} · median ${one(med)} · average ${one(avg)}` }
        : id === "median-score"
          ? { value: one(med), label: `points, the median of ${n}`, sub: `${season} · average ${one(avg)} · range ${lo.own}–${hi.own}` }
          : { value: `±${one(sd)}`, label: `points of spread around an average of ${one(avg)}, over ${n}`, sub: `${season} · middle half ${one(q1)}–${one(q3)} · range ${lo.own}–${hi.own}${trend ? ` · ${trend.toLowerCase()} by event` : ""}` };
      return {
        ...base, family: "aggregate", intent: id, title, headline,
        blocks: [
          { kind: "kpis", items: [
            { label: "Lowest", value: String(lo.own), sub: fouls(lo), href: row(lo).href },
            { label: "Median", value: one(med) },
            { label: "Highest", value: String(hi.own), sub: fouls(hi), href: row(hi).href },
          ] },
          { kind: "kpis", items: [
            { label: "Middle half", value: `${one(q1)}–${one(q3)}`, sub: "lower to upper quartile" },
            { label: "Spread", value: `±${one(sd)}`, sub: "standard deviation, points" },
            ...(trend ? [{ label: "Trend by event", value: trend, sub: `${one(first.avg)} at ${first.ys[0].event}, ${one(last.avg)} at ${last.ys[0].event}`, tone: trend === "Rising" ? "good" as const : trend === "Falling" ? "bad" as const : undefined }] : []),
          ] },
          ...(evs.length > 1 ? [{ kind: "series" as const, title: "Average score by event", unit: "points", points: evs.map(({ ys, avg: y }) => ({ x: ys[0].event, y: Number(one(y)), href: eventHref(ys[0].season, ys[0].code, team.number), note: `${ys.length} matches, ${Math.min(...ys.map((m) => m.own))}–${Math.max(...ys.map((m) => m.own))}` })) }] : []),
          matches("Lowest and highest", lo === hi ? [hi] : [hi, lo]),
        ],
        definition: def,
      };
    }

    case "scores-over": {
      const over = opts.n ?? 0, least = opts.variant === "at-least";
      const above = (m: TeamMatch) => (least ? m.own >= over : m.own > over);
      const words = least ? `at least ${over}` : `over ${over}`;
      const title = title0(`Scores ${least ? "of at least" : "over"} ${over}`);
      const def = `${SCORE_RULE} ${least ? `At least: ${over} points or more` : `Over: more than ${over} points`}.${pointsNote}`;
      if (!pts.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      const xs = pts.filter(above);
      const r = record(xs);
      const blocks: StatBlock[] = [];
      if (xs.length) blocks.push({ kind: "kpis", items: [{ label: "Record in them", value: recText(r) }, { label: "Highest", value: String(Math.max(...xs.map((m) => m.own))) }, { label: "Share", value: pct({ wins: xs.length, losses: pts.length - xs.length, ties: 0 }), sub: `of ${plural(pts.length, "match", "matches")}` }] });
      blocks.push(xs.length ? matches("Newest first", [...xs].reverse()) : { kind: "links", title: "Their matches", items: [{ label: `${who}'s matches`, href: teamHref(team.number, pts[0].season) }], none: `No match scored ${words} points${where}.` });
      if (several) blocks.push({ kind: "table", title: `Scored ${words}, each season (a different game each year)`, columns: [{ key: "season", label: "Season" }, { key: "n", label: `Matches ${least ? "at least" : "over"}`, num: true }, { key: "of", label: "Matches", num: true }],
        rows: bySeason(pool).map(([s, ys]) => ({ cells: { season: seasonLabel(s), n: ys.filter(above).length, of: ys.length }, strong: s === pointsSeason })) });
      return { ...base, family: "aggregate", intent: id, title, headline: { value: plural(xs.length, "match", "matches"), label: `of ${pts.length} scored ${words} points (official score)`, sub: seasonLabel(pts[0].season) }, blocks, definition: def };
    }

    case "highest-auto":
    case "highest-teleop":
    case "highest-endgame":
    case "most-penalties": {
      const ph = PHASE[id]!;
      const title = title0(ph.title);
      const teleopNote = id === "highest-teleop" && reportedTeleopIncludesEndgame(pointsSeason ?? 0) ? " TeleOp includes the endgame, as FIRST reports it and the team page shows it." : "";
      const def = `${id === "most-penalties" ? PEN_RULE : "Phase points: the alliance's points in that phase, as the match's score breakdown has them (both robots together), in matches the team was on the field for, at official events."}${teleopNote}${pointsNote}`;
      const xs = pts.filter((m) => phaseOf(id, m) != null).sort((a, b) => phaseOf(id, b)! - phaseOf(id, a)! || b.own - a.own || String(a.date).localeCompare(String(b.date)));
      const top = xs[0];
      if (!top) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: def, none: pts.length ? `No score breakdown${where} on record for ${who}'s matches.` : none("matches") };
      const v = phaseOf(id, top)!;
      const r = row(top);
      // The match's phases as the team page's coloured tiles, each bar its share of the alliance's points (no penalties).
      const phases = (m: TeamMatch) => {
        const own = m.ownNp || 0, pc = (x: number | null) => (x != null && own > 0 ? Math.max(0, Math.min(100, Math.round((100 * x) / own))) : 0);
        const tele = phaseOf("highest-teleop", m);
        return [
          { label: "Auto", value: String(m.ownAuto ?? "–"), phase: "auto" as const, sub: `points of ${own} without penalties`, pc: pc(m.ownAuto) },
          { label: "TeleOp", value: String(tele ?? "–"), phase: "teleop" as const, sub: reportedTeleopIncludesEndgame(m.season) ? "points, endgame included" : `points of ${own} without penalties`, pc: pc(tele) },
          { label: "Endgame", value: String(m.ownEndgame ?? "–"), phase: "endgame" as const, sub: `points of ${own} without penalties`, pc: pc(m.ownEndgame) },
        ];
      };
      const blocks: StatBlock[] = [
        { kind: "kpis", items: [
          { label: "Result", value: resultWord(top), tone: top.result === "W" ? "good" : top.result === "L" ? "bad" : undefined },
          { label: "Score", value: String(top.own), sub: `${top.ownNp ?? top.own} without penalties` },
          ...(id === "most-penalties" ? [] : [{ label: "Penalty points given away", value: String(top.ownPen ?? "–") }]),
        ] },
        ...(id === "most-penalties" ? [] : [{ kind: "kpis" as const, items: phases(top) }]),
        { kind: "table", title: `Top ${Math.min(5, xs.length)} by ${ph.word}`, columns: [{ key: "v", label: ph.word, num: true }, { key: "match", label: "Match" }, { key: "event", label: "Event" }, { key: "result", label: "Result" }],
          rows: xs.slice(0, 5).map((m) => ({ cells: { v: phaseOf(id, m), match: m.label, event: m.event, result: resultWord(m) }, href: row(m).href, strong: m === top })) },
      ];
      return {
        ...base, family: "superlative", intent: id, title,
        headline: { value: `${v} point${v === 1 ? "" : "s"}`, label: `${id === "most-penalties" ? "of penalty points given away" : ph.word} in ${top.label} at ${top.event}`, sub: [seasonLabel(top.season), r.date, `${top.alliance === "red" ? "Red" : "Blue"} alliance`].filter(Boolean).join(" · "), href: r.href },
        blocks, definition: def,
      };
    }

    case "penalties": {
      const title = title0(opts.variant === "per-event" ? "Penalty points given away per event" : opts.variant === "rate" ? "Penalty rate" : "Penalty points given away");
      const xs = pts.filter((m) => m.ownPen != null);
      const def = `${PEN_RULE} The penalty rate is the share of those matches with any penalty points given away.${pointsNote}`;
      if (!xs.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches with a score breakdown") };
      const total = xs.reduce((n, m) => n + (m.ownPen ?? 0), 0), per = total / xs.length;
      const fouled = xs.filter((m) => (m.ownPen ?? 0) > 0);
      const evs = byEvent(xs);
      const perEvent = total / evs.length;
      const rate = pct({ wins: fouled.length, losses: xs.length - fouled.length, ties: 0 });
      const n = plural(xs.length, "match", "matches");
      const at = [seasonLabel(xs[0].season), evs.length === 1 ? xs[0].event : ""].filter(Boolean).join(" · ");
      // The rating's share for the robot itself, as the team page says it ("gives away ~8.4 penalty pts a match"): only
      // beside a whole season's figure.
      const whole = !several && pts.every((m) => m.season === pts[0].season) && !scope.championship && !scope.states && !scope.event && !scope.place && !scope.level && !scope.alliance;
      const share = whole ? (await all<{ rating_pen: number | null }>("SELECT rating_pen FROM team_season_stats WHERE team = ? AND season = ?", [team.number, pts[0].season]))[0]?.rating_pen ?? null : null;
      const headline = opts.variant === "per-event"
        ? { value: one(perEvent), label: `penalty points given away per event, over ${plural(evs.length, "event")}${where}`, sub: `${one(per)} a match · ${total} in all over ${n}` }
        : opts.variant === "rate"
          ? { value: rate, label: `of ${n} had penalty points given away (${fouled.length} of ${xs.length})`, sub: `${one(per)} points a match · ${at}` }
          : { value: one(per), label: `penalty points given away per match, over ${n}`, sub: `${fouled.length} of ${xs.length} matches with any · ${at}` };
      return {
        ...base, family: "aggregate", intent: id, title, headline,
        blocks: [
          { kind: "kpis", items: [
            { label: "A match", value: one(per), sub: "alliance's fouls" },
            { label: "Matches with any", value: `${fouled.length} of ${xs.length}`, sub: rate },
            { label: "Total", value: String(total), sub: `over ${plural(evs.length, "event")}` },
            ...(share != null ? [{ label: "Robot's own share", value: `~${one(Number(share))}`, sub: "a match, its prediction rating's estimate" }] : []),
          ] },
          { kind: "table", title: "By event", columns: [{ key: "event", label: "Event" }, { key: "avg", label: "A match", num: true }, { key: "n", label: "Matches", num: true }, { key: "with", label: "With any", num: true }, { key: "total", label: "Total", num: true }],
            rows: [...evs].reverse().map((ys) => { const t = ys.reduce((a, m) => a + (m.ownPen ?? 0), 0); return { cells: { event: ys[0].event, avg: one(t / ys.length), n: ys.length, with: ys.filter((m) => (m.ownPen ?? 0) > 0).length, total: t }, href: eventHref(ys[0].season, ys[0].code, team.number) }; }) },
          ...(fouled.length ? [matches("Most penalty points given away", [...fouled].sort((a, b) => (b.ownPen ?? 0) - (a.ownPen ?? 0)).slice(0, 5))] : []),
        ],
        definition: share != null ? `${def} The robot's own share is its prediction rating's penalty part: what the engine expects this robot alone to give away a match.` : def,
      };
    }

    case "easiest-opponent":
    case "vs-top":
    case "vs-rookies": {
      const { rating, rated } = await ratingsOf(pool.flatMap((m) => m.opponents.map((t) => ({ team: t, season: m.season }))));
      if (id === "easiest-opponent") {
        const title = `Easiest opponent${where}`;
        const def = `Easiest opponent: the opponent with the lowest prediction rating that season (as its team page shows it), of every team met on the other alliance at official events. ${RESULT_RULE}`;
        const met = new Map<string, { team: number; season: number; ms: TeamMatch[] }>();
        for (const m of pool) for (const t of m.opponents) { const k = `${t}|${m.season}`; met.set(k, { team: t, season: m.season, ms: [...(met.get(k)?.ms ?? []), m] }); }
        const ranked = [...met.values()].filter((x) => rating.has(`${x.team}|${x.season}`)).sort((a, b) => rating.get(`${a.team}|${a.season}`)!.rating - rating.get(`${b.team}|${b.season}`)!.rating || a.team - b.team);
        const top = ranked[0];
        if (!top) return { ...base, family: "two-team", intent: id, title, blocks: [], definition: def, none: none("rated opponents") };
        const name = (n: number) => links.get(n)?.label ?? String(n);
        const theirs = (x: { ms: TeamMatch[] }) => { const r = record(x.ms); return `${r.wins}-${r.losses}-${r.ties}`; };
        const rt = (x: { team: number; season: number }) => rating.get(`${x.team}|${x.season}`)!;
        return {
          ...base, family: "two-team", intent: id, title,
          headline: { value: name(top.team), label: `rating ${one(rt(top).rating)} in ${seasonLabel(top.season)}, the lowest faced · met ${plural(top.ms.length, "time")}, ${team.number} went ${theirs(top)}`, sub: `${top.ms[0].label} at ${top.ms[0].event}`, href: teamHref(top.team, top.season) },
          blocks: [{
            kind: "table", title: `Lowest-rated ${Math.min(5, ranked.length)} faced`, columns: [{ key: "team", label: "Team" }, { key: "rating", label: "Rating", num: true }, { key: "rank", label: "World rank", num: true }, { key: "n", label: "Met", num: true }, { key: "record", label: `${team.number} W-L-T` }],
            rows: ranked.slice(0, 5).map((x) => ({ cells: { team: name(x.team), rating: one(rt(x).rating), rank: rt(x).rank != null ? `#${rt(x).rank!.toLocaleString("en-US")}` : "–", n: x.ms.length, record: theirs(x) }, href: teamHref(x.team, x.season), strong: x === top })),
          }],
          definition: def,
        };
      }
      // Opponents as a group: an alliance with a top-tenth (or a rookie) team on it, against every other match.
      const rookies = id === "vs-rookies" ? await all<{ number: number; rookie_year: number | null }>(`SELECT number, rookie_year FROM teams WHERE number IN (${[...new Set(pool.flatMap((m) => m.opponents))].slice(0, 2000).map(() => "?").join(",") || "NULL"})`, [...new Set(pool.flatMap((m) => m.opponents))].slice(0, 2000)) : [];
      const rookieYear = new Map(rookies.map((r) => [Number(r.number), r.rookie_year == null ? null : Number(r.rookie_year)]));
      const isTop = (t: number, s: number) => { const x = rating.get(`${t}|${s}`); const n = rated.get(s) ?? 0; return !!x && x.rank != null && n > 0 && x.rank <= Math.ceil(TOP_SHARE * n); };
      const inGroup = (m: TeamMatch) => m.opponents.some((t) => (id === "vs-top" ? isTop(t, m.season) : rookieYear.get(t) === m.season));
      const title = title0(id === "vs-top" ? "Against top-rated teams" : "Against rookie teams");
      const def = id === "vs-top"
        ? `Against top-rated teams: matches where the other alliance had a team in the season's top ${Math.round(TOP_SHARE * 100)}% by prediction rating (its world rank among every rated team, as its team page shows it). ${RESULT_RULE} Scores are the official ones, penalties included.`
        : `Against rookie teams: matches where the other alliance had a team in its rookie season (its rookie year on FIRST's listing is that season). ${RESULT_RULE} Scores are the official ones, penalties included.`;
      const scored = several ? pool.filter((m) => m.season === pointsSeason) : pool;
      if (!scored.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: none("matches") };
      const g = scored.filter(inGroup), rest = scored.filter((m) => !inGroup(m));
      const word = id === "vs-top" ? "top-rated" : "rookie";
      if (!g.length) return { ...base, family: "aggregate", intent: id, title, blocks: [{ kind: "record", title: "Every match", ...record(scored) }], definition: `${def}${pointsNote}`, none: `${who} met no ${word} teams${where || ` in ${seasonLabel(scored[0].season)}`} (${plural(scored.length, "match", "matches")} checked).` };
      const side = (xs: TeamMatch[]) => (xs.length ? { rec: recText(record(xs)), rate: pct(record(xs)), avg: one(mean(xs.map((m) => m.own))) } : { rec: "–", rate: "–", avg: "–" });
      const a = side(g), b = side(rest);
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: a.rec, label: `against alliances with a ${word} team, ${plural(g.length, "match", "matches")} · ${a.rate} wins`, sub: `${seasonLabel(scored[0].season)} · ${b.rec} in the other ${rest.length}` },
        blocks: [
          { kind: "table", title: "Side by side", columns: [{ key: "who", label: "Matches" }, { key: "n", label: "Played", num: true }, { key: "rec", label: "W-L-T" }, { key: "rate", label: "Win rate", num: true }, { key: "avg", label: "Avg score", num: true }],
            rows: [{ cells: { who: `With a ${word} opponent`, n: g.length, rec: a.rec, rate: a.rate, avg: a.avg }, strong: true }, { cells: { who: "Every other match", n: rest.length, rec: b.rec, rate: b.rate, avg: b.avg } }] },
          matches(`Against ${word} teams, newest first`, [...g].reverse()),
        ],
        definition: `${def}${pointsNote}`,
      };
    }

    case "early-late": {
      const scored = several ? pool.filter((m) => m.season === pointsSeason) : pool;
      const title = title0("Early season against late season");
      const evs = byEvent(scored);
      const def = `Early and late season: the team's events that season in date order, split in two (the first half of its events, then the rest; an odd one out goes to the early half). Results as on its record; scores are the official ones, penalties included. ${RESULT_RULE}${pointsNote}`;
      if (evs.length < 2) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: def, none: `${who} played ${evs.length ? "one event" : "no events"}${where || (scored[0] ? ` in ${seasonLabel(scored[0].season)}` : "")}: no early and late season to set side by side.` };
      const cut = Math.ceil(evs.length / 2);
      const early = evs.slice(0, cut).flat(), late = evs.slice(cut).flat();
      const side = (xs: TeamMatch[]) => ({ rec: recText(record(xs)), rate: pct(record(xs)), avg: one(mean(xs.map((m) => m.own))), n: xs.length });
      const a = side(early), b = side(late);
      const better = record(late).wins / late.length - record(early).wins / early.length;
      return {
        ...base, family: "aggregate", intent: id, title,
        headline: { value: `${b.rec} late · ${a.rec} early`, label: `${b.rate} wins late in the season against ${a.rate} early, average score ${b.avg} against ${a.avg}`, sub: `${seasonLabel(scored[0].season)} · ${Math.abs(better) < 0.05 ? "about the same" : better > 0 ? "better late" : "better early"}` },
        blocks: [
          { kind: "table", title: "Side by side", columns: [{ key: "half", label: "Part of the season" }, { key: "events", label: "Events" }, { key: "n", label: "Matches", num: true }, { key: "rec", label: "W-L-T" }, { key: "rate", label: "Win rate", num: true }, { key: "avg", label: "Avg score", num: true }],
            rows: [
              { cells: { half: "Early", events: evs.slice(0, cut).map((xs) => xs[0].event).join(", "), n: a.n, rec: a.rec, rate: a.rate, avg: a.avg } },
              { cells: { half: "Late", events: evs.slice(cut).map((xs) => xs[0].event).join(", "), n: b.n, rec: b.rec, rate: b.rate, avg: b.avg }, strong: true },
            ] },
          { kind: "series", title: "Average score by event", unit: "points", points: evs.map((xs) => ({ x: xs[0].event, y: Number(one(mean(xs.map((m) => m.own)))), href: eventHref(xs[0].season, xs[0].code, team.number), note: recText(record(xs)) })) },
        ],
        definition: def,
      };
    }
    default:
      return null;
  }
}
