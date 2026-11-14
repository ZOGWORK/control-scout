// The records tables (/teams, /matches) in a season pack's boards (server/packs/boards.ts): the server's own pages of
// each table's default view (its default sort, no filter), every stat in them. Offline, a request for one of those
// pages with any columns is that answer cut to the columns asked for: each row's stats are per column, so the cut
// is exactly the server's answer for those columns (server/api/records.ts statsOf, rowsOf). Any other view (a
// filter, another sort, a later page) isn't in the pack: the table says it needs a connection.
import { statFor, type RecordScope, type RecordsResponse } from "./statCatalog";

/** Pages of each table's default view a season pack holds. */
export const RECORDS_BOARD_PAGES = 2;
/** Rows per page, as the records tables ask (RecordsTable). */
export const RECORDS_BOARD_PAGE_SIZE = 50;
/** Each table's default sort on the records pages (RecordsPage), the view the pack holds. */
export const RECORDS_PAGE_SORT: Record<RecordScope, string> = { teamEvent: "totalPointsNpOpr", teamSeason: "totalPointsNpOpr", match: "highScore" };
/** The match stat whose rows also carry the replayed call's tier (server/api/records.ts PREDICTION_STAT). */
const PREDICTION_STAT = "redPredictedWinPct";

/** A sort's default direction, as the server picks it with no ?dir= (server/api/records.ts recordsQuery). */
export const defaultRecordsDir = (sort: string, scope: RecordScope): "asc" | "desc" => {
  const s = statFor(sort, scope);
  return s && (s.type === "text" || s.lowerIsBetter) ? "asc" : "desc";
};

/** The path a pack stores a default-view page under: the server's answer to it (no `fields`: every stat). */
export function recordsBoardPath(season: number, scope: RecordScope, page: number): string {
  const kind = scope === "match" ? "matches" : "teams";
  const p = new URLSearchParams();
  if (scope === "teamSeason") p.set("scope", "season");
  p.set("sort", RECORDS_PAGE_SORT[scope]);
  p.set("dir", defaultRecordsDir(RECORDS_PAGE_SORT[scope], scope));
  p.set("page", String(page));
  p.set("pageSize", String(RECORDS_BOARD_PAGE_SIZE));
  return `/api/records/${season}/${kind}?${p}`;
}

export type RecordsBoardAsk =
  | { season: number; scope: RecordScope; page: number; fields: string[] | null; path: string }
  | { notSaved: string };

/** Query params a default-view page may carry (anything else is another view). */
const PLAIN = new Set(["scope", "sort", "dir", "page", "pageSize", "fields"]);

/**
 * What a records request asks of the pack: one of its default-view pages (with the columns asked for; null =
 * every stat), or why the pack can't answer it. Null: not a records table request.
 */
export function recordsBoardAsk(path: string): RecordsBoardAsk | null {
  const url = new URL(path, "http://offline.invalid");
  const m = /^\/api\/records\/(\d{4})\/(teams|matches)$/.exec(url.pathname);
  if (!m) return null;
  const sp = url.searchParams;
  if (sp.get("format") && sp.get("format") !== "json") return { notSaved: "Downloads of the records tables need a connection." };
  const scope: RecordScope = m[2] === "matches" ? "match" : sp.get("scope") === "season" ? "teamSeason" : "teamEvent";
  const sort = sp.get("sort") || RECORDS_PAGE_SORT[scope];
  const dir = sp.get("dir") || defaultRecordsDir(sort, scope);
  const page = Number(sp.get("page") || 1);
  const size = Number(sp.get("pageSize") || RECORDS_BOARD_PAGE_SIZE);
  const other = [...sp.keys()].some((k) => !PLAIN.has(k) && sp.get(k) !== "");
  if (other || sort !== RECORDS_PAGE_SORT[scope] || dir !== defaultRecordsDir(sort, scope) || size !== RECORDS_BOARD_PAGE_SIZE) {
    return { notSaved: "Saved for offline: the first pages of this table as it opens. Filters and other sorts need a connection." };
  }
  if (!Number.isInteger(page) || page < 1 || page > RECORDS_BOARD_PAGES) {
    return { notSaved: `Saved for offline: the first ${RECORDS_BOARD_PAGES * RECORDS_BOARD_PAGE_SIZE} rows of this table. The rest need a connection.` };
  }
  const raw = sp.get("fields");
  const fields = raw == null ? null : raw === "" ? [] : [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  return { season: Number(m[1]), scope, page, fields, path: recordsBoardPath(Number(m[1]), scope, page) };
}

type AnyRecordRow = { stats: Record<string, unknown>; predictionTier?: unknown };

/**
 * A stored default-view page cut to `fields` (null: as stored), exactly as the server answers those columns: the
 * stats asked for, in the order asked, and a match row's call tier only when its probability was asked for. Null
 * when a column asked for isn't in the stored page (a stat the owner switched off when the pack was built).
 */
export function projectRecords<R extends AnyRecordRow>(stored: RecordsResponse<R>, fields: string[] | null): RecordsResponse<R> | null {
  if (fields == null) return stored;
  if (fields.some((f) => !stored.columns.includes(f))) return null;
  return {
    ...stored,
    columns: fields,
    rows: stored.rows.map((r) => {
      const { predictionTier, ...rest } = r;
      const stats: Record<string, unknown> = {};
      for (const f of fields) stats[f] = r.stats[f];
      return { ...rest, stats, ...(stored.scope === "match" && fields.includes(PREDICTION_STAT) && predictionTier !== undefined ? { predictionTier } : {}) } as unknown as R;
    }),
  };
}
