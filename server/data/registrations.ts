// FIRST's registered teams for upcoming events (GET /{season}/teams?eventCode=X). FIRST lists them about a
// week ahead, before any rankings or schedule exist. Stored in event_registrations (migration 48), apart from
// event_teams: the event bundle (rankings + schedule, data/bundle.ts) owns that table and replaces it whole on
// every fetch. The event page shows the registrations as the event's teams only while event_teams is empty
// (ROSTER below), and they then also take the place of a regional site's provisional list (api/events.ts).
import { all, kvGet, kvSet, writeBatch } from "../db.js";
import type { InStatement } from "@libsql/client";
import { teamStatements } from "./bundle.js";
import { isLegacy } from "./seasons.js";
import { firstEventTeams } from "../sources/first.js";

/** Read events starting within this many days: FIRST posts registrations about a week ahead. */
export const REGISTRATIONS_AHEAD_DAYS = 14;
/** One read of every such event this often: one request per event, so FIRST's rate limit stays far off. */
export const REGISTRATIONS_EVERY_MS = 6 * 3600_000;

/**
 * An event's teams, as a table to select from: event_teams (its rankings and schedule), else these
 * registrations while it has none. `registered` = 1 on registration rows, with when they were read.
 */
export const ROSTER = `(SELECT season, code, team, rank, rp, tbp, wins, losses, ties, qual_played, dq, 0 registered, NULL fetched_at FROM event_teams
  UNION ALL SELECT r.season, r.code, r.team, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, r.fetched_at FROM event_registrations r
    WHERE NOT EXISTS (SELECT 1 FROM event_teams x WHERE x.season = r.season AND x.code = r.code))`;

export interface RegistrationsReport { events: number; withTeams: number; teams: number; failed: string[]; skipped?: string }

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Read FIRST's registered teams for the season's upcoming events that have no team list yet (no event_teams
 * rows), and replace each one's stored registrations. An event FIRST doesn't know (404) or a failed read keeps
 * what was stored; an empty list clears it (FIRST's list is the official one). Team names and homes FIRST
 * sends along are merged into teams, never blanking known fields. `skipTypes`: event types never read (no matches).
 */
export async function syncRegistrations(season: number, o: { force?: boolean; now?: Date; skipTypes?: Iterable<string> } = {}): Promise<RegistrationsReport> {
  const key = `sync:registrations:${season}`;
  const now = o.now ?? new Date();
  const last = await kvGet<string>(key);
  if (!o.force && last && now.getTime() - Date.parse(last) < REGISTRATIONS_EVERY_MS) return { events: 0, withTeams: 0, teams: 0, failed: [], skipped: "read recently" };
  const skip = [...(o.skipTypes ?? [])];
  const events = await all<{ code: string }>(
    `SELECT e.code FROM events e WHERE e.season = ? AND COALESCE(e.end, e.start) >= ? AND e.start <= ?
       ${skip.length ? `AND COALESCE(e.type, '') NOT IN (${skip.map(() => "?").join(",")})` : ""}
       AND NOT EXISTS (SELECT 1 FROM event_teams t WHERE t.season = e.season AND t.code = e.code)
     ORDER BY e.start, e.code`,
    [season, day(now.getTime()), day(now.getTime() + REGISTRATIONS_AHEAD_DAYS * 864e5), ...skip],
  );
  // Marked before the reads: a failing FIRST waits the same as a good read.
  await kvSet(key, now.toISOString());
  const report: RegistrationsReport = { events: events.length, withTeams: 0, teams: 0, failed: [] };
  const at = now.toISOString();
  // The FIRST client's own limiter bounds how many are in flight.
  const reads = await Promise.all(events.map(async ({ code }) => {
    try { return { code, teams: await firstEventTeams(season, code) }; }
    catch (e) { report.failed.push(`${code}: ${(e as Error).message.slice(0, 120)}`); return { code, teams: null }; }
  }));
  const s: InStatement[] = [];
  for (const { code, teams } of reads) {
    if (!teams) continue;
    s.push({ sql: "DELETE FROM event_registrations WHERE season = ? AND code = ?", args: [season, code] });
    s.push(...teamStatements(teams, isLegacy(season)));
    for (const t of teams) {
      s.push({ sql: "INSERT OR REPLACE INTO event_registrations (season, code, team, fetched_at) VALUES (?, ?, ?, ?)", args: [season, code, t.number, at] });
      s.push({ sql: "INSERT OR IGNORE INTO team_seasons (season, team) VALUES (?, ?)", args: [season, t.number] });
    }
    if (teams.length) { report.withTeams++; report.teams += teams.length; }
  }
  await writeBatch(s);
  return report;
}
