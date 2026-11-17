// New Jersey's conferences, written by the sync (src/shared/conferences.ts). Each NJ league tournament's conference is
// parsed once from its name and stored by (season, code), so no page parses names; FTC New Jersey's wording wins when its
// page has the event (event_provisional's title), FIRST's event name otherwise. A name that names no conference stores
// nothing: no guess from the code. The week before each tournament its league's standing is stored too
// (conference_snapshots): league_rankings keeps only today's, and the "going in" numbers must not change after.
import { all, run, writeBatch } from "../db.js";
import { CONFERENCE_REGION, conferenceName, conferenceSlug } from "../../src/shared/conferences.js";
import { leagueStandings } from "../api/leagues.js";

/** The snapshot is taken (and refreshed) while the tournament is at most this many days away. */
export const SNAPSHOT_DAYS = 7;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** Word-for-word containment ("East Bergen Conference" in "Hudson/East Bergen Conference"), on slugs. */
const within = (part: string, whole: string) => `-${whole}-`.includes(`-${part}-`);

/** The stored conference of one tournament: FTCNJ's wording first, FIRST's as an alias only when it agrees. */
export function conferenceOf(firstEventName: string | null, ftcnjTitle: string | null): { name: string; slug: string; firstName: string | null; aliases: string[]; source: "ftcnj" | "first" } | null {
  const first = conferenceName(firstEventName), nj = conferenceName(ftcnjTitle);
  const name = nj ?? first;
  if (!name) return null;
  const slug = conferenceSlug(name);
  const firstSlug = first ? conferenceSlug(first) : null;
  // FIRST's name finds the conference too when it is part of FTCNJ's ("East Bergen" in "Hudson/East Bergen"); when it
  // says something else ("Northeast" for FTCNJ's Northern Conference) it never does.
  const aliases = [slug, ...(firstSlug && firstSlug !== slug && within(firstSlug, slug) ? [firstSlug] : [])];
  return { name, slug, firstName: first && first !== name ? first : null, aliases, source: nj ? "ftcnj" : "first" };
}

/**
 * Store the season's NJ conferences and take the snapshots that are due. Cheap (local reads only): run every sync,
 * past seasons too (a frozen season's events still need their conference once).
 */
export async function syncConferences(season: number, o: { now?: Date } = {}): Promise<{ conferences: number; snapshots: number }> {
  const now = o.now ?? new Date();
  const at = now.toISOString(), today = at.slice(0, 10);
  const events = await all<{ code: string; name: string; region: string; league: string | null; start: string | null; title: string | null }>(
    `SELECT e.code, e.name, e.region, e.league, e.start,
       (SELECT p.title FROM event_provisional p WHERE p.season = e.season AND p.code = e.code AND p.source = 'ftcnj' ORDER BY p.fetched_at DESC LIMIT 1) title
     FROM events e WHERE e.season = ? AND e.type = 'LeagueTournament' AND e.region = ? AND e.league IS NOT NULL AND e.league <> ''`,
    [season, CONFERENCE_REGION]);
  const rows = events.flatMap((e) => {
    const c = conferenceOf(e.name, e.title);
    return c ? [{ e, c }] : [];
  });
  if (rows.length) await writeBatch(rows.map(({ e, c }) => ({
    sql: `INSERT INTO event_conferences (season, code, region, league, name, slug, first_name, aliases, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (season, code) DO UPDATE SET region = excluded.region, league = excluded.league, name = excluded.name, slug = excluded.slug,
            first_name = excluded.first_name, aliases = excluded.aliases, source = excluded.source, updated_at = excluded.updated_at
          WHERE event_conferences.name <> excluded.name OR event_conferences.league <> excluded.league OR event_conferences.aliases <> excluded.aliases
            OR COALESCE(event_conferences.first_name, '') <> COALESCE(excluded.first_name, '')`,
    args: [season, e.code, e.region, e.league, c.name, c.slug, c.firstName, JSON.stringify(c.aliases), c.source, at],
  })));
  // A tournament whose name stopped naming a conference keeps no stale one.
  const keep = new Set(rows.map((r) => r.e.code));
  for (const r of await all<{ code: string }>("SELECT code FROM event_conferences WHERE season = ?", [season])) {
    if (!keep.has(r.code)) await run("DELETE FROM event_conferences WHERE season = ? AND code = ?", [season, r.code]);
  }
  // The week before: today's league standing, replaced each sync until the tournament's day.
  let snapshots = 0;
  for (const { e } of rows) {
    if (!e.start || !(today < e.start && today >= addDays(e.start, -SNAPSHOT_DAYS))) continue;
    const league = await leagueStandings(season, e.region, e.league!);
    const ranked = league?.rows ?? [];
    if (!ranked.length) continue;
    await writeBatch([
      { sql: "DELETE FROM conference_snapshots WHERE season = ? AND code = ?", args: [season, e.code] },
      ...ranked.map((r) => ({
        sql: "INSERT INTO conference_snapshots (season, code, team, rank, rs, tbp, wins, losses, ties, played, meets, read_at, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [season, e.code, r.team, r.rank, r.rs, r.tbp, r.wins, r.losses, r.ties, r.played, r.meets, league!.readAt, at],
      })),
    ]);
    snapshots++;
  }
  return { conferences: rows.length, snapshots };
}
