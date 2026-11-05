// Family 2, trends (the brief's "one series, metric as a parameter"): one of a team's numbers over its events (a
// season's events, oldest first) or over its seasons, from the rows its team page already holds (../eventSet.ts:
// team_event_stats, event_teams, team_season_stats; nothing recomputed). The metrics are the team page's trend chart's
// (src/pages/TeamPage.tsx TRENDS), with the same definitions. Each season is a different game, so a per-event trend
// stays in one season, and a season-by-season OPR is read beside its standing that season.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { scopeChips, type Scope } from "../clauses.js";
import type { TeamEvent, TeamSeason } from "../eventSet.js";
import { eventHref, teamHref } from "../matchSet.js";
import type { IntentId } from "../read.js";
import { whoOf, type AnswerTeam } from "./matches.js";

/** A per-event metric: its words, unit, whether lower is better, and how it reads an event row. */
interface Metric { label: string; unit?: string; lowerIsBetter?: boolean; digits: number; get: (e: TeamEvent) => number | null; rule: string }
const rateOf = (e: TeamEvent) => { const n = (e.wins ?? 0) + (e.losses ?? 0) + (e.ties ?? 0); return n ? (100 * (e.wins ?? 0)) / n : null; };
export const METRICS: Partial<Record<IntentId, Metric>> = {
  "opr-history": { label: "OPR", digits: 1, get: (e) => e.opr, rule: "OPR at each event: the team's offensive power rating there without penalties, as its team page shows." },
  "win-rate": { label: "Win rate", unit: "%", digits: 0, get: rateOf, rule: "Win rate at each event: wins over the qualification matches it played there (ties count as played), as the team page's trend shows." },
  "avg-penalties": { label: "Penalty points given", lowerIsBetter: true, digits: 1, get: (e) => e.avgPen, rule: "Penalty points given: the average penalty points the team's alliance gave the other alliance per qualification match at each event (the alliance's fouls, shared by its teams), as the team page's trend shows. Lower is better." },
  "avg-score-by-event": { label: "Average alliance score", digits: 1, get: (e) => e.avgScore, rule: "Average alliance score at each event: the team's alliance's average official score per qualification match there, penalties included, as the team page's trend shows." },
  "ranking-points": { label: "Ranking points", digits: 2, get: (e) => e.rp, rule: "Ranking points at each event: the team's ranking score in the event's official rankings (league meets have none of their own: their rankings are the league's running standing)." },
};

const fmt = (v: number | null, m: { unit?: string; digits: number }) => (v == null ? "–" : `${m.digits ? (Math.round(v * 10 ** m.digits) / 10 ** m.digits).toFixed(m.digits) : Math.round(v)}${m.unit ?? ""}`);

/** Rising, falling or steady: the latest event against the one before it (a change under 5% of the larger is steady). */
function direction(vals: number[], lowerIsBetter?: boolean): { word: string; tone?: "good" | "bad" } | null {
  if (vals.length < 2) return null;
  const [prev, last] = vals.slice(-2);
  const d = last - prev;
  if (Math.abs(d) < 0.05 * Math.max(Math.abs(prev), Math.abs(last), 1)) return { word: "Steady" };
  const up = d > 0;
  return { word: up ? "Rising" : "Falling", tone: up !== !!lowerIsBetter ? "good" : "bad" };
}

/** The season a per-event trend reads: the one named, else the team's latest season with events played. */
const seasonOf = (scope: Scope, events: TeamEvent[]) => scope.season ?? (events.filter((e) => e.matches > 0).map((e) => e.season).sort((a, b) => b - a)[0] ?? null);

