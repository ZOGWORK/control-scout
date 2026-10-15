// Stats job (nightly, and after each sync): per-event and per-season team
// stats, engine ratings, the calibration ledger, and the search index.
// Everything here is recomputed from match data — no stored number is ever
// hand-entered or estimated without saying so.
import type { InStatement } from "@libsql/client";
import { RatingBook, FITTED_MODEL, explainMatch, ENGINE_VERSION, type EventRecord } from "@control-scout/predict-engine";
import { all, get, kvGet, kvSet, run, writeBatch } from "../db.js";
import { CURRENT_SEASON, SEASON_NUMBERS } from "../data/seasons.js";
import { loadSeason, toEventRecord, type DbEvent } from "./load.js";
import { localToUtcMs } from "../data/time.js";
import { oprRows, solveOpr } from "./opr.js";
import { normalize } from "../api/fuzzy.js";
import { forecasterFor } from "../predict/engine.js";
import { regionNames } from "../../src/shared/regions.js";

type Log = (m: string) => void;
const r1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// ---------------------------------------------------------------------------
// Team stats
// ---------------------------------------------------------------------------

interface Acc { matches: number; w: number; l: number; t: number; np: number; score: number; pen: number }
const acc = (): Acc => ({ matches: 0, w: 0, l: 0, t: 0, np: 0, score: 0, pen: 0 });

function tally(a: Acc, own: { total: number; np: number; pen: number }, opp: { total: number }) {
  a.matches++;
  if (own.total > opp.total) a.w++; else if (own.total < opp.total) a.l++; else a.t++;
  a.np += own.np; a.score += own.total; a.pen += own.pen;
}

/** Team → world rank (1 = highest), over finite values at or above `min`. */
export function rankBy(vals: [number, number][], min = -Infinity): Map<number, number> {
  const sorted = vals.filter(([, v]) => Number.isFinite(v) && v >= min).sort((a, b) => b[1] - a[1]);
  return new Map(sorted.map(([t], i) => [t, i + 1]));
}

