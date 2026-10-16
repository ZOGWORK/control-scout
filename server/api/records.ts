// Records: every team-event, team-season or match of a season, filtered with
// the shared filter language (src/shared/filterDsl.ts), sorted by any catalog
// stat and paginated — or streamed as CSV for export.
//
// SQL safety: stat keys only ever reach SQL through the whitelists below
// (catalog key → column expression); every value is a bound parameter.
import type { Response } from "express";
import { createGzip } from "node:zlib";
import { EXCLUDED_TYPES } from "@control-scout/predict-engine";
import { all } from "../db.js";
import { scoreColumn } from "../stats/records.js";
import { foldText, parseFilter, serializeFilter, type FilterGroup, type FilterNode } from "../../src/shared/filterDsl.js";
import {
  DEFAULT_SORT, RECORDS_EXPORT_MAX, RECORDS_MAX_PAGE_SIZE, RECORDS_PAGE_SIZE, RECORD_EVENT_TYPES, STAT_BY_KEY, statFor, statsFor,
  type MatchRecordRow, type RecordRegion, type RecordScope, type RecordsResponse, type StatValues, type TeamEventRecord, type TeamSeasonRecord,
} from "../../src/shared/statCatalog.js";

/** A request the client got wrong (→ 400). */
export class RecordsQueryError extends Error {}
const bad = (m: string) => new RecordsQueryError(m);

type Arg = string | number;

interface Source {
  /** FROM … (with joins). */
  from: string;
  /** Season predicate. */
  season: string;
  /** Always-on predicates (e.g. played matches only). */
  where: string[];
  /** Catalog key → SQL expression. */
  columns: Record<string, string>;
  /** Identity columns selected for every row (alias → expression). */
  identity: Record<string, string>;
  /** Stable tiebreak after the sort column. */
  tiebreak: string;
  /** Primary key columns (a page is sorted on keys only, then its rows fetched by key). */
  key: string[];
  /** Text key → its case- and accent-folded column (foldText, written by the stats job). */
  folded: Record<string, string>;
  /** Expressions for the shared parameters. */
  eventType?: string;
  region: string;
  dateFrom?: string;
  dateTo?: string;
}

const teamCols = (r: string) => ({ teamNumber: `${r}.team`, teamName: `${r}.team_name`, homeRegion: `${r}.home_region`, rookieYear: `${r}.rookie_year`, school: `${r}.school` });

function scoreCols(r: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of statsFor("teamEvent")) if (s.base && s.aggregate) out[s.key] = `${r}.${scoreColumn(s.base, s.aggregate)}`;
  return out;
}

function teamEventSource(): Source {
  return {
    from: "team_event_records r",
    season: "r.season = ?",
    where: [],
    columns: {
      ...teamCols("r"), eventCode: "r.code", eventName: "r.event_name", eventRegion: "r.event_region",
      rank: "r.rank", rp: "r.rp", tb1: "r.tb1", qualMatchesPlayed: "r.played", wins: "r.wins", losses: "r.losses", ties: "r.ties",
      ...scoreCols("r"),
      predictedWinPctAvg: "r.pred_win_avg", predictedScoreAvg: "r.pred_score_avg", advancementOdds: "r.adv_odds",
    },
    identity: { season: "r.season", team: "r.team", eventCode: "r.code", eventName: "r.event_name", eventType: "r.event_type", eventStart: "r.event_start" },
    tiebreak: "r.team, r.code",
    key: ["r.season", "r.code", "r.team"],
    folded: { teamName: "r.team_name_fold", school: "r.school_fold", eventName: "r.event_name_fold" },
    eventType: "r.event_type", region: "r.event_region", dateFrom: "COALESCE(r.event_end, r.event_start)", dateTo: "r.event_start",
  };
}

function teamSeasonSource(): Source {
  return {
    from: "team_season_records r",
    season: "r.season = ?",
    where: [],
    columns: {
      ...teamCols("r"), events: "r.events", qualMatchesPlayed: "r.played", wins: "r.wins", losses: "r.losses", ties: "r.ties",
      ...scoreCols("r"),
      predictedWinPctAvg: "r.pred_win_avg", predictedScoreAvg: "r.pred_score_avg",
    },
    identity: { season: "r.season", team: "r.team" },
    tiebreak: "r.team",
    key: ["r.season", "r.team"],
    folded: { teamName: "r.team_name_fold", school: "r.school_fold" },
    region: "r.home_region",
  };
}

