// Predictions in search: the engine's own numbers, never worked out here.
//   Two teams ("4215 vs 6980 prediction", "4215 win probability against 6980", "4215 expected margin against 6980"):
//     the call /api/predict/match makes for the same lineup (one team on each alliance, a qualification match), from
//     the ratings the pages already hold (readyForecaster: search never starts a ratings build). The ratings shown
//     are the stored season rows the team pages show.
//   One team's next event ("4215 chance to win an event", "4215 advancement chances"): the projection the background
//     job stored for that event (server/projections/store.ts: event_projections), read as the event page reads it.
//     No stored projection: the card names the event and says the projection isn't published yet. Never a guess.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { eventToday } from "../../../../src/shared/eventDay.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { predictHref } from "../../../../src/shared/predictUrl.js";
import { advanceStatus } from "../../../../src/shared/projections.js";
import { CURRENT_SEASON, FIRST_PREDICT_SEASON, isLegacy } from "../../../data/seasons.js";
import { all } from "../../../db.js";
import { ROSTER } from "../../../data/registrations.js";
import { isEnabled } from "../../../flags.js";
import { readyForecaster, recentRecords } from "../../../predict/engine.js";
import { readProjections } from "../../../projections/store.js";
import { eventHref, teamHref } from "../matchSet.js";
import type { IntentId } from "../read.js";
import { whoOf, type AnswerTeam } from "./matches.js";
import { answerSeason } from "./twoTeam.js";

const pct = (p: number) => `${Math.round(100 * p)}%`;
const num1 = (x: number | null | undefined) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));

const PREDICT_RULE = "The engine's call for one team on each alliance in a qualification match, as Predict makes it for the same lineup: each side's expected score (without penalties, margin-calibrated), the win chance and the predicted margin. It rests on each team's prediction rating (points per match ± its uncertainty) as their team pages show it. A real FTC match is two alliances of two, so a real match's call also needs the partners: Predict works it out for any lineup.";

interface RatingRow { team: number; rating_np: number | null; rating_sd: number | null; rating_rank: number | null }

/** The season a prediction reads when none is named: the latest completed one when both teams have a rating there,
 *  else the latest predicted season both have one in (said so), else the latest completed one (its card says what's
 *  missing). */
export async function predictionSeason(a: number, b: number): Promise<{ season: number; why: string }> {
  const def = answerSeason();
  const rows = await all<{ season: number; n: number }>(`SELECT season, COUNT(*) n FROM team_season_stats WHERE team IN (?, ?) AND rating_np IS NOT NULL AND season >= ? GROUP BY season HAVING COUNT(*) = 2 ORDER BY season DESC`, [a, b, FIRST_PREDICT_SEASON]);
  const both = rows.map((r) => Number(r.season));
  if (both.includes(def) || !both.length) return { season: def, why: `The season is ${seasonLabel(def)}, the latest completed season.` };
  return { season: both[0], why: `The season is ${seasonLabel(both[0])}, the latest season both teams have a prediction rating in.` };
}

