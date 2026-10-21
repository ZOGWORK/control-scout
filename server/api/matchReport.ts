// Pre-match scouting report (v1.6 Task 2), the public half: one match and, for every team in it, its
// standing at the event, its season OPR split and world rank, its event-by-event OPR trend and the data
// flags (the rules: src/shared/matchReport.ts). The same for everyone, so it caches like the event page.
// The workspace half (consensus, pick list, assignments) is server/scout/matchReport.ts, members only.
//
// Cost: the event detail (cached), plus four small queries for the whole lineup, however many teams, and
// the season's flag cutoffs (two scans of one season, rebuilt at most every CUTOFF_TTL_MS and then in the
// background, so after the first build no visitor waits for them).
import { all } from "../db.js";
import { cachedEventDetail } from "./events.js";
import { matchDetail } from "./matches.js";
import {
  dataFlags, MIN_EVENT_MATCHES, MIN_SEASON_MATCHES, topCutoff,
  type FlagCutoffs, type MatchReport, type ReportTeam, type TrendPoint,
} from "../../src/shared/matchReport.js";

export const CUTOFF_TTL_MS = 10 * 60_000;
interface CutoffBuild { at: number; value: Promise<FlagCutoffs>; done?: FlagCutoffs }
/** The newest build per season. */
const cutoffCache = new Map<number, CutoffBuild>();
/** The newest finished cutoffs per season: what reports use while a newer build runs. */
const lastCutoffs = new Map<number, FlagCutoffs>();
/** Tests: forget the cutoffs. */
export function clearCutoffCache() { cutoffCache.clear(); lastCutoffs.clear(); }

/** The season's "top 15%" lines for the data flags. Once they're older than CUTOFF_TTL_MS they're rebuilt in
 *  the background while the previous set answers (they move little between rebuilds): only a season's very
 *  first build is waited for. */
export function seasonCutoffs(season: number): Promise<FlagCutoffs> {
  let hit = cutoffCache.get(season);
  if (!hit || Date.now() - hit.at >= CUTOFF_TTL_MS) hit = buildCutoffs(season);
  if (hit.done) return Promise.resolve(hit.done);
  const prev = lastCutoffs.get(season);
  return prev ? Promise.resolve(prev) : hit.value;
}

function buildCutoffs(season: number): CutoffBuild {
  const build: CutoffBuild = { at: Date.now(), value: computeCutoffs(season) };
  // A failure isn't kept: the next report asks again (the previous set, if any, answers meanwhile).
  build.value.then((v) => { build.done = v; if (cutoffCache.get(season) === build) lastCutoffs.set(season, v); }, () => { if (cutoffCache.get(season) === build) cutoffCache.delete(season); });
  cutoffCache.set(season, build);
  return build;
}

function computeCutoffs(season: number): Promise<FlagCutoffs> {
  return (async (): Promise<FlagCutoffs> => {
    const [pen, cv, evs] = await Promise.all([
      all<{ x: number }>("SELECT opr_pen x FROM team_season_stats WHERE season = ? AND matches >= ? AND opr_pen IS NOT NULL", [season, MIN_SEASON_MATCHES]),
      all<{ x: number }>("SELECT np_dev / np_avg x FROM team_season_records WHERE season = ? AND played >= ? AND np_avg > 0 AND np_dev IS NOT NULL", [season, MIN_SEASON_MATCHES]),
      // Every team's event OPRs in the trend's order, for the season's rises (first event to latest).
      all<{ team: number; opr: number }>(
        `SELECT s.team, s.opr_np opr FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code
          WHERE s.season = ? AND s.matches >= ? AND s.opr_np IS NOT NULL ORDER BY s.team, e.start, e.code`, [season, MIN_EVENT_MATCHES]),
    ]);
    const firstLast = new Map<number, { first: number; last: number; n: number }>();
    for (const r of evs) {
      const t = Number(r.team), o = Number(r.opr);
      const x = firstLast.get(t);
      if (x) { x.last = o; x.n++; } else firstLast.set(t, { first: o, last: o, n: 1 });
    }
    const rises = [...firstLast.values()].filter((x) => x.n >= 2).map((x) => x.last - x.first);
    return { penalties: topCutoff(pen.map((r) => Number(r.x))), inconsistent: topCutoff(cv.map((r) => Number(r.x))), rising: topCutoff(rises) };
  })();
}