function matchSource(): Source {
  const side = (s: "red" | "blue") => ({
    [`${s}TotalPoints`]: `r.${s}_total`, [`${s}TotalPointsNp`]: `r.${s}_np`, [`${s}AutoPoints`]: `r.${s}_auto`, [`${s}DcPoints`]: `r.${s}_dc`,
    [`${s}EndgamePoints`]: `r.${s}_endgame`, [`${s}PenaltyPointsCommitted`]: `r.${s}_pen`,
  });
  return {
    from: "match_records r",
    season: "r.season = ?",
    where: [],
    columns: {
      eventCode: "r.code", eventName: "r.event_name", eventRegion: "r.event_region",
      ...side("red"), ...side("blue"),
      winningMargin: "r.margin", highScore: "r.high", combinedScore: "r.combined",
      redPredictedWinPct: "r.red_pred_win",
    },
    identity: {
      season: "r.season", eventCode: "r.code", eventName: "r.event_name", eventType: "r.event_type", eventStart: "r.event_start",
      level: "r.level", series: "r.series", number: "r.number", label: "r.label", time: "r.time", red: "r.red_teams", blue: "r.blue_teams",
    },
    tiebreak: "r.code, r.level DESC, r.series, r.number",
    key: ["r.season", "r.code", "r.level", "r.series", "r.number"],
    folded: { eventName: "r.event_name_fold" },
    eventType: "r.event_type", region: "r.event_region", dateFrom: "COALESCE(r.event_end, r.event_start)", dateTo: "r.event_start",
  };
}

const sourceFor = (scope: RecordScope): Source => (scope === "teamEvent" ? teamEventSource() : scope === "teamSeason" ? teamSeasonSource() : matchSource());

/** The whitelist for a record kind: catalog key → SQL expression. */
export const recordColumns = (scope: RecordScope): Readonly<Record<string, string>> => sourceFor(scope).columns;
/** Text key → folded column for a record kind. */
export const recordFolded = (scope: RecordScope): Readonly<Record<string, string>> => sourceFor(scope).folded;

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

export interface RecordsQuery {
  scope: RecordScope;
  filter: FilterGroup | null;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  fields: string[];
  regions: string[];
  eventType: string | null;
  from: string | null;
  to: string | null;
  team: number | null;
  level: "qual" | "playoff" | null;
  /** One event (team-event and match records): its code, upper case. */
  code: string | null;
}

