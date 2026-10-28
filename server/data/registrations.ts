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
 * A list shared by an AM/PM pair (shared = 1, markSharedSessions) is never one session's teams.
 */
export const ROSTER = `(SELECT season, code, team, rank, rp, tbp, wins, losses, ties, qual_played, dq, 0 registered, NULL fetched_at FROM event_teams
  UNION ALL SELECT r.season, r.code, r.team, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, r.fetched_at FROM event_registrations r
    WHERE r.shared = 0 AND NOT EXISTS (SELECT 1 FROM event_teams x WHERE x.season = r.season AND x.code = r.code))`;

/** "AM" or "PM" when the event's name says which session it is. */
export const sessionOf = (name: string): "AM" | "PM" | null => (/\bAM\b/.test(name) ? "AM" : /\bPM\b/.test(name) ? "PM" : null);
/** The name without its session ("P1-5 AM Northeast League Meet" → "p1-5 northeast league meet"). */
const pairKey = (name: string) => name.replace(/\b(AM|PM)\b/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

export interface SessionEvent { code: string; name: string; start: string | null }

/**
 * The season's AM/PM pairs: two events on the same day whose names differ only by a session word, at least one
 * of them naming it ("P1-5 AM …" + "P1-5 PM …", or "P2-4 AM …" + "P2-4 …"). Keyed by each event's code.
 */
export function sessionPairs(events: SessionEvent[]): Map<string, SessionEvent> {
  const groups = new Map<string, SessionEvent[]>();
  for (const e of events) {
    if (!e.start) continue;
    const k = `${e.start}|${pairKey(e.name)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out = new Map<string, SessionEvent>();
  for (const g of groups.values()) {
    if (g.length !== 2 || !g.some((e) => sessionOf(e.name)) || sessionOf(g[0].name) === sessionOf(g[1].name)) continue;
    out.set(g[0].code, g[1]);
    out.set(g[1].code, g[0]);
  }
  return out;
}

/**
 * Statements marking the season's registrations that FIRST files for a whole AM/PM pair, as they stand once `fresh`
 * (this pass's successful reads: code → teams) is written. FIRST lists each session's own teams only when both
 * sessions have different lists; one list on one session (the other empty) or the same list on both is everyone
 * registered for the pair, with no word on who plays which session. A pair already marked stays marked until
 * both sessions are read in the same pass: one failed read must not turn the pair's list into each session's.
 */
async function sharedStatements(season: number, fresh: Map<string, number[]>): Promise<InStatement[]> {
  const pairs = sessionPairs(await all<SessionEvent>("SELECT code, name, start FROM events WHERE season = ?", [season]));
  const rows = await all<{ code: string; team: number; shared: number }>("SELECT code, team, shared FROM event_registrations WHERE season = ?", [season]);
  const teamsOf = new Map<string, number[]>(), wasShared = new Set<string>();
  for (const r of rows) {
    if (r.shared) wasShared.add(r.code);
    if (!fresh.has(r.code)) teamsOf.set(r.code, [...(teamsOf.get(r.code) ?? []), Number(r.team)]);
  }
  for (const [code, teams] of fresh) if (teams.length) teamsOf.set(code, teams);
  const key = (code: string) => (teamsOf.has(code) ? [...teamsOf.get(code)!].sort((x, y) => x - y).join(",") : null);
  const shared = [...teamsOf.keys()].filter((code) => {
    const other = pairs.get(code)?.code;
    if (!other) return false;
    const theirs = key(other);
    if (theirs == null || theirs === key(code)) return true;
    return (wasShared.has(code) || wasShared.has(other)) && !(fresh.has(code) && fresh.has(other));
  });
  return [
    { sql: "UPDATE event_registrations SET shared = 0 WHERE season = ? AND shared = 1", args: [season] },
    ...shared.map((code) => ({ sql: "UPDATE event_registrations SET shared = 1 WHERE season = ? AND code = ?", args: [season, code] })),
  ];
}

/** Re-mark the season's shared AM/PM lists (events, and their names, can change between reads). */
export async function markSharedSessions(season: number): Promise<void> {
  await writeBatch(await sharedStatements(season, new Map()));
}

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
  if (!o.force && last && now.getTime() - Date.parse(last) < REGISTRATIONS_EVERY_MS) {
    await markSharedSessions(season);
    return { events: 0, withTeams: 0, teams: 0, failed: [], skipped: "read recently" };
  }
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
  const fresh = new Map<string, number[]>();
  for (const { code, teams } of reads) {
    if (!teams) continue;
    fresh.set(code, teams.map((t) => t.number));
    s.push({ sql: "DELETE FROM event_registrations WHERE season = ? AND code = ?", args: [season, code] });
    s.push(...teamStatements(teams, isLegacy(season)));
    for (const t of teams) {
      s.push({ sql: "INSERT OR REPLACE INTO event_registrations (season, code, team, fetched_at) VALUES (?, ?, ?, ?)", args: [season, code, t.number, at] });
      s.push({ sql: "INSERT OR IGNORE INTO team_seasons (season, team) VALUES (?, ?)", args: [season, t.number] });
    }
    if (teams.length) { report.withTeams++; report.teams += teams.length; }
  }
  // The new lists and their shared marks in one transaction: a reader never sees a pair's list as one session's.
  await writeBatch([...s, ...(await sharedStatements(season, fresh))]);
  return report;
}
