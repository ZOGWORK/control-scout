// The season's leaderboards from a saved season pack, offline:
//  - the world ranking (/api/rankings, /api/rankings/places): the server's own reads and page
//    (src/shared/rankingsBoard.ts) run on the pack's tables, so the numbers are the server's;
//  - records, league standings, the events list, power rankings: the server's own answers, stored in the pack's
//    boards (server/packs/boards.ts), a records table's page cut to the columns asked for (src/shared/recordsBoard.ts).
// Pure over a small database interface (readers.ts Db), so tests run them on a pack.
import type { Db } from "./readers";
import { BOARDS_TABLE } from "../../shared/packSchema";
import { packPath } from "../../shared/eventBundle";
import { parsePlaces, isWeek, RANKED_MIN_MATCHES, type RankingPlaces, type RankingsResponse } from "../../shared/rankings";
import { rankingCountries, rankingsFrom, readLiveList, readMine, readSnapshot, readSwing, readWeekList, readWeeks, type RankingRows } from "../../shared/rankingsBoard";
import { projectRecords, recordsBoardAsk } from "../../shared/recordsBoard";
import type { RecordsResponse } from "../../shared/statCatalog";

/** Something the pack can't answer, in words for the page (shown as its error). */
export class NotSaved extends Error {}

const hasTable = (db: Db, name: string) => db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]).length > 0;
const info = (db: Db, key: string): string | null => db.all<{ value: string }>("SELECT value FROM pack_info WHERE key = ?", [key])[0]?.value ?? null;

/** A board's stored bytes (gzipped JSON), or null when the pack doesn't hold that path (or has no boards). */
export function boardBytes(db: Db, path: string): Uint8Array | null {
  const key = packPath(path);
  if (key == null || !hasTable(db, BOARDS_TABLE.name)) return null;
  const body = db.all<{ body: Uint8Array }>(`SELECT body FROM ${BOARDS_TABLE.name} WHERE path = ?`, [key])[0]?.body;
  // A copy: the database's buffer isn't ours to keep.
  return body ? new Uint8Array(body) : null;
}

export async function gunzipJson(bytes: Uint8Array): Promise<unknown> {
  const text = await new Response(new Response(bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text);
}

/**
 * The stored answer for a board path, or null when the pack doesn't hold it. A records table request is answered from
 * its stored default-view page cut to the columns asked for; one the pack can't answer (a filter, another sort) throws
 * NotSaved.
 */
export async function readBoard(db: Db, path: string): Promise<unknown | null> {
  const ask = recordsBoardAsk(path);
  if (ask && "notSaved" in ask) throw new NotSaved(ask.notSaved);
  const bytes = boardBytes(db, ask ? ask.path : path);
  if (!bytes) return null;
  const body = await gunzipJson(bytes);
  if (!ask) return body;
  const cut = projectRecords(body as RecordsResponse<{ stats: Record<string, unknown> }>, ask.fields);
  if (!cut) throw new NotSaved("This column isn't in your saved data. It needs a connection.");
  return cut;
}

// --- World ranking ----------------------------------------------------------------------------------------

const rowsOf = (db: Db): RankingRows => (sql, args) => db.all(sql, args);
/** The pack holds the ranking's tables (packs built before them don't). */
export const hasRankings = (db: Db) => hasTable(db, "ranking_weeks") && hasTable(db, "ranking_snapshots");

/** Does this season's pack rank anyone (the server's default season: the newest that does)? */
export const ranksAnyone = (db: Db, season: number) =>
  db.all("SELECT 1 FROM team_season_stats WHERE season = ? AND rating_np IS NOT NULL AND rating_matches >= ? LIMIT 1", [season, RANKED_MIN_MATCHES]).length > 0;

/**
 * One page of /api/rankings from a season's pack: the server's reads and page over the pack's tables. A week whose
 * rows the pack doesn't hold (it keeps the newest few) throws NotSaved; last week's snapshot missing (a pack more
 * than a week old) shows no movement, as the server does with no snapshot. Null: a request the server would refuse.
 */
export async function readRankings(db: Db, season: number, search: URLSearchParams, now = Date.now()): Promise<RankingsResponse | null> {
  if (!hasRankings(db)) throw new NotSaved("The world ranking isn't in this saved season. Save it again to get it, or connect.");
  const week = search.get("week") || null;
  if (week != null && !isWeek(week)) return null;
  const places = parsePlaces(search.get("region"));
  if (!places) return null;
  const page = Number(search.get("page") || 1);
  if (!Number.isInteger(page) || page < 1) return null;
  const all = rowsOf(db);
  const weeks = await readWeeks(all, season);
  const held = new Set(db.all<{ week: string }>("SELECT DISTINCT week FROM ranking_snapshots WHERE season = ?", [season]).map((r) => r.week));
  if (week && !weeks.includes(week)) return null;
  if (week && !held.has(week)) throw new NotSaved(`The ranking for the week of ${week} isn't saved on this device (the latest weeks are). It needs a connection.`);
  const version = info(db, "data_version");
  return rankingsFrom({ season, week, places, page }, {
    weeks,
    list: (w) => (w ? readWeekList(all, season, w) : readLiveList(all, season)),
    snapshot: async (w) => (held.has(w) ? readSnapshot(all, season, w) : null),
    swing: (teams) => readSwing(all, season, teams),
    asOf: version && version !== "0" ? version : null,
    currentSeason: Number(info(db, "current_season")) || season,
  }, now);
}

/** /api/rankings/places from a season's pack: the same countries, weeks and "my region" as the server's. */
export async function readRankingPlaces(db: Db, season: number, team: number | null): Promise<RankingPlaces> {
  if (!hasRankings(db)) throw new NotSaved("The world ranking isn't in this saved season. Save it again to get it, or connect.");
  const all = rowsOf(db);
  const mine = team != null ? await readMine(all, team) : undefined;
  return { season, countries: rankingCountries(await readLiveList(all, season)), weeks: await readWeeks(all, season), ...(mine !== undefined ? { mine } : {}) };
}