const one = (q: Record<string, unknown>, name: string): string | null => {
  const v = q[name];
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw bad(`${name}: give it once, as plain text`);
  return v;
};
const intParam = (q: Record<string, unknown>, name: string, def: number, min: number, max: number) => {
  const v = one(q, name);
  if (v == null) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
const date = (q: Record<string, unknown>, name: string) => {
  const v = one(q, name);
  if (v == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a date like 2025-11-16`);
  return v;
};

/** Validate the query string of a records request. `maxPageSize` is larger for CSV export. */
export function recordsQuery(scope: RecordScope, q: Record<string, unknown>, maxPageSize = RECORDS_MAX_PAGE_SIZE): RecordsQuery {
  const rawFilter = one(q, "filter");
  const filter = rawFilter == null ? null : parseFilter(rawFilter, scope);
  const sort = one(q, "sort") ?? DEFAULT_SORT[scope];
  if (!statFor(sort, scope)) throw bad(STAT_BY_KEY.has(sort) ? `sort: "${sort}" isn't available for these records` : `sort: unknown stat "${sort}"`);
  const dirRaw = one(q, "dir");
  if (dirRaw != null && dirRaw !== "asc" && dirRaw !== "desc") throw bad("dir must be asc or desc");
  const sortDef = statFor(sort, scope)!;
  const dir = (dirRaw ?? (sortDef.type === "text" || sortDef.lowerIsBetter ? "asc" : "desc")) as "asc" | "desc";
  const fieldsRaw = one(q, "fields");
  // No `fields` = every stat; `fields=` (empty) = none, only the identity columns (a table with every stat unticked).
  const fields = q.fields === "" ? [] : fieldsRaw == null ? statsFor(scope).map((s) => s.key) : [...new Set(fieldsRaw.split(",").map((s) => s.trim()).filter(Boolean))];
  for (const f of fields) if (!statFor(f, scope)) throw bad(`fields: ${STAT_BY_KEY.has(f) ? `"${f}" isn't available for these records` : `unknown stat "${f}"`}`);
  const regionRaw = one(q, "region");
  const regions = regionRaw == null ? [] : [...new Set(regionRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (regions.length > 30 || regions.some((r) => !/^[A-Z0-9]{2,12}$/.test(r))) throw bad("region: up to 30 FIRST region codes, comma-separated (USTX,GB)");
  const eventType = one(q, "eventType");
  if (eventType != null) {
    if (scope === "teamSeason") throw bad("eventType applies to team-event and match records");
    if (eventType !== "All" && !(RECORD_EVENT_TYPES as readonly string[]).includes(eventType)) throw bad(`eventType must be one of All, ${RECORD_EVENT_TYPES.join(", ")}`);
  }
  const from = date(q, "from"), to = date(q, "to");
  if ((from || to) && scope === "teamSeason") throw bad("from/to apply to team-event and match records");
  const teamRaw = one(q, "team");
  if (teamRaw != null && scope !== "match") throw bad("team applies to match records (filter team records with teamNumber)");
  const team = teamRaw == null ? null : intParam(q, "team", 0, 1, 999999);
  const codeRaw = one(q, "code");
  if (codeRaw != null && scope === "teamSeason") throw bad("code applies to team-event and match records");
  if (codeRaw != null && !/^[A-Za-z0-9_-]{1,40}$/.test(codeRaw)) throw bad("code must be an event code like USNJQ1");
  const level = one(q, "level");
  if (level != null && (scope !== "match" || (level !== "qual" && level !== "playoff"))) throw bad(scope === "match" ? "level must be qual or playoff" : "level applies to match records");
  return {
    scope, filter, sort, dir, fields, regions, from, to, team, code: codeRaw == null ? null : codeRaw.toUpperCase(),
    eventType: eventType === "All" ? null : eventType,
    level: level as RecordsQuery["level"],
    page: intParam(q, "page", 1, 1, 100000),
    pageSize: intParam(q, "pageSize", RECORDS_PAGE_SIZE, 1, maxPageSize),
  };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const NUMBER_SQL = { lt: "<", lte: "<=", eq: "=", ne: "<>", gt: ">", gte: ">=" } as const;

/**
 * A text stat as filters and sorts compare it: the folded copy of a name
 * column, or lower() for the plain-ASCII ones (codes, regions), so both
 * sides match foldText of the filter value.
 */
const textExpr = (key: string, col: string, folded: Record<string, string>) => (Object.hasOwn(folded, key) ? folded[key] : `lower(${col})`);

/**
 * Filter tree → SQL predicate with bound parameters. Keys are looked up in
 * `columns` (the whitelist); a key missing there is an error, never SQL.
 * Rows where a compared stat is missing (null) never match, `ne` included.
 */
export function compileFilter(node: FilterNode, columns: Record<string, string>, args: Arg[], folded: Record<string, string> = {}): string {
  if (node.kind === "group") {
    if (!node.children.length) return "1";
    return `(${node.children.map((c) => compileFilter(c, columns, args, folded)).join(node.type === "and" ? " AND " : " OR ")})`;
  }
  const col = Object.hasOwn(columns, node.key) ? columns[node.key] : undefined; // never an inherited "constructor"
  if (!col) throw bad(`filter: stat "${node.key}" can't be filtered here`);
  if (typeof node.value === "string") {
    // Case- and accent-insensitive: the folded column against the folded value.
    const text = textExpr(node.key, col, folded);
    args.push(foldText(node.value));
    if (node.op === "contains") return `instr(${text}, ?) > 0`;
    if (node.op === "eq") return `${text} = ?`;
    if (node.op === "ne") return `${text} <> ?`;
    throw bad(`filter: ${node.key} is text: use contains, eq or ne`);
  }
  if (node.op === "contains") throw bad(`filter: "contains" only works on text stats`);
  args.push(node.value);
  return `${col} ${NUMBER_SQL[node.op]} ?`;
}

function whereOf(src: Source, season: number, q: RecordsQuery): { sql: string; args: Arg[] } {
  const parts = [src.season, ...src.where];
  const args: Arg[] = [season];
  if (q.filter) parts.push(compileFilter(q.filter, src.columns, args, src.folded));
  if (q.regions.length) { parts.push(`${src.region} IN (${q.regions.map(() => "?").join(", ")})`); args.push(...q.regions); }
  if (q.eventType && src.eventType) {
    if (q.eventType === "Official") { parts.push(`${src.eventType} NOT IN (${[...EXCLUDED_TYPES].map(() => "?").join(", ")})`); args.push(...EXCLUDED_TYPES); }
    else { parts.push(`${src.eventType} = ?`); args.push(q.eventType); }
  }
  if (q.from && src.dateFrom) { parts.push(`${src.dateFrom} >= ?`); args.push(q.from); }
  if (q.to && src.dateTo) { parts.push(`${src.dateTo} <= ?`); args.push(q.to); }
  if (q.level) { parts.push("r.level = ?"); args.push(q.level); }
  if (q.code) { parts.push("r.code = ?"); args.push(q.code); }
  if (q.team != null) { parts.push("instr(' ' || r.red_teams || ' ' || r.blue_teams || ' ', ?) > 0"); args.push(` ${q.team} `); }
  return { sql: parts.join(" AND "), args };
}

function selectOf(src: Source, q: RecordsQuery): string {
  const id = Object.entries(src.identity).map(([a, e]) => `${e} AS "_${a}"`);
  const st = q.fields.map((k) => `${src.columns[k]} AS "${k}"`); // keys are whitelisted camelCase
  return [...id, ...st].join(", ");
}

function orderOf(src: Source, q: RecordsQuery): string {
  const col = src.columns[q.sort];
  const by = STAT_BY_KEY.get(q.sort)?.type === "text" ? textExpr(q.sort, col, src.folded) : col;
  // Missing values sort last either way.
  return `(${col}) IS NULL, ${by} ${q.dir === "asc" ? "ASC" : "DESC"}, ${src.tiebreak}`;
}

/** Stats are stored at full precision (filters compare exact values); responses carry two decimals. */
const statsOf = (r: any, fields: string[]): StatValues => {
  const s: StatValues = {};
  for (const k of fields) {
    const v = r[k];
    s[k] = v == null ? null : typeof v === "bigint" ? Number(v) : typeof v === "number" ? Math.round(v * 100) / 100 : v;
  }
  return s;
};

type AnyRow = TeamEventRecord | TeamSeasonRecord | MatchRecordRow;

const teamsOf = (s: unknown) => (typeof s === "string" && s ? s.split(" ").map(Number) : []);

function rowsOf(scope: RecordScope, raw: any[], fields: string[]): AnyRow[] {
  if (scope === "teamEvent") return raw.map((r): TeamEventRecord => ({ season: Number(r._season), team: Number(r._team), eventCode: r._eventCode, eventName: r._eventName, eventType: r._eventType ?? null, eventStart: r._eventStart ?? null, stats: statsOf(r, fields) }));
  if (scope === "teamSeason") return raw.map((r): TeamSeasonRecord => ({ season: Number(r._season), team: Number(r._team), stats: statsOf(r, fields) }));
  return raw.map((r): MatchRecordRow => ({
    season: Number(r._season), eventCode: r._eventCode, eventName: r._eventName, eventType: r._eventType ?? null, eventStart: r._eventStart ?? null,
    key: `${r._level}:${r._series}:${r._number}`, level: r._level, label: r._label, time: r._time ?? null, red: teamsOf(r._red), blue: teamsOf(r._blue), stats: statsOf(r, fields),
  }));
}

/**
 * Rows `offset`…`offset + limit` in sort order. Sorting whole rows (~90
 * columns) made deep pages slow (≈150 ms at row 10 000), so the sort runs on
 * the key and sort columns only, then the page's rows are read by key.
 */
async function pageRows(src: Source, q: RecordsQuery, w: { sql: string; args: Arg[] }, limit: number, offset: number): Promise<any[]> {
  // Near the top, sorting whole rows is cheaper than a second query.
  if (offset + limit <= 1000) return all<any>(`SELECT ${selectOf(src, q)} FROM ${src.from} WHERE ${w.sql} ORDER BY ${orderOf(src, q)} LIMIT ? OFFSET ?`, [...w.args, limit, offset]);
  return rowsByKeys(src, q, await sortedKeys(src, q, w, limit, offset));
}

const keyCols = (src: Source) => src.key.map((k, i) => `${k} AS _k${i}`).join(", ");

/** The matching rows' keys in sort order (small: a few ids per row). */
function sortedKeys(src: Source, q: RecordsQuery, w: { sql: string; args: Arg[] }, limit: number, offset: number): Promise<any[]> {
  return all<any>(`SELECT ${keyCols(src)} FROM ${src.from} WHERE ${w.sql} ORDER BY ${orderOf(src, q)} LIMIT ? OFFSET ?`, [...w.args, limit, offset]);
}

/**
 * Whole rows for these keys, in the keys' order (a key whose row is gone since is skipped).
 * The keys are a VALUES list joined to the table one primary-key lookup each (CROSS JOIN keeps
 * the list as the outer loop). A row-value `(a, b, c) IN (VALUES …)` used only the key's first
 * column, so every chunk scanned the whole season: ≈100 ms per 500 team-events instead of ≈25.
 */
async function rowsByKeys(src: Source, q: RecordsQuery, keys: any[]): Promise<any[]> {
  if (!keys.length) return [];
  const tuple = `(${["?", ...src.key.map(() => "?")].join(", ")})`;
  const cols = src.key.map((_, i) => `k${i}`);
  return all<any>(
    `WITH wanted(ord, ${cols.join(", ")}) AS (VALUES ${keys.map(() => tuple).join(", ")}) ` +
      `SELECT ${selectOf(src, q)} FROM wanted CROSS JOIN ${src.from} ON ${src.key.map((k, i) => `${k} = wanted.k${i}`).join(" AND ")} ORDER BY wanted.ord`,
    keys.flatMap((k, n) => [n, ...src.key.map((_, i) => k[`_k${i}`])]),
  );
}

/** One page of records plus the total count of matching rows. */
export async function listRecords(season: number, q: RecordsQuery): Promise<RecordsResponse<AnyRow>> {
  const src = sourceFor(q.scope);
  const w = whereOf(src, season, q);
  const [raw, count] = await Promise.all([
    pageRows(src, q, w, q.pageSize, (q.page - 1) * q.pageSize),
    all<{ n: number }>(`SELECT COUNT(*) n FROM ${src.from} WHERE ${w.sql}`, w.args),
  ]);
  return {
    season, scope: q.scope, filter: q.filter ? serializeFilter(q.filter) : null, sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize,
    total: Number(count[0]?.n ?? 0), columns: q.fields, rows: rowsOf(q.scope, raw, q.fields),
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/** One CSV cell (RFC 4180 quoting), with the formula-injection guard. Also the workspace scout export's. */
export const csvCell = (v: unknown): string => {
  if (v == null) return "";
  let s = String(v);
  // Spreadsheet formula injection: text starting with = + - @ is shown as text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ID_HEADERS: Record<RecordScope, [string, (r: any) => unknown][]> = {
  teamEvent: [["Season", (r) => r.season], ["Team", (r) => r.team], ["Event Code", (r) => r.eventCode], ["Event", (r) => r.eventName], ["Event Type", (r) => r.eventType], ["Event Start", (r) => r.eventStart]],
  teamSeason: [["Season", (r) => r.season], ["Team", (r) => r.team]],
  match: [["Season", (r) => r.season], ["Event Code", (r) => r.eventCode], ["Event", (r) => r.eventName], ["Event Start", (r) => r.eventStart], ["Match", (r) => r.label], ["Level", (r) => r.level], ["Red", (r) => r.red.join(" ")], ["Blue", (r) => r.blue.join(" ")]],
};

/**
 * Every matching row as CSV (the page/pageSize parameters are ignored), sorted
 * like the table. One SELECT fixes which rows and in which order, so it is
 * one consistent view even while the stats job rewrites the tables (separate
 * page queries could skip or repeat rows across a rewrite); the rows are then
 * read and streamed out in chunks, dropping them as they are written.
 * Columns: identity columns, then `fields` in order.
 */
/** Rows per CSV read (inside the export's one read transaction). */
export const CSV_CHUNK = 500;

export async function streamRecordsCsv(season: number, q: RecordsQuery, res: Response, filename: string): Promise<void> {
  const src = sourceFor(q.scope);
  const w = whereOf(src, season, q);
  const ids = ID_HEADERS[q.scope];
  const line = (cells: unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;
  // Which rows, in which order, is fixed by one query up front (just their keys: small), so a stats rewrite
  // mid-export can't skip or repeat a row; the rows themselves are then read in bounded chunks, so a slow
  // download never holds a whole season. (Not a long read transaction: an in-memory database or an
  // embedded replica has one connection, and holding it would fail every other request meanwhile.)
  // The header row goes out before any query runs, so the download starts at once.
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const body = streamedBody(res);
  if (!(await body.send(line([...ids.map(([h]) => h), ...q.fields.map((k) => STAT_BY_KEY.get(k)!.label)])))) return;
  try {
    const keys = await sortedKeys(src, q, w, RECORDS_EXPORT_MAX, 0);
    for (let i = 0; i < keys.length; i += CSV_CHUNK) {
      let out = "";
      for (const r of rowsOf(q.scope, await rowsByKeys(src, q, keys.slice(i, i + CSV_CHUNK)), q.fields)) out += line([...ids.map(([, f]) => f(r)), ...q.fields.map((k) => r.stats[k])]);
      if (out && !(await body.send(out))) return;
    }
    body.end();
  } catch (e) {
    body.abort(); // headers are out: cut the download off (never a complete-looking partial file), then report
    throw e;
  }
}

/**
 * A response body written piece by piece, gzipped when the client takes gzip. The app's
 * compression middleware leaves text/csv alone (server/app.ts): it would hold output in zlib's
 * buffer, and the database reads in between run on the main thread, so compressed bytes only
 * left when a whole chunk backed up. Here each piece is flushed and actually handed to the
 * socket before the next read starts.
 */
export function streamedBody(res: Response) {
  const gzip = res.req.acceptsEncodings("gzip", "identity") === "gzip";
  const gz = gzip ? createGzip() : null;
  res.vary("Accept-Encoding"); // either way: a cache must not hand a plain copy to a gzip client (or the reverse)
  if (gz) {
    res.setHeader("Content-Encoding", "gzip");
    gz.on("error", () => res.destroy());
    gz.pipe(res);
  }
  const out = gz ?? res;
  const gone = new Promise<void>((done) => res.once("close", done)); // finished or the client left
  void gone.then(() => gz?.destroy());
  const waitFor = (stream: NodeJS.EventEmitter, event: string) => new Promise<void>((done) => stream.once(event, done));
  let first = true;
  return {
    /**
     * Write `text` and flush it; resolves once the client has room for more (false when it has
     * gone: stop). The first piece is waited for until compressed, so the download starts before
     * the first read; later ones compress (off the main thread) while the next chunk is read.
     */
    async send(text: string): Promise<boolean> {
      if (res.destroyed || res.writableEnded) return false;
      // Request metrics time a streamed download to its first byte, not its last (server/metrics.ts).
      if (first) res.locals.firstByteAt ??= performance.now();
      const more = out.write(text);
      const sent: Promise<void>[] = [];
      if (gz) { const flushed = new Promise<void>((done) => gz.flush(() => done())); if (first) sent.push(flushed); }
      first = false;
      if (!more) sent.push(waitFor(out, "drain"));
      // Then yield to the event loop, so pending socket writes go out before the next (blocking) read.
      await Promise.race([gone, Promise.all(sent).then(() => new Promise((done) => setImmediate(done)))]);
      return !res.destroyed;
    },
    end(): void { out.end(); },
    abort(): void { gz?.destroy(); res.destroy(); },
  };
}

// ---------------------------------------------------------------------------
// Region options
// ---------------------------------------------------------------------------

/**
 * The FIRST region codes a season's records use (event regions and team home
 * regions), each with the place most of its events are in, so the web app can
 * name it ("USCANO" → California). Sorted by code.
 */
export async function recordRegions(season: number): Promise<RecordRegion[]> {
  const [places, homes] = await Promise.all([
    all<{ code: string; country: string | null; state: string | null; n: number }>(
      "SELECT region code, country, state, COUNT(*) n FROM events WHERE season = ? AND region IS NOT NULL AND region <> '' GROUP BY region, country, state", [season]),
    all<{ code: string }>("SELECT DISTINCT home_region code FROM team_season_records WHERE season = ? AND home_region IS NOT NULL AND home_region <> ''", [season]),
  ]);
  // Per code: every event counted, the place with the most events named.
  const best = new Map<string, RecordRegion & { top: number }>();
  for (const p of places) {
    const code = String(p.code).toUpperCase(), n = Number(p.n);
    const cur = best.get(code);
    if (!cur) best.set(code, { code, country: p.country, state: p.state, events: n, top: n });
    else { cur.events += n; if (n > cur.top) Object.assign(cur, { country: p.country, state: p.state, top: n }); }
  }
  for (const h of homes) { const code = String(h.code).toUpperCase(); if (!best.has(code)) best.set(code, { code, country: null, state: null, events: 0, top: 0 }); }
  return [...best.values()].map(({ code, country, state, events }) => ({ code, country, state, events })).sort((a, b) => a.code.localeCompare(b.code));
}
