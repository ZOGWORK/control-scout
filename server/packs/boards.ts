// A season pack's boards (src/shared/packSchema.ts BOARDS_TABLE): the server's own JSON for the season's leaderboard
// pages, so they open offline with the same numbers as online. Each path is read through the very function its
// route calls (server/app.ts), in process: never a re-implementation. The world ranking isn't here: the pack carries
// its tables and the app runs the server's own reads on them (src/shared/rankingsBoard.ts).
//
//   records:  the season record line and region list, and the first pages of each records table's default view
//             (src/shared/recordsBoard.ts cuts them to the columns a table asks for)
//   leagues:  every league's standings
//   events:   the events list (the Events page)
//   power rankings (the current season's pack): the latest week and each published week
//
// Adding a board: one entry in BOARD_READS.
import { gzipSync } from "node:zlib";
import type { Client } from "@libsql/client";
import { CURRENT_SEASON } from "../data/seasons.js";
import { isEnabled } from "../flags.js";
import { listRecords, recordRegions, recordsQuery } from "../api/records.js";
import { seasonRecordLine } from "../api/searchHighScores.js";
import { leagueStandings, leaguesOf } from "../api/leagues.js";
import { eventListAnswer } from "../api/reads.js";
import { latestRankings, publishedWeeks, rankingsWeek } from "../powerRankings/store.js";
import { BOARDS_TABLE } from "../../src/shared/packSchema.js";
import { packPath } from "../../src/shared/eventBundle.js";
import { SCHEDULE_STAT_KEYS, type RecordScope } from "../../src/shared/statCatalog.js";
import { RECORDS_BOARD_PAGES, RECORDS_BOARD_PAGE_SIZE, RECORDS_PAGE_SORT, defaultRecordsDir, recordsBoardPath } from "../../src/shared/recordsBoard.js";

/** One board: its path and the route's answer (null: the route answers 404, nothing stored). */
export interface BoardRead { path: string; read: () => Promise<unknown | null> }

type Reads = (season: number) => Promise<BoardRead[]>;

/** The season's record tables: each table's default view, the first pages, every stat (as the route gives it). */
async function recordPages(season: number): Promise<BoardRead[]> {
  // The owner's scheduleDifficulty switch off: the route leaves its columns out of team-event records.
  const schedule = await isEnabled("scheduleDifficulty");
  const out: BoardRead[] = [];
  for (const scope of ["teamEvent", "teamSeason", "match"] as RecordScope[]) {
    for (let page = 1; page <= RECORDS_BOARD_PAGES; page++) {
      out.push({ path: recordsBoardPath(season, scope, page), read: async () => {
        const q = recordsQuery(scope, { sort: RECORDS_PAGE_SORT[scope], dir: defaultRecordsDir(RECORDS_PAGE_SORT[scope], scope), page: String(page), pageSize: String(RECORDS_BOARD_PAGE_SIZE) });
        if (scope === "teamEvent" && !schedule) q.fields = q.fields.filter((k) => !SCHEDULE_STAT_KEYS.includes(k));
        return listRecords(season, q);
      } });
    }
  }
  return out;
}

export const BOARD_READS: Reads[] = [
  async (s) => [
    { path: `/api/records/${s}/high-score`, read: async () => ({ line: await seasonRecordLine(s) }) },
    { path: `/api/records/${s}/regions`, read: async () => ({ regions: await recordRegions(s) }) },
  ],
  recordPages,
  async (s) => (await leaguesOf(s)).map((l) => ({ path: `/api/leagues/${s}/${l.region}/${l.code}`, read: () => leagueStandings(s, l.region, l.code) })),
  async (s) => [
    { path: `/api/events?season=${s}`, read: () => eventListAnswer({ season: s, hideNoMatch: true, limit: 3000 }) },
  ],
  async (s) => {
    if (s !== CURRENT_SEASON || !(await isEnabled("powerRankings"))) return [];
    const weeks = await publishedWeeks();
    return [{ path: "/api/power-rankings", read: () => latestRankings() }, ...weeks.map((w) => ({ path: `/api/power-rankings/${w.week}`, read: () => rankingsWeek(w.week) }))];
  },
];

/** Every board of a season, read through the routes' own functions. */
export async function readBoards(season: number, reads: Reads[] = BOARD_READS): Promise<Map<string, unknown>> {
  const list = (await Promise.all(reads.map((r) => r(season)))).flat();
  const out = new Map<string, unknown>();
  for (const r of list) {
    let body: unknown;
    try { body = await r.read(); } catch (e) { throw new Error(`Season boards: reading ${r.path} failed: ${(e as Error).message}`); }
    if (body != null) out.set(packPath(r.path)!, body);
  }
  return out;
}

/** Write a season's boards into its pack (gzipped JSON per path). Returns how many and their stored bytes. */
export async function writeBoards(out: Client, season: number, reads?: Reads[]): Promise<{ boards: number; bytes: number }> {
  await out.execute(BOARDS_TABLE.ddl);
  const boards = await readBoards(season, reads);
  let bytes = 0;
  const rows = [...boards].map(([path, body]) => {
    const gz = gzipSync(Buffer.from(JSON.stringify(body)), { level: 9 });
    bytes += gz.length;
    return { sql: `INSERT INTO ${BOARDS_TABLE.name} (path, body) VALUES (?, ?)`, args: [path, gz] };
  });
  for (let i = 0; i < rows.length; i += 200) await out.batch(rows.slice(i, i + 200), "write");
  return { boards: boards.size, bytes };
}