const n = (x: unknown) => (x == null ? null : Number(x));

/** The report for one match, or null when there's no such event or match. */
export async function matchReport(season: number, code: string, key: string): Promise<MatchReport | null> {
  // The event detail, cached like the event page's (a live event's is built fresh), handed to matchDetail.
  const ev = await cachedEventDetail(season, code);
  const d = ev ? await matchDetail(season, code, key, ev) : null;
  if (!d || !ev) return null;
  const m = d.match;
  const numbers = [...new Set([...m.red.teams, ...m.blue.teams].map((t) => t.number))];
  if (!numbers.length) return { event: ev.event, live: ev.live, match: m, description: d.description, bonus: d.bonus, teams: [], prev: d.prev, next: d.next };
  const ph = numbers.map(() => "?").join(",");
  const [stats, records, events, cut] = await Promise.all([
    all<any>(`SELECT team, opr_np, opr_pen, rank_np, ranked_teams, matches, wins, losses, ties FROM team_season_stats WHERE season = ? AND team IN (${ph})`, [season, ...numbers]),
    all<any>(`SELECT team, played, np_dev, np_avg FROM team_season_records WHERE season = ? AND team IN (${ph})`, [season, ...numbers]),
    all<any>(
      `SELECT s.team, e.code, e.name, e.start, s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, s.matches FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code
        WHERE s.season = ? AND s.team IN (${ph}) AND s.opr_np IS NOT NULL ORDER BY e.start, e.code`, [season, ...numbers]),
    seasonCutoffs(season),
  ]);
  const statBy = new Map(stats.map((s) => [Number(s.team), s]));
  const recBy = new Map(records.map((r) => [Number(r.team), r]));
  const fieldBy = new Map(ev.field.map((f) => [f.team, f]));
  const teams: ReportTeam[] = numbers.map((team) => {
    const s = statBy.get(team), r = recBy.get(team), f = fieldBy.get(team), info = d.teams[team];
    const mine = events.filter((e) => Number(e.team) === team);
    const trend: TrendPoint[] = mine.filter((e) => Number(e.matches ?? 0) >= MIN_EVENT_MATCHES)
      .map((e) => ({ code: e.code, name: e.name, start: e.start ?? null, opr: Number(e.opr_np) }));
    // The season OPR is the best event OPR, while the stored per-part bests can come from different events:
    // take the split from the event that gives the season OPR, so the parts belong to the total shown.
    const seasonNp = s ? n(s.opr_np) : null;
    const best = mine.reduce<any>((b, e) => (b == null || (seasonNp != null ? Math.abs(Number(e.opr_np) - seasonNp) < Math.abs(Number(b.opr_np) - seasonNp) : Number(e.opr_np) > Number(b.opr_np)) ? e : b), null);
    return {
      team, name: info?.name ?? null, city: info?.city ?? null, state: info?.state ?? null,
      event: f ? { rank: f.rank, wins: f.wins, losses: f.losses, ties: f.ties, qualPlayed: f.qualPlayed, opr: f.opr } : null,
      season: s ? {
        opr: { np: seasonNp, auto: best ? n(best.opr_auto) : null, teleop: best ? n(best.opr_teleop) : null, endgame: best ? n(best.opr_endgame) : null, pen: n(s.opr_pen) },
        rank: n(s.rank_np), of: n(s.ranked_teams), matches: Number(s.matches ?? 0), wins: Number(s.wins ?? 0), losses: Number(s.losses ?? 0), ties: Number(s.ties ?? 0),
      } : null,
      trend,
      flags: dataFlags({
        penOpr: s ? n(s.opr_pen) : null, seasonMatches: Number(s?.matches ?? 0),
        npDev: r ? n(r.np_dev) : null, npAvg: r ? n(r.np_avg) : null, qualPlayed: Number(r?.played ?? 0), trend,
      }, cut),
    };
  });
  return { event: ev.event, live: ev.live, match: m, description: d.description, bonus: d.bonus, teams, prev: d.prev, next: d.next };
}