export async function computeSeasonStats(season: number, events: DbEvent[], log: Log = () => {}): Promise<void> {
  const ev: InStatement[] = [{ sql: "DELETE FROM team_event_stats WHERE season = ?", args: [season] }];
  const best = new Map<number, { np: number; auto: number; teleop: number; endgame: number; pen: number }>();
  const seasonAcc = new Map<number, Acc & { events: Set<string> }>();
  for (const e of events) {
    // Remote-only events have no alliances to separate. Hybrid events are mostly
    // ordinary 2v2 matches (oprRows takes alliances of any size), so they count:
    // skipping them left ~70 events a season, championships included, with no stats.
    if (e.remote) continue;
    const rows = oprRows(e.matches, season);
    const res = rows.length ? solveOpr(rows) : null;
    const perTeam = new Map<number, Acc>();
    for (const m of e.matches) {
      if (!m.played || !m.redScore || !m.blueScore) continue;
      for (const [side, own, opp] of [[m.red, m.redScore, m.blueScore], [m.blue, m.blueScore, m.redScore]] as const) {
        for (const t of side) {
          if (!t.onField) continue;
          if (m.level === "qual" && !t.surrogate) {
            let a = perTeam.get(t.team); if (!a) { a = acc(); perTeam.set(t.team, a); }
            tally(a, own, opp);
          }
          let s = seasonAcc.get(t.team); if (!s) { s = { ...acc(), events: new Set() }; seasonAcc.set(t.team, s); }
          if (!(m.level === "qual" && t.surrogate)) tally(s, own, opp);
          s.events.add(e.code);
        }
      }
    }
    const teams = new Set([...perTeam.keys(), ...(res ? res.rows.keys() : [])]);
    for (const team of teams) {
      const a = perTeam.get(team) ?? acc();
      const o = (c: "np" | "auto" | "teleop" | "endgame" | "pen") => res?.opr[c].get(team) ?? null;
      ev.push({
        sql: "INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, opr_pen, avg_score, avg_np, avg_pen, matches, wins, losses, ties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [season, e.code, team, r1(o("np")), r1(o("auto")), r1(o("teleop")), r1(o("endgame")), r1(o("pen")),
          a.matches ? r1(a.score / a.matches) : null, a.matches ? r1(a.np / a.matches) : null, a.matches ? r1(a.pen / a.matches) : null, a.matches, a.w, a.l, a.t],
      });
      // Season "best" OPR: the best of every event the team played quals at, as FTC Scout ranks it.
      // (OPR can be negative now, so start from -Infinity, not a floor.)
      if (res && res.rows.has(team)) {
        const b = best.get(team) ?? { np: -Infinity, auto: -Infinity, teleop: -Infinity, endgame: -Infinity, pen: Infinity };
        b.np = Math.max(b.np, o("np")!); b.auto = Math.max(b.auto, o("auto")!); b.teleop = Math.max(b.teleop, o("teleop")!);
        b.endgame = Math.max(b.endgame, o("endgame")!); b.pen = Math.min(b.pen, o("pen")!);
        best.set(team, b);
      }
    }
  }
  await writeBatch(ev);

  // Ratings from the shared engine. Past seasons: as of the team's last match
  // (no growth extrapolation); the current season: grown to now, exactly what
  // predictions use.
  const f = await forecasterFor(season);
  const book = f.book(season);
  const rating = (t: number) => {
    if (!book) return null;
    const stored = book.ratings.get(t);
    if (!stored) return null;
    return season === CURRENT_SEASON ? book.get(t) : stored;
  };
  const b = [...best];
  // OPR ranks count every finite value, negatives included (as FTC Scout ranks them).
  const ranks = { np: rankBy(b.map(([t, x]) => [t, x.np])), auto: rankBy(b.map(([t, x]) => [t, x.auto])), teleop: rankBy(b.map(([t, x]) => [t, x.teleop])), endgame: rankBy(b.map(([t, x]) => [t, x.endgame])) };
  const ratingVals: [number, number][] = [];
  for (const t of seasonAcc.keys()) { const r = rating(t); if (r && r.n >= 3) ratingVals.push([t, r.auto + r.teleop + r.endgame]); }
  const ratingRank = rankBy(ratingVals, 0); // ratings keep their floor
  const ss: InStatement[] = [{ sql: "DELETE FROM team_season_stats WHERE season = ?", args: [season] }];
  for (const [team, a] of seasonAcc) {
    const o = best.get(team);
    const r = rating(team);
    ss.push({
      sql: `INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, opr_pen, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams,
              rating_np, rating_auto, rating_teleop, rating_endgame, rating_pen, rating_sd, rating_matches, rating_rank, events, matches, wins, losses, ties, avg_np, avg_score, avg_pen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [season, team, r1(o?.np), r1(o?.auto), r1(o?.teleop), r1(o?.endgame), o && Number.isFinite(o.pen) ? r1(o.pen) : null,
        ranks.np.get(team) ?? null, ranks.auto.get(team) ?? null, ranks.teleop.get(team) ?? null, ranks.endgame.get(team) ?? null, ranks.np.size,
        r ? r1(r.auto + r.teleop + r.endgame) : null, r ? r1(r.auto) : null, r ? r1(r.teleop) : null, r ? r1(r.endgame) : null, r ? r1(r.pen) : null,
        r ? r1(Math.sqrt(r.uncertainty)) : null, r?.n ?? null, ratingRank.get(team) ?? null,
        a.events.size, a.matches, a.w, a.l, a.t, a.matches ? r1(a.np / a.matches) : null, a.matches ? r1(a.score / a.matches) : null, a.matches ? r1(a.pen / a.matches) : null],
    });
  }
  await writeBatch(ss);
  log(`${season}: stats for ${seasonAcc.size} teams, OPR ranks for ${ranks.np.size}`);
}

// ---------------------------------------------------------------------------
// Calibration ledger
// ---------------------------------------------------------------------------

const outcome = (red: number, blue: number) => (red > blue ? 1 : red < blue ? 0 : 0.5);

/**
 * Backtest ("walk-forward"): replay seasons in order; before each match,
 * predict it from ratings that include only earlier matches; record the call
 * and the result. Exactly the protocol of the engine's own back-test (the
 * "live" accuracy in FITTED_MODEL), run over every season we hold.
 */
export async function backtest(seasons: number[], log: Log = () => {}, opts: { write?: number[] } = {}): Promise<void> {
  const book = new RatingBook(FITTED_MODEL.rating);
  const ordered = [...seasons].sort((a, b) => a - b);
  // Seasons whose ledger is rewritten; the others are replayed only to build the ratings.
  const write = new Set(opts.write ?? ordered);
  for (const s of ordered) {
    const events = await loadSeason(s);
    // Scrimmages are predicted too, but never rated: the book doesn't learn from them.
    const unrated = new Set(events.filter((e) => !toEventRecord(e)).map((e) => e.code));
    const recs = events.map((e) => toEventRecord(e, { anyType: true })).filter((x): x is EventRecord => !!x);
    book.startSeason(s);
    const matches = recs.flatMap((e) => e.matches).sort((x, y) => x.time - y.time);
    const stmts: InStatement[] = [{ sql: "DELETE FROM predictions WHERE kind = 'backtest' AND season = ?", args: [s] }];
    const at = new Date().toISOString();
    // Before this season's first rated match there's no scoring baseline: odds stand, predicted scores don't.
    let rated = 0;
    for (const m of matches) {
      if (write.has(s) && m.red.teams.length === 2 && m.blue.teams.length === 2) {
        book.setTime(m.time);
        const x = explainMatch(book, m.red.teams, m.blue.teams, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration });
        stmts.push({
          sql: `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, factors, engine_version, predicted_at, match_time, red_score, blue_score, outcome, scored_at, no_score_basis)
                VALUES ('backtest', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [s, m.eventCode, m.level, m.series, m.number, JSON.stringify(m.red.teams), JSON.stringify(m.blue.teams), x.winProbA, x.predictedScoreA, x.predictedScoreB,
            x.confidence.tier, ENGINE_VERSION, at, new Date(m.time).toISOString(), m.red.total, m.blue.total, outcome(m.red.total, m.blue.total), at, rated ? 0 : 1],
        });
      }
      if (!unrated.has(m.eventCode)) { book.update(m); rated++; }
    }
    if (write.has(s)) {
      await writeBatch(stmts, 5000);
      log(`${s}: backtest ledger ${stmts.length - 1} matches`);
    }
  }
}

