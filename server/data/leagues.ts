// A season's leagues and FIRST's official league standings (/leagues/rankings), read by the sync. A league meet's own
// rankings are the league's running standing too, but the event bundle keeps only the meet's own teams
// (sources/first.ts), so the whole table is read here, one request per league. A league is read again while one of its
// meets was in the last few days (scores still move) and at most every few hours; one whose meets are all long past is
// read once and kept.
import type { InStatement } from "@libsql/client";
import { all, kvGet, kvSet, run, writeBatch } from "../db.js";
import { firstGet } from "../sources/first.js";

/** Leagues read per sync: one request each. */
export const LEAGUES_PER_SYNC = 40;
/** A league is read again this long after its last read… */
export const REREAD_HOURS = 6;
/** …while its latest meet started at most this many days before. */
export const SETTLE_DAYS = 3;

export interface LeagueRow { region: string; code: string; name: string | null; location: string | null }
export interface LeagueRankingRow { team: number; rank: number; rs: number | null; tbp: number | null; wins: number | null; losses: number | null; ties: number | null; played: number | null; counted: number | null }

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** FIRST's /leagues answer as rows (a league with no region or code is dropped). */
export function leagueRows(body: any): LeagueRow[] {
  return (body?.leagues ?? []).flatMap((l: any) => {
    const region = str(l?.region), code = str(l?.code);
    return region && code ? [{ region, code, name: str(l.name), location: str(l.location) }] : [];
  });
}

/** FIRST's /leagues/rankings answer as rows, ranked teams only. */
export function leagueRankingRows(body: any): LeagueRankingRow[] {
  return (body?.rankings ?? []).flatMap((r: any) => {
    const team = num(r?.teamNumber), rank = num(r?.rank);
    return team && rank ? [{ team, rank, rs: num(r.sortOrder1), tbp: num(r.sortOrder2), wins: num(r.wins), losses: num(r.losses), ties: num(r.ties), played: num(r.matchesPlayed), counted: num(r.matchesCounted) }] : [];
  });
}

/** Store one league's standings (replacing what's there) and when they were read. */
export function rankingStatements(season: number, region: string, league: string, rows: LeagueRankingRow[], at: string): InStatement[] {
  return [
    { sql: "DELETE FROM league_rankings WHERE season = ? AND region = ? AND league = ?", args: [season, region, league] },
    ...rows.map((r) => ({ sql: "INSERT OR REPLACE INTO league_rankings (season, region, league, team, rank, rs, tbp, wins, losses, ties, played, counted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [season, region, league, r.team, r.rank, r.rs, r.tbp, r.wins, r.losses, r.ties, r.played, r.counted] })),
    { sql: "INSERT INTO leagues (season, region, code, ranked_at, tried_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (season, region, code) DO UPDATE SET ranked_at = excluded.ranked_at, tried_at = excluded.tried_at", args: [season, region, league, at, at] },
  ];
}

/**
 * Read the season's league list (once a day) and the standings of the leagues that are due: a league with a meet
 * that has started, never read, or last read over REREAD_HOURS ago and before its latest started meet was SETTLE_DAYS
 * old (so a league whose window was missed, the server down or FIRST failing, still catches up once). At most `limit`
 * leagues, those never tried first, then the longest since tried; a failed read, or no answer from FIRST, keeps what's
 * stored and is tried again REREAD_HOURS later.
 */
export async function syncLeagues(season: number, o: { past?: boolean; limit?: number; now?: Date; fetch?: (path: string) => Promise<unknown> } = {}): Promise<{ listed: number; ranked: number; failed: number }> {
  const out = { listed: 0, ranked: 0, failed: 0 };
  const now = o.now ?? new Date();
  const at = now.toISOString(), today = at.slice(0, 10);
  const get = o.fetch ?? ((path: string) => firstGet<any>(path));
  const listedKey = `leagues:listed:${season}`;
  // A past season's list never changes: read once.
  const last = await kvGet<string>(listedKey);
  if (last !== today && !(last && o.past)) {
    try {
      const rows = leagueRows(await get(`/${season}/leagues`));
      if (rows.length) {
        await writeBatch(rows.map((l) => ({ sql: "INSERT INTO leagues (season, region, code, name, location) VALUES (?, ?, ?, ?, ?) ON CONFLICT (season, region, code) DO UPDATE SET name = excluded.name, location = excluded.location", args: [season, l.region, l.code, l.name, l.location] })));
        await kvSet(listedKey, today);
      }
      out.listed = rows.length;
    } catch { out.failed++; }
  }
  const stale = new Date(now.getTime() - REREAD_HOURS * 3600e3).toISOString();
  const due = await all<{ region: string; league: string }>(
    `SELECT e.region, e.league, MAX(e.start) latest, l.ranked_at, l.tried_at FROM events e LEFT JOIN leagues l ON l.season = e.season AND l.region = e.region AND l.code = e.league
     WHERE e.season = ? AND e.type = 'LeagueMeet' AND e.league IS NOT NULL AND e.region IS NOT NULL AND e.start <= ?
     GROUP BY e.region, e.league
     HAVING (l.tried_at IS NULL OR l.tried_at < ?) AND (l.ranked_at IS NULL OR l.ranked_at < date(latest, '+${SETTLE_DAYS} days'))
     ORDER BY l.ranked_at IS NOT NULL, l.tried_at IS NOT NULL, l.tried_at, latest DESC`,
    [season, today, stale]);
  for (const { region, league } of due.slice(0, o.limit ?? LEAGUES_PER_SYNC)) {
    // An attempt, whatever comes of it: a league that fails waits REREAD_HOURS like any other, so it never holds the
    // sync's slots from the rest.
    await run("INSERT INTO leagues (season, region, code, tried_at) VALUES (?, ?, ?, ?) ON CONFLICT (season, region, code) DO UPDATE SET tried_at = excluded.tried_at", [season, region, league, at]);
    let body: unknown;
    try { body = await get(`/${season}/leagues/rankings/${encodeURIComponent(region)}/${encodeURIComponent(league)}`); }
    catch { out.failed++; continue; }
    // Not found, or nothing ranked (FIRST answers a 404 or an empty list before a league's standings exist): nothing
    // replaced, asked again next sync.
    const rows = body == null ? [] : leagueRankingRows(body);
    if (!rows.length) { out.failed++; continue; }
    await writeBatch(rankingStatements(season, region, league, rows, at));
    out.ranked++;
  }
  return out;
}
