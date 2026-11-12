// "Which event had the highest average match score in Romania this season": a place's events of one season ranked by
// their average match score, as an event's own average is worked out (./eventAverage.ts): the mean of each alliance's
// score, penalties included, over its played matches, its divisions' together. Official events only (scrimmages and
// off-season events left out, as records are), and only those with enough played matches to average.
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { dateRange, place, seasonLabel } from "../../../../src/shared/format.js";
import type { Region } from "../../../../src/shared/regions.js";
import { all, get } from "../../../db.js";
import { OFFICIAL_TYPES } from "../clauses.js";
import { eventHref } from "../matchSet.js";

/** An event is ranked once this many of its matches are played: a handful of matches is no average to rank. */
export const EVENT_SCORES_MIN_MATCHES = 10;

export interface EventScoresQuestion { region: Region | null; season: number; n: number;
  /** The lowest average first ("lowest average match score"). */
  asc?: boolean }

const where = (q: EventScoresQuestion) => (q.region ? ` in ${q.region.name}` : " worldwide");
/** The card's title less its season, the search page's heading too. */
export const eventScoresTitle = (q: EventScoresQuestion) => `Events${where(q)} by ${q.asc ? "lowest" : "highest"} average match score`;

export async function eventScoresAnswer(q: EventScoresQuestion): Promise<StatAnswer> {
  const types = OFFICIAL_TYPES.map(() => "?").join(", ");
  // A division's matches count toward its event (the parent's code); the place is the event's own.
  const placeSql = q.region ? ` AND p.country = ?${q.region.state ? " AND p.state = ?" : ""}` : "";
  const placeArgs = q.region ? [q.region.country, ...(q.region.state ? [q.region.state] : [])] : [];
  const sql = `FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
    JOIN events p ON p.season = e.season AND p.code = COALESCE(e.division_code, e.code)
    WHERE m.season = ? AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL AND p.type IN (${types})${placeSql}
    GROUP BY p.code HAVING COUNT(*) >= ?`;
  const args = [q.season, ...OFFICIAL_TYPES, ...placeArgs, EVENT_SCORES_MIN_MATCHES];
  const [rows, count] = await Promise.all([
    all<{ code: string; name: string; type: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null; matches: number; avg: number; np: number | null; high: number }>(
      `SELECT p.code, p.name, p.type, p.city, p.state, p.country, p.start, p.end, COUNT(*) matches, AVG((m.red_total + m.blue_total) / 2.0) avg,
         AVG(CASE WHEN m.red_np IS NOT NULL AND m.blue_np IS NOT NULL THEN (m.red_np + m.blue_np) / 2.0 END) np, MAX(MAX(m.red_total, m.blue_total)) high
       ${sql} ORDER BY avg ${q.asc ? "ASC" : "DESC"}, p.code LIMIT ?`, [...args, q.n]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM (SELECT p.code ${sql})`, args),
  ]);
  const S = seasonLabel(q.season), total = Number(count?.n ?? 0);
  const one = (x: number | null) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));
  const base = {
    family: "leaderboard" as const, intent: "event-average-board", title: `${eventScoresTitle(q)} · ${S}`, scope: [q.region?.name ?? "Worldwide", S],
    definition: `An event's average match score is the mean of each alliance's score (penalties included) over its played matches, its divisions' together, as its own average is worked out; the one without penalties leaves out points from the other alliance's fouls. Official events only (no scrimmages or off-season events), each ranked once ${EVENT_SCORES_MIN_MATCHES} of its matches are played.`,
    source: `From the played matches of ${total.toLocaleString("en-US")} ranked event${total === 1 ? "" : "s"}${where(q)} in ${S}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No official event${where(q)} has ${EVENT_SCORES_MIN_MATCHES}+ played matches in ${S} yet.` };
  const top = rows[0];
  return {
    ...base,
    headline: { value: top.name, label: `${one(top.avg)} points per alliance on average · ${one(top.np)} without penalties`, sub: [`${top.matches} matches`, dateRange(top.start, top.end), place(top.city, top.state, top.country && top.country !== "USA" ? top.country : null)].filter(Boolean).join(" · "), href: eventHref(q.season, top.code), type: top.type },
    blocks: [{
      kind: "table", title: total > rows.length ? `Top ${rows.length} of ${total} events` : `${rows.length} event${rows.length === 1 ? "" : "s"}`,
      columns: [{ key: "rank", label: "#", num: true }, { key: "event", label: "Event" }, { key: "avg", label: "Average", num: true }, { key: "np", label: "Without penalties", num: true }, { key: "matches", label: "Matches", num: true }],
      rows: rows.map((r, i) => ({ cells: { rank: i + 1, event: r.name, avg: one(r.avg), np: one(r.np), matches: Number(r.matches) }, href: eventHref(q.season, r.code), strong: i === 0 })),
    }],
  };
}
