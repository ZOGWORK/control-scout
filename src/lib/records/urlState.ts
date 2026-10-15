// A records table's state in the URL, so a link reproduces the same filter,
// sort, columns and page in a fresh browser:
//   ?filter=and-…-&sort=autoPointsAvg&dir=desc&cols=rank,rp,…&page=2&region=USTX,USCANO&type=Qualifier&from=2025-11-01&to=2025-12-31
// `filter` is the stable filter language (src/shared/filterDsl.ts). Other page
// params (tab, team, season…) are left alone. Pure, unit tested.
import { parseFilter, serializeFilter, type FilterGroup } from "../../shared/filterDsl";
import { DEFAULT_SORT, RECORD_EVENT_TYPES, statFor, type RecordScope } from "../../shared/statCatalog";

export interface TableState {
  filter: FilterGroup | null;
  /** The filter text as it was in the URL when it didn't parse (shown as an error, never silently dropped). */
  filterError: string | null;
  sort: string;
  dir: "asc" | "desc";
  /** Null = the table's own default / saved columns. */
  cols: string[] | null;
  page: number;
  regions: string[];
  eventType: string | null;
  from: string | null;
  to: string | null;
}

/** The URL params a records table owns (cleared when an event page switches tab). */
export const TABLE_PARAMS = ["filter", "sort", "dir", "cols", "page", "region", "type", "from", "to"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultDir(sort: string, scope: RecordScope): "asc" | "desc" {
  const d = statFor(sort, scope);
  return d && (d.type === "text" || d.lowerIsBetter) ? "asc" : "desc";
}

export function parseTableState(sp: URLSearchParams, scope: RecordScope, defaultSort = DEFAULT_SORT[scope]): TableState {
  let filter: FilterGroup | null = null, filterError: string | null = null;
  const raw = sp.get("filter");
  if (raw) {
    try { filter = parseFilter(raw, scope); } catch (e) { filterError = (e as Error).message; }
  }
  const sortRaw = sp.get("sort");
  const sort = sortRaw && statFor(sortRaw, scope) ? sortRaw : defaultSort;
  const dirRaw = sp.get("dir");
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDir(sort, scope);
  const colsRaw = sp.get("cols");
  const cols = colsRaw == null ? null : colsRaw.split(",").filter((k) => !!statFor(k, scope));
  const page = Math.max(1, Math.min(100000, Math.floor(Number(sp.get("page")) || 1)));
  const regions = (sp.get("region") ?? "").split(",").map((r) => r.trim().toUpperCase()).filter((r) => /^[A-Z0-9]{2,12}$/.test(r));
  const typeRaw = sp.get("type");
  const eventType = scope !== "teamSeason" && typeRaw && (RECORD_EVENT_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : null;
  const date = (k: string) => { const v = sp.get(k); return scope !== "teamSeason" && v && DATE.test(v) ? v : null; };
  return { filter, filterError, sort, dir, cols, page, regions, eventType, from: date("from"), to: date("to") };
}

/**
 * Write a table state into a copy of `sp`. Defaults are left out so URLs stay short
 * (`defaultSort`'s natural direction, page 1, default columns).
 */
export function writeTableState(sp: URLSearchParams, s: TableState, scope: RecordScope, defaultSort = DEFAULT_SORT[scope]): URLSearchParams {
  const out = new URLSearchParams(sp);
  const set = (k: string, v: string | null) => { if (v == null || v === "") out.delete(k); else out.set(k, v); };
  set("filter", s.filter && s.filter.children.length ? serializeFilter(s.filter) : null);
  set("sort", s.sort === defaultSort ? null : s.sort);
  set("dir", s.dir === defaultDir(s.sort, scope) ? null : s.dir);
  // An empty choice (every column unticked) is written as "cols=" so a shared link keeps it.
  if (s.cols) out.set("cols", s.cols.join(",")); else out.delete("cols");
  set("page", s.page > 1 ? String(s.page) : null);
  set("region", s.regions.length ? s.regions.join(",") : null);
  set("type", s.eventType);
  set("from", s.from);
  set("to", s.to);
  return out;
}

/** True when anything narrows the rows (what "Clear Filters" resets). */
export const hasFilters = (s: TableState) => !!(s.filter?.children.length || s.regions.length || s.eventType || s.from || s.to);

export const clearFilters = (s: TableState): TableState => ({ ...s, filter: null, filterError: null, regions: [], eventType: null, from: null, to: null, page: 1 });

/**
 * A query string for the address bar: URLSearchParams.toString(), but with the
 * filter's "+" separators and the lists' commas left readable. Both read back
 * the same ("+" decodes to a space, which the filter language also accepts).
 */
export const searchString = (sp: URLSearchParams) => {
  const s = sp.toString().replace(/%2B/g, "+").replace(/%2C/g, ",");
  return s ? `?${s}` : "";
};

// --- API URLs ------------------------------------------------------------------

export interface RecordsRequest {
  season: number;
  scope: RecordScope;
  state: TableState;
  /** Columns to fetch (stat keys). */
  fields: string[];
  /** Fixed narrowing, e.g. one event's code. */
  code?: string | null;
  pageSize?: number;
}

/** /api/records/… for a table (JSON page) or its CSV export (every filtered, sorted row; visible columns). */
export function recordsUrl(r: RecordsRequest, format: "json" | "csv" = "json"): string {
  const kind = r.scope === "match" ? "matches" : "teams";
  const p = new URLSearchParams();
  if (r.scope === "teamSeason") p.set("scope", "season");
  if (r.state.filter && r.state.filter.children.length) p.set("filter", serializeFilter(r.state.filter));
  p.set("sort", r.state.sort);
  p.set("dir", r.state.dir);
  if (r.fields.length) p.set("fields", r.fields.join(","));
  if (r.state.regions.length) p.set("region", r.state.regions.join(","));
  if (r.state.eventType) p.set("eventType", r.state.eventType);
  if (r.state.from) p.set("from", r.state.from);
  if (r.state.to) p.set("to", r.state.to);
  if (r.code) p.set("code", r.code);
  if (format === "csv") p.set("format", "csv");
  else { p.set("page", String(r.state.page)); p.set("pageSize", String(r.pageSize ?? 50)); }
  return `/api/records/${r.season}/${kind}?${p.toString()}`;
}