/** An unplayed current-season match with no live prediction yet. */
export interface LiveCandidate {
  code: string; level: string; series: number; number: number;
  /** As stored: event-local wall time from FIRST (no zone), or ISO with a zone. */
  time: string | null;
  timezone: string | null;
  /** Real scheduled start (epoch ms); null when the time or zone is unknown. */
  start: number | null;
  red: number[]; blue: number[];
}

/** A live prediction is logged at least this long before the scheduled start. */
export const LIVE_LEAD_MS = 60_000;

/**
 * Whether a candidate goes into the live ledger at `now`: 2-robot alliances
 * (with 3 listed, as in playoffs, we don't know who sits out) and a real,
 * time-zone aware scheduled start at least LIVE_LEAD_MS away. No time or
 * zone = can't prove it's pre-match = skip.
 */
export function liveLoggable(c: LiveCandidate, now = Date.now()): boolean {
  return c.red.length === 2 && c.blue.length === 2 && c.start != null && c.start > now + LIVE_LEAD_MS;
}

/** Unplayed matches of a season not yet in the live ledger, with lineups. Read-only. */
export async function unloggedLiveMatches(season = CURRENT_SEASON): Promise<LiveCandidate[]> {
  const rows = await all<any>(
    `SELECT m.code, m.level, m.series, m.number, m.time, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE m.season = ? AND m.played = 0
       AND NOT EXISTS (SELECT 1 FROM predictions p WHERE p.kind = 'live' AND p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number)`,
    [season],
  );
  if (!rows.length) return [];
  const lineups = await all<any>("SELECT code, level, series, number, team, alliance FROM match_teams WHERE season = ? AND code IN (SELECT DISTINCT code FROM matches WHERE season = ? AND played = 0)", [season, season]);
  const lu = new Map<string, { red: number[]; blue: number[] }>();
  for (const t of lineups) {
    const k = `${t.code}|${t.level}:${t.series}:${t.number}`;
    let l = lu.get(k); if (!l) { l = { red: [], blue: [] }; lu.set(k, l); }
    (t.alliance === "red" ? l.red : l.blue).push(Number(t.team));
  }
  return rows.map((m) => {
    const l = lu.get(`${m.code}|${m.level}:${m.series}:${m.number}`) ?? { red: [], blue: [] };
    return {
      code: m.code, level: m.level, series: Number(m.series), number: Number(m.number), time: m.time ?? null, timezone: m.timezone ?? null,
      start: localToUtcMs(m.time, m.timezone), red: l.red, blue: l.blue,
    };
  });
}

/**
 * Live ledger, step 1: write down a prediction for every scheduled, unplayed
 * match with a known lineup (first write wins — a prediction is never
 * revised once logged, so the record can't learn the answer).
 */