export function trendAnswer(id: IntentId, team: AnswerTeam, set: { events: TeamEvent[]; seasons: TeamSeason[] }, scope: Scope): StatAnswer | null {
  const who = whoOf(team);
  if (id === "opr-by-season" || id === "record-by-season") return seasonTrend(id, team, set.seasons);
  const metric = METRICS[id];
  if (!metric) return null;
  const season = seasonOf(scope, set.events);
  const sc: Scope = { ...scope, season };
  const evs = set.events.filter((e) => e.season === season && e.matches > 0);
  const pts = evs.map((e) => ({ e, y: metric.get(e) }));
  const title = `${metric.label} by event${season != null ? ` in ${seasonLabel(season)}` : ""}`;
  const why = scope.season == null && season != null ? ` The season is ${seasonLabel(season)}, the team's latest with events played; each season is a different game, so a trend stays in one.` : "";
  const base = { family: "trend" as const, intent: id, title, team, scope: scopeChips(sc), definition: `${metric.rule}${why}`, source: `From ${evs.length} event record${evs.length === 1 ? "" : "s"}${season != null ? `, ${seasonLabel(season)}` : ""}` };
  const known = pts.filter((p) => p.y != null) as { e: TeamEvent; y: number }[];
  if (!known.length) return { ...base, blocks: [], none: `No ${metric.label.toLowerCase()} by event${season != null ? ` in ${seasonLabel(season)}` : ""} for ${who} yet.` };
  const last = known[known.length - 1];
  const dir = direction(known.map((p) => p.y), metric.lowerIsBetter);
  const best = [...known].sort((a, b) => (metric.lowerIsBetter ? a.y - b.y : b.y - a.y))[0];
  const rated = set.seasons.find((s) => s.season === season);
  const series: StatBlock = { kind: "series", title: `${metric.label}, event by event`, unit: metric.unit, points: pts.map((p) => ({ x: p.e.name, y: p.y == null ? null : Math.round(p.y * 100) / 100, href: eventHref(p.e.season, p.e.code, team.number), note: dateRange(p.e.start, p.e.end) })) };
  const kpis: StatBlock = { kind: "kpis", items: [
    { label: "Latest", value: fmt(last.y, metric), sub: last.e.name, href: eventHref(last.e.season, last.e.code, team.number) },
    ...(dir ? [{ label: "Trend", value: dir.word, sub: `against ${fmt(known[known.length - 2].y, metric)} at the event before`, tone: dir.tone }] : []),
    { label: metric.lowerIsBetter ? "Lowest" : "Best", value: fmt(best.y, metric), sub: best.e.name, href: eventHref(best.e.season, best.e.code, team.number) },
    // Beside an OPR trend, the season's prediction rating as the team page shows it (stored; it has no per-event row).
    ...(id === "opr-history" && rated?.rating != null ? [{ label: "Prediction rating", value: `${fmt(rated.rating, { digits: 1 })}${rated.ratingSd != null ? ` ± ${fmt(rated.ratingSd, { digits: 1 })}` : ""}`, sub: `${seasonLabel(rated.season)}${rated.ratingRank != null ? ` · world #${rated.ratingRank.toLocaleString("en-US")}` : ""}`, href: teamHref(team.number, rated.season) }] : []),
  ] };
  return {
    ...base,
    headline: { value: fmt(last.y, metric), label: `${metric.label} at ${last.e.name}${dir ? ` · ${dir.word}` : ""}`, sub: [seasonLabel(last.e.season), dateRange(last.e.start, last.e.end)].filter(Boolean).join(" · "), href: eventHref(last.e.season, last.e.code, team.number) },
    blocks: [kpis, series, ...switcher(id, team, set.events, season)],
  };
}

/** The other seasons the same per-event trend can be read for, newest first: each opens that season's answer. */
function switcher(id: IntentId, team: AnswerTeam, events: TeamEvent[], season: number | null): StatBlock[] {
  const others = [...new Set(events.filter((e) => e.matches > 0 && e.season !== season).map((e) => e.season))].sort((a, b) => b - a);
  if (!others.length) return [];
  const words = SWITCH_WORDS[id] ?? id.replace(/-/g, " ");
  return [{ kind: "links", title: "Other seasons", items: others.map((s) => ({ label: seasonLabel(s), href: `/search?q=${encodeURIComponent(`${team.number} ${words} in ${seasonLabel(s)}`)}` })) }];
}
const SWITCH_WORDS: Partial<Record<IntentId, string>> = { "opr-history": "opr history", "win-rate": "win rate by event", "avg-penalties": "penalties trend", "avg-score-by-event": "average score by event", "ranking-points": "ranking points by event" };

export function seasonTrend(id: "opr-by-season" | "record-by-season", team: AnswerTeam, all: TeamSeason[]): StatAnswer {
  const ss = all.filter((s) => s.matches > 0);
  const who = whoOf(team);
  const opr = id === "opr-by-season";
  const title = opr ? "OPR standing by season" : "Record by season";
  const span = ss.length ? `${seasonLabel(ss[0].season)}${ss.length > 1 ? ` to ${seasonLabel(ss[ss.length - 1].season)}` : ""}` : "";
  const base = {
    family: "trend" as const, intent: id, title, team, scope: ["All seasons"],
    definition: opr
      ? "OPR standing by season: the team's rank by season OPR (without penalties) among every team with a season OPR, as its team page shows, and the share of them it was ahead of. Each season is a different game, so an OPR number is never compared across seasons; the standing is."
      : "Record by season: the team's wins, losses and ties each season, as its team page shows (every match played, playoffs included).",
    source: ss.length ? `From ${ss.length} season record${ss.length === 1 ? "" : "s"}, ${span}` : "No seasons with matches",
  };
  if (!ss.length) return { ...base, blocks: [], none: `No seasons with matches for ${who} yet.` };
  const latest = ss[ss.length - 1];
  const share = (s: TeamSeason) => (s.rank != null && s.of ? Math.max(1, Math.ceil((100 * s.rank) / s.of)) : null);
  if (opr) {
    // Owner rule: a raw OPR is never compared across seasons (each is a different game). The line is the standing.
    const ahead = (s: TeamSeason) => (s.rank != null && s.of ? Math.round((100 * (s.of - s.rank)) / s.of) : null);
    return {
      ...base,
      headline: share(latest) != null
        ? { value: `Top ${share(latest)}%`, label: `worldwide by OPR in ${seasonLabel(latest.season)}`, sub: `OPR rank #${latest.rank} of ${latest.of}`, href: teamHref(team.number, latest.season) }
        : { value: "Not ranked", label: `in ${seasonLabel(latest.season)} (no season OPR yet)`, href: teamHref(team.number, latest.season) },
      blocks: [
        { kind: "series", title: "Ahead of this share of ranked teams, by OPR", unit: "%", points: ss.map((s) => ({ x: seasonLabel(s.season), y: ahead(s), href: teamHref(team.number, s.season), note: s.rank != null ? `#${s.rank} of ${s.of}` : "not ranked" })) },
        { kind: "table", title: "Each season (a different game each year)", columns: [{ key: "season", label: "Season" }, { key: "rank", label: "OPR rank" }, { key: "share", label: "Standing" }],
          rows: [...ss].reverse().map((s) => ({ cells: { season: seasonLabel(s.season), rank: s.rank != null ? `#${s.rank} of ${s.of}` : "–", share: share(s) != null ? `top ${share(s)}%` : "–" }, href: teamHref(team.number, s.season), strong: s === latest })) },
      ],
    };
  }
  const rec = (s: TeamSeason) => `${s.wins}-${s.losses}-${s.ties}`;
  const rate = (s: TeamSeason) => { const n = s.wins + s.losses + s.ties; return n ? Math.round((100 * s.wins) / n) : null; };
  return {
    ...base,
    headline: { value: rec(latest), label: `in ${seasonLabel(latest.season)}${rate(latest) != null ? ` · ${rate(latest)}% wins` : ""}`, href: teamHref(team.number, latest.season) },
    blocks: [
      { kind: "series", title: "Win rate by season", unit: "%", points: ss.map((s) => ({ x: seasonLabel(s.season), y: rate(s), href: teamHref(team.number, s.season), note: rec(s) })) },
      { kind: "table", title: "Each season", columns: [{ key: "season", label: "Season" }, { key: "record", label: "W-L-T" }, { key: "rate", label: "Win rate", num: true }, { key: "events", label: "Events", num: true }],
        rows: [...ss].reverse().map((s) => ({ cells: { season: seasonLabel(s.season), record: rec(s), rate: rate(s) != null ? `${rate(s)}%` : "–", events: s.events }, href: teamHref(team.number, s.season), strong: s === latest })) },
    ],
  };
}

/** "12345 total penalties in 2025-26": the penalty points the team's alliances gave away that season, event by event. */
export function penaltyTotalAnswer(team: AnswerTeam, set: { events: TeamEvent[] }, scope: Scope): StatAnswer {
  const season = seasonOf(scope, set.events);
  const evs = set.events.filter((e) => e.season === season && e.matches > 0 && e.avgPen != null);
  const total = evs.reduce((n, e) => n + (e.avgPen ?? 0) * e.matches, 0);
  const matches = evs.reduce((n, e) => n + e.matches, 0);
  const title = `Penalty points given${season != null ? ` in ${seasonLabel(season)}` : ""}`;
  const base = {
    family: "aggregate" as const, intent: "total-penalties", title, team, scope: scopeChips({ ...scope, season }),
    definition: `Penalty points given: the penalty points the team's alliances gave the other alliance, in the qualification matches the team played (each event's average per match times its qualification matches there). They are the alliance's fouls, shared by its teams.${scope.season == null && season != null ? ` The season is ${seasonLabel(season)}, the team's latest with events played.` : ""}`,
    source: `From ${evs.length} event record${evs.length === 1 ? "" : "s"}`,
  };
  if (!evs.length) return { ...base, blocks: [], none: `No penalty records${season != null ? ` in ${seasonLabel(season)}` : ""} for ${whoOf(team)} yet.` };
  return {
    ...base,
    headline: { value: `${Math.round(total)} points`, label: `given in ${matches} qualification matches · ${(total / matches).toFixed(1)} per match`, sub: season != null ? seasonLabel(season) : undefined },
    blocks: [
      { kind: "table", title: "By event", columns: [{ key: "event", label: "Event" }, { key: "avg", label: "A match", num: true }, { key: "n", label: "Matches", num: true }, { key: "total", label: "Total", num: true }],
        rows: evs.map((e) => ({ cells: { event: e.name, avg: (e.avgPen ?? 0).toFixed(1), n: e.matches, total: Math.round((e.avgPen ?? 0) * e.matches) }, href: eventHref(e.season, e.code, team.number) })) },
    ],
  };
}