/** "4215 vs 6980 prediction", "who wins", "predicted score", "expected margin", "win probability". */
export async function pairPrediction(intent: string, title: string, a: AnswerTeam, b: AnswerTeam, season: number, why?: string): Promise<StatAnswer> {
  const S = seasonLabel(season);
  const base = { family: "two-team" as const, intent, title, team: a, teams: [a, b], scope: [S, "Qualification match, one team per alliance"], definition: `${PREDICT_RULE}${why ? ` ${why}` : ""}`, source: `From the engine's ${S} prediction ratings` };
  const links: StatBlock = { kind: "links", title: "Try it", items: [
    ...(isLegacy(season) ? [] : [{ label: `Predict ${a.number} vs ${b.number}`, href: predictHref({ mode: "match", season, red: [a.number], blue: [b.number] }) }]),
    { label: "Compare side by side", href: `/compare?teams=${[a.number, b.number].sort((x, y) => x - y).join(",")}&season=${season}` },
  ] };
  if (isLegacy(season)) return { ...base, blocks: [links], none: `Predictions start with 2023–24: ${S} has no prediction ratings.` };
  const rows = await all<RatingRow>("SELECT team, rating_np, rating_sd, rating_rank FROM team_season_stats WHERE season = ? AND team IN (?, ?)", [season, a.number, b.number]);
  const ra = rows.find((r) => Number(r.team) === a.number), rb = rows.find((r) => Number(r.team) === b.number);
  const missing = [ra?.rating_np == null ? whoOf(a) : "", rb?.rating_np == null ? whoOf(b) : ""].filter(Boolean);
  if (missing.length) return { ...base, blocks: [links], none: `No ${S} prediction rating for ${missing.join(" or ")} yet.` };
  const rating = (t: AnswerTeam, r: RatingRow, lead: boolean) => ({ label: whoOf(t), value: `${num1(r.rating_np)} ±${Math.round(r.rating_sd ?? 0)}`, sub: r.rating_rank ? `Rating · #${r.rating_rank} worldwide` : "Rating", href: teamHref(t.number, season), ...(lead ? { tone: "accent" as const } : {}) });
  const off = !(await isEnabled("livePredictions").catch(() => false));
  const f = off ? null : readyForecaster(season);
  const x = f ? (await f).explain(season, [a.number], [b.number], "qual", undefined, await recentRecords(season, [a.number, b.number])) : null;
  if (!x) {
    // No call to show: the ratings, said plainly, never a made-up score.
    const gap = Number(ra!.rating_np) - Number(rb!.rating_np), ahead = gap >= 0 ? a : b;
    return { ...base, headline: { value: `${ahead.number} rated higher`, label: `by ${num1(Math.abs(gap))} points per match`, sub: off ? "Live predictions are switched off just now." : "The engine's ratings are still loading: Predict shows the call." },
      blocks: [{ kind: "kpis", items: [rating(a, ra!, gap > 0), rating(b, rb!, gap < 0)] }, links] };
  }
  const pa = x.winProbA, sa = x.predictedScoreA, sb = x.predictedScoreB, margin = sa - sb;
  const fav = pa >= 0.5 ? a : b, favP = Math.max(pa, 1 - pa);
  const even = Math.abs(pa - 0.5) < 0.005;
  return {
    ...base,
    headline: {
      value: even ? "Even" : `${fav.number} favoured`,
      label: `${pct(favP)} to win · predicted ${Math.round(sa)}–${Math.round(sb)}`,
      sub: `Predicted margin ${margin === 0 ? "0" : `${margin > 0 ? a.number : b.number} by ${Math.abs(Math.round(margin))}`} points · ratings ${num1(ra!.rating_np)} vs ${num1(rb!.rating_np)}`,
      href: predictHref({ mode: "match", season, red: [a.number], blue: [b.number] }),
    },
    blocks: [
      { kind: "kpis", items: [
        { label: `${a.number} win chance`, value: pct(pa), ...(pa > 0.5 ? { tone: "good" as const } : {}) },
        { label: `${b.number} win chance`, value: pct(1 - pa), ...(pa < 0.5 ? { tone: "good" as const } : {}) },
        { label: "Predicted margin", value: `${Math.abs(Math.round(margin))} pts`, sub: margin === 0 ? "Level" : `${margin > 0 ? a.number : b.number} ahead` },
        { label: "Confidence", value: x.confidence.tier[0].toUpperCase() + x.confidence.tier.slice(1), sub: x.confidence.reason },
      ] },
      { kind: "bars", title: "Predicted score", unit: "pts", groups: [{ label: "Qualification match", items: [{ label: String(a.number), value: Math.round(sa), tone: "a" }, { label: String(b.number), value: Math.round(sb), tone: "b" }] }] },
      { kind: "table", title: "Score ranges", columns: [{ key: "team", label: "Team" }, { key: "score", label: "Predicted", num: true }, { key: "range", label: `${Math.round(100 * x.scoreBandA.level)}% range` }],
        rows: [[a, sa, x.scoreRangeA], [b, sb, x.scoreRangeB]].map(([t, s, r]) => ({ cells: { team: whoOf(t as AnswerTeam), score: Math.round(s as number), range: `${Math.round((r as [number, number])[0])}–${Math.round((r as [number, number])[1])}` }, href: teamHref((t as AnswerTeam).number, season) })) },
      { kind: "kpis", items: [rating(a, ra!, Number(ra!.rating_np) > Number(rb!.rating_np)), rating(b, rb!, Number(rb!.rating_np) > Number(ra!.rating_np))] },
      links,
    ],
  };
}

const NEXT_TITLES: Partial<Record<IntentId, string>> = { "next-event-wins": "Predicted wins, next event", "event-win-chance": "Chance to win their next event", "advance-chance": "Advancement chance", "playoff-chance": "Playoff chance, next event" };
const NEXT_RULE = "From the engine's stored projection for the event (the event page's Forecast): thousands of simulated runs of the event's qualification schedule and alliance selection from the prediction ratings. Advancement counts competition-performance slots only (no award points). Nothing is simulated for a search.";