export async function logLivePredictions(log: Log = () => {}): Promise<number> {
  const season = CURRENT_SEASON;
  const candidates = await unloggedLiveMatches(season);
  if (!candidates.some((c) => liveLoggable(c))) return 0;
  const f = await forecasterFor(season);
  // The clock is read after the ratings are built (that can take a while), so
  // the lead-time check and predicted_at are the same instant.
  const now = Date.now();
  const at = new Date(now).toISOString();
  // Saved with each call: whether the season had rated matches when it was made.
  const noScoreBasis = f.seasonEvents(season).length ? 0 : 1;
  const stmts: InStatement[] = [];
  for (const m of candidates) {
    if (!liveLoggable(m, now)) continue;
    const x = f.explain(season, m.red, m.blue);
    if (!x) continue;
    stmts.push({
      sql: `INSERT OR IGNORE INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, factors, engine_version, predicted_at, match_time, no_score_basis)
            VALUES ('live', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [season, m.code, m.level, m.series, m.number, JSON.stringify(m.red), JSON.stringify(m.blue), x.winProbA, x.predictedScoreA, x.predictedScoreB,
        x.confidence.tier, JSON.stringify(x.factors), ENGINE_VERSION, at, m.time, noScoreBasis],
    });
  }
  await writeBatch(stmts);
  if (stmts.length) log(`live ledger: ${stmts.length} new pre-match predictions`);
  return stmts.length;
}

/** Live ledger, step 2: attach results to logged predictions once played. */
export async function scoreLivePredictions(log: Log = () => {}): Promise<number> {
  // A call logged at or after the match's actual start isn't a pre-match call
  // (delays, a sync that ran mid-match): move it out of the live record.
  const due = await all<any>(
    `SELECT p.id, p.predicted_at, m.time, e.timezone FROM predictions p
     JOIN matches m ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
     JOIN events e ON e.season = p.season AND e.code = p.code
     WHERE p.kind = 'live' AND p.outcome IS NULL AND m.played = 1`,
  );
  const late = due.filter((r) => { const start = localToUtcMs(r.time, r.timezone); return start == null || Date.parse(r.predicted_at) >= start; });
  if (late.length) {
    await writeBatch(late.map((r) => ({ sql: "UPDATE predictions SET kind = 'late' WHERE id = ?", args: [r.id] })));
    log(`live ledger: ${late.length} call(s) logged after the match started — excluded from the live record`);
  }
  const n = await run(
    `UPDATE predictions SET
       red_score = (SELECT red_total FROM matches m WHERE m.season = predictions.season AND m.code = predictions.code AND m.level = predictions.level AND m.series = predictions.series AND m.number = predictions.number),
       blue_score = (SELECT blue_total FROM matches m WHERE m.season = predictions.season AND m.code = predictions.code AND m.level = predictions.level AND m.series = predictions.series AND m.number = predictions.number),
       scored_at = ?
     WHERE kind = 'live' AND outcome IS NULL AND EXISTS (
       SELECT 1 FROM matches m WHERE m.season = predictions.season AND m.code = predictions.code AND m.level = predictions.level AND m.series = predictions.series AND m.number = predictions.number AND m.played = 1 AND m.red_total IS NOT NULL)`,
    [new Date().toISOString()],
  );
  await run("UPDATE predictions SET outcome = CASE WHEN red_score > blue_score THEN 1 WHEN red_score < blue_score THEN 0 ELSE 0.5 END WHERE kind = 'live' AND outcome IS NULL AND red_score IS NOT NULL");
  if (n) log(`live ledger: scored ${n} predictions`);
  return n;
}

// ---------------------------------------------------------------------------
// Search index
// ---------------------------------------------------------------------------

export async function rebuildSearch(log: Log = () => {}): Promise<void> {
  const teams = await all<any>(`SELECT t.number, t.name, t.school, t.city, t.state, t.country, MAX(s.season) last FROM teams t LEFT JOIN team_seasons s ON s.team = t.number GROUP BY t.number`);
  const events = await all<any>("SELECT season, code, name, city, state, country, start, type FROM events");
  const stmts: InStatement[] = [{ sql: "DELETE FROM search", args: [] }, { sql: "DELETE FROM search_fuzzy", args: [] }];
  for (const t of teams) {
    const place = [t.city, t.state, t.country].filter(Boolean).join(", ");
    const title = `${t.number} ${t.name ?? ""}`.trim(), subtitle = [t.school, place].filter(Boolean).join(" · ");
    const weight = t.last === CURRENT_SEASON ? 2 : 1;
    stmts.push({ sql: "INSERT INTO search (kind, ref, season, weight, title, subtitle, terms) VALUES ('team', ?, ?, ?, ?, ?, ?)", args: [String(t.number), t.last ?? null, weight, title, subtitle, `${t.number} ${t.name ?? ""} ${t.school ?? ""} ${place} ${regionNames(t.state, t.country)}`] });
    // Typo-tolerant index: the name people type (team name + school).
    // Stored normalised, exactly like the query's chunks ("X-Drive" → "x drive").
    if (t.name || t.school) stmts.push({ sql: "INSERT INTO search_fuzzy (kind, ref, season, weight, title, subtitle, name) VALUES ('team', ?, ?, ?, ?, ?, ?)", args: [String(t.number), t.last ?? null, weight, title, subtitle, normalize(`${t.name ?? ""} ${t.school ?? ""}`)] });
  }
  for (const e of events) {
    const place = [e.city, e.state, e.country].filter(Boolean).join(", ");
    const subtitle = [e.code, e.start, place].filter(Boolean).join(" · "), weight = e.season === CURRENT_SEASON ? 2 : 1;
    stmts.push({ sql: "INSERT INTO search (kind, ref, season, weight, title, subtitle, terms) VALUES ('event', ?, ?, ?, ?, ?, ?)", args: [`${e.season}:${e.code}`, e.season, weight, e.name, subtitle, `${e.code} ${e.name} ${place} ${regionNames(e.state, e.country)}`] });
    stmts.push({ sql: "INSERT INTO search_fuzzy (kind, ref, season, weight, title, subtitle, name) VALUES ('event', ?, ?, ?, ?, ?, ?)", args: [`${e.season}:${e.code}`, e.season, weight, e.name, subtitle, normalize(`${e.name} ${e.city ?? ""}`)] });
  }
  await writeBatch(stmts, 5000);
  await kvSet("search:version", new Date().toISOString());
  log(`search: ${teams.length} teams, ${events.length} events (word + trigram indexes)`);
}

// ---------------------------------------------------------------------------
// The whole job
// ---------------------------------------------------------------------------

export interface StatsOptions { seasons?: number[]; backtest?: boolean; log?: Log }

/**
 * Bump when the rules for per-event stats change, so every host recomputes all
 * seasons once (the scheduled cycle otherwise refreshes only the current one).
 * 2: hybrid events counted (they were skipped, leaving events without stats).
 * 3: OPR computed exactly like FTC Scout (least squares, all listed teams, TeleOp as FIRST reports it).
 */
export const STATS_RULES = 3;

/** True when past seasons were computed under older rules. */
export async function statsRulesStale(): Promise<boolean> {
  return (await kvGet<number>("stats:rules")) !== STATS_RULES;
}

export async function runStats(o: StatsOptions = {}): Promise<void> {
  const log = o.log ?? (() => {});
  // New data → new version: forecasters rebuild (they're keyed by it). No reset: pages keep the
  // last finished ratings until the new ones are built, and frozen seasons stay read (engine.ts).
  await kvSet("data:version", new Date().toISOString());
  const seasons = o.seasons ?? SEASON_NUMBERS;
  for (const s of seasons) {
    const events = await loadSeason(s);
    if (!events.length) { log(`${s}: no data`); continue; }
    await computeSeasonStats(s, events, log);
  }
  const doBacktest = o.backtest ?? !(await get("SELECT 1 FROM predictions WHERE kind = 'backtest' LIMIT 1"));
  // Every season once; after that the current season on every run, so matches played since get their replayed call.
  if (doBacktest) await backtest(SEASON_NUMBERS, log);
  else if (seasons.includes(CURRENT_SEASON)) await backtest(SEASON_NUMBERS, log, { write: [CURRENT_SEASON] });
  await scoreLivePredictions(log);
  await logLivePredictions(log);
  await rebuildSearch(log);
  await kvSet("stats:last", { at: new Date().toISOString(), seasons, engine: ENGINE_VERSION });
  if (seasons.length === SEASON_NUMBERS.length) await kvSet("stats:rules", STATS_RULES);
  const prev = await kvGet<string>("data:version");
  log(`stats done (data version ${prev})`);
}
