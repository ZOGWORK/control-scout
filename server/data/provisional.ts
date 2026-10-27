// Provisional event info from a region's own site (sources/ftcnj.ts): written by the sync, read by the
// event page. Stored in event_provisional (migration 47), never in FIRST's events/event_teams.
import { all, kvGet, kvSet, writeBatch } from "../db.js";
import { FTCNJ_SOURCE, FTCNJ_URL, fetchNjPage, matchNjEvents, pageLines, pageSeason, parseNjEvents, type NjTeam } from "../sources/ftcnj.js";

/** The site is small and volunteer-run, and its lists change a few times a week: read it at most this often. */
export const FTCNJ_EVERY_MS = 3 * 3600_000;

export interface ProvisionalReport { events: number; matched: number; unmatched: string[]; skipped?: string }

/**
 * Read FTC New Jersey's events page and store each event's details and registered teams under FIRST's code
 * for it. Replaces the season's FTC NJ rows only when the page parses (a broken or empty page keeps the last
 * good copy). `html` stands in for the fetch (tests).
 */
export async function syncFtcNj(season: number, o: { force?: boolean; html?: string; now?: Date } = {}): Promise<ProvisionalReport> {
  const key = `sync:${FTCNJ_SOURCE}:${season}`;
  const now = o.now ?? new Date();
  const last = await kvGet<string>(key);
  if (!o.force && o.html == null && last && now.getTime() - Date.parse(last) < FTCNJ_EVERY_MS) return { events: 0, matched: 0, unmatched: [], skipped: "read recently" };
  const html = o.html ?? (await fetchNjPage());
  const pageFor = pageSeason(pageLines(html));
  if (pageFor !== season) return { events: 0, matched: 0, unmatched: [], skipped: `page is for ${pageFor ?? "no season"}` };
  const events = parseNjEvents(html, season);
  if (!events.length) return { events: 0, matched: 0, unmatched: [], skipped: "no events on the page" };
  const first = await all<any>("SELECT code, name, type, league, start FROM events WHERE season = ? AND region = 'USNJ'", [season]);
  const { matched, unmatched } = matchNjEvents(events, first);
  const at = now.toISOString();
  await writeBatch([
    { sql: "DELETE FROM event_provisional WHERE season = ? AND source = ?", args: [season, FTCNJ_SOURCE] },
    ...matched.map((m) => ({
      sql: `INSERT INTO event_provisional (season, code, source, url, title, nickname, hosts, venue, address, capacity, schedule, notes, closed, teams, session_unknown, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [season, m.code, FTCNJ_SOURCE, FTCNJ_URL, m.event.title, m.event.nickname, m.event.hosts, m.event.venue, m.event.address, m.event.capacity,
        JSON.stringify(m.event.schedule), JSON.stringify(m.event.notes), m.event.closed ? 1 : 0, JSON.stringify(m.teams), m.sessionUnknown ? 1 : 0, at],
    })),
  ]);
  await kvSet(key, at);
  return { events: events.length, matched: matched.length, unmatched: unmatched.map((e) => `${e.date} ${e.title}`) };
}

export interface ProvisionalRow {
  source: string; url: string; title: string | null; nickname: string | null; hosts: string | null; venue: string | null; address: string | null;
  capacity: string | null; schedule: string[]; notes: string[]; closed: boolean; teams: NjTeam[]; sessionUnknown: boolean; fetchedAt: string;
}

/** The event's provisional row, if a regional site has one. */
export async function provisionalFor(season: number, code: string): Promise<ProvisionalRow | null> {
  const [r] = await all<any>("SELECT * FROM event_provisional WHERE season = ? AND code = ? ORDER BY fetched_at DESC LIMIT 1", [season, code]);
  if (!r) return null;
  return {
    source: r.source, url: r.url, title: r.title, nickname: r.nickname, hosts: r.hosts, venue: r.venue, address: r.address, capacity: r.capacity,
    schedule: JSON.parse(r.schedule), notes: JSON.parse(r.notes), closed: !!r.closed, teams: JSON.parse(r.teams), sessionUnknown: !!r.session_unknown, fetchedAt: r.fetched_at,
  };
}