/** The team's next event and the engine's stored projection for it, or the honest card when none is stored. */
export async function nextEventPrediction(id: IntentId, team: AnswerTeam, now = new Date(), event?: { season: number; code: string }, season: number | null = null): Promise<StatAnswer> {
  const title = NEXT_TITLES[id] ?? "Prediction";
  // The events a team is listed for (a FIRST registration counts), as "when is <team>'s next event" reads them.
  // A day either side in UTC, then the venue's own today: the day after a meet, it's no longer the next event.
  const yesterday = new Date(now.getTime() - 864e5).toISOString().slice(0, 10);
  // An event named ("at New Jersey Championship") is that event, whenever it is; else the next one.
  type Ev = { season: number; code: string; name: string; start: string | null; end: string | null; city: string | null; state: string | null; timezone: string | null };
  const e = event
    ? (await all<Ev>("SELECT season, code, name, start, end, city, state, timezone FROM events WHERE season = ? AND code = ?", [event.season, event.code]))[0]
    : (await all<Ev>(
      `SELECT DISTINCT e.season, e.code, e.name, e.start, e.end, e.city, e.state, e.timezone FROM ${ROSTER} et JOIN events e ON e.season = et.season AND e.code = et.code
       WHERE et.team = ? AND COALESCE(e.end, e.start) >= ?${season != null ? " AND e.season = ?" : ""} ORDER BY e.start, e.code LIMIT 10`,
      [team.number, yesterday, ...(season != null ? [season] : [])]))
      .find((x) => (x.end ?? x.start ?? "") >= eventToday(now.getTime(), x.timezone).from);
  // A season named is the only one looked in: no upcoming event in it is said so, never another season's shown.
  const S = seasonLabel(e ? Number(e.season) : season ?? CURRENT_SEASON);
  const base = { family: "stat" as const, intent: id, title, team, scope: [S, event ? e?.name ?? "Event" : "Next event"], definition: NEXT_RULE, source: e ? `${e.name}, ${S}` : `${team.number}'s published events` };
  if (!e) return { ...base, blocks: [], none: `No upcoming event is published for ${whoOf(team)} in ${S} yet, so there's no projection to show.` };
  const when = [dateRange(e.start, e.end), [e.city, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const evLink: StatBlock = { kind: "links", title: event ? "Event" : "Next event", items: [{ label: e.name, sub: when, href: eventHref(Number(e.season), e.code, team.number) }] };
  // The forecast's own switch (advancementOdds): off, the event page shows none, so search shows none either.
  if (!(await isEnabled("advancementOdds").catch(() => false))) {
    return { ...base, headline: { value: "Switched off", label: `${e.name} · ${when}`, href: eventHref(Number(e.season), e.code, team.number) }, blocks: [evLink], none: "Event forecasts are switched off just now, so no chance is shown." };
  }
  const run = (await readProjections(Number(e.season), e.code)).current;
  const row = run?.teams.find((t) => t.team === team.number);
  if (!run || !row) {
    return { ...base, headline: { value: "Not published yet", label: `${e.name} · ${when}`, href: eventHref(Number(e.season), e.code, team.number) },
      blocks: [evLink], none: `The engine hasn't published a projection for ${e.name} yet${row ? "" : run ? ` with ${team.number} in it` : ""}: it runs once the event's team list and schedule are in. No number is guessed in the meantime.` };
  }
  const status = advanceStatus(row);
  const adv = status === "odds" && row.pAdvance != null ? pct(row.pAdvance) : status === "qualified" ? "Already qualified" : status === "ineligible" ? "Not eligible here" : "–";
  const rank = row.rank ? `#${Math.round(row.rank.p50)}` : "–";
  const head = id === "event-win-chance" ? { value: pct(row.pWin), label: `to win ${e.name}` }
    : id === "playoff-chance" ? { value: pct(row.pPlayoff), label: `to make the playoffs at ${e.name}` }
    : id === "advance-chance" ? { value: adv, label: `to advance from ${e.name}${run.slots ? ` (${run.slots} slot${run.slots === 1 ? "" : "s"})` : ""}` }
    : { value: rank, label: `projected qualification rank at ${e.name} (the engine projects ranks, not a win count)` };
  return {
    ...base,
    headline: { ...head, sub: `${when} · ${run.runs.toLocaleString("en-US")} simulated runs, ${run.played} of ${run.scheduled} qualification matches played`, href: eventHref(Number(e.season), e.code, team.number) },
    blocks: [
      { kind: "kpis", items: [
        { label: "Win the event", value: pct(row.pWin) }, { label: "Make the playoffs", value: pct(row.pPlayoff) }, { label: "Advance", value: adv },
        { label: "Projected rank", value: rank, sub: row.rank ? `#${Math.round(row.rank.p10)}–#${Math.round(row.rank.p90)} (P10–P90)` : undefined },
      ] },
      evLink,
    ],
  };
}
