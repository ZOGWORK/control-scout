// A records table's state in the URL, so a link reproduces the same filter,
// sort, columns and page in a fresh browser:
//   ?filter=and-…-&sort=autoPointsAvg&dir=desc&cols=rank,rp,…&page=2&region=USTX,USCANO&type=Qualifier&from=2025-11-01&to=2025-12-31&country=US
// `filter` is the stable filter language (src/shared/filterDsl.ts). Other page
// params (tab, team, season…) are left alone. Pure, unit tested.
import { parseFilter, serializeFilter, type FilterGroup } from "../../shared/filterDsl";
import { DEFAULT_SORT, RECORD_EVENT_TYPES, statFor, type RecordScope } from "../../shared/statCatalog";
import { countryByCode } from "../../shared/countries";

export interface TableState {
  filter: FilterGroup | null;
  /** Why the URL's filter didn't parse (shown as an error, never silently dropped). */
  filterError: string | null;
  /** That unreadable filter text: kept in the URL until the filter is cleared or replaced. */
  filterRaw?: string | null;
  sort: string;
  dir: "asc" | "desc";
  /** Null = the table's own default / saved columns. */
  cols: string[] | null;
  page: number;
  regions: string[];
  eventType: string | null;
  from: string | null;
  to: string | null;
  /** Team records: teams from this country (ISO alpha-2, e.g. "US"; the home page's atlas links here). */
  country: string | null;
  /** A ?country= we don't know (e.g. "ZZ"): kept in the URL and shown as a problem until it's cleared, never
   *  silently dropped (that would show every country under an address that looks filtered). */
  countryUnknown: string | null;
}

/** The URL params a records table owns (cleared when an event page switches tab). */
export const TABLE_PARAMS = ["filter", "sort", "dir", "cols", "page", "region", "type", "from", "to", "country"] as const;

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
  const countryRaw = scope !== "match" ? sp.get("country") : null;
  const country = countryByCode(countryRaw)?.code ?? null;
  const countryUnknown = countryRaw && !country ? countryRaw : null;
  return { filter, filterError, filterRaw: filterError ? raw : null, sort, dir, cols, page, regions, eventType, from: date("from"), to: date("to"), country, countryUnknown };
}

/**
 * Write a table state into a copy of `sp`. Defaults are left out so URLs stay short
 * (`defaultSort`'s natural direction, page 1, default columns).
 */
export function writeTableState(sp: URLSearchParams, s: TableState, scope: RecordScope, defaultSort = DEFAULT_SORT[scope]): URLSearchParams {
  const out = new URLSearchParams(sp);
  const set = (k: string, v: string | null) => { if (v == null || v === "") out.delete(k); else out.set(k, v); };
  // An unreadable filter stays as it was (other edits never silently drop it).
  set("filter", s.filter && s.filter.children.length ? serializeFilter(s.filter) : s.filterError ? s.filterRaw ?? null : null);
  set("sort", s.sort === defaultSort ? null : s.sort);
  set("dir", s.dir === defaultDir(s.sort, scope) ? null : s.dir);
  // An empty choice (every column unticked) is written as "cols=" so a shared link keeps it.
  if (s.cols) out.set("cols", s.cols.join(",")); else out.delete("cols");
  set("page", s.page > 1 ? String(s.page) : null);
  set("region", s.regions.length ? s.regions.join(",") : null);
  set("type", s.eventType);
  set("from", s.from);
  set("to", s.to);
  // An unknown country stays as it was (like an unreadable filter) until it's cleared.
  set("country", s.country ?? s.countryUnknown);
  return out;
}

/** True when anything narrows the rows (what "Clear Filters" resets). */
export const hasFilters = (s: TableState) => !!(s.filter?.children.length || s.regions.length || s.eventType || s.from || s.to || s.country || s.countryUnknown);

export const clearFilters = (s: TableState): TableState => ({ ...s, filter: null, filterError: null, filterRaw: null, regions: [], eventType: null, from: null, to: null, country: null, countryUnknown: null, page: 1 });

/**
 * A query string for the address bar: URLSearchParams.toString(), but with the
 * filter's "+" separators and the lists' commas left readable. Both read back
 * the same ("+" decodes to a space, which the filter language also accepts).
 */
export const searchString = (sp: URLSearchParams) => {
  const s = sp.toString().replace(/%2B/g, "+").replace(/%2C/g, ",");
  return s ? `?${s}` : "";
};

/** A page that exists for `total` rows: past the end → the last page (1 when there are none). */
export const clampPage = (page: number, total: number, pageSize: number) => Math.max(1, Math.min(page, Math.ceil(total / Math.max(1, pageSize))));

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
  // Always sent: an empty list ("fields=") asks for no stat columns, not the whole catalog.
  p.set("fields", r.fields.join(","));
  if (r.state.regions.length) p.set("region", r.state.regions.join(","));
  if (r.state.eventType) p.set("eventType", r.state.eventType);
  if (r.state.from) p.set("from", r.state.from);
  if (r.state.to) p.set("to", r.state.to);
  if (r.state.country && r.scope !== "match") p.set("country", r.state.country);
  if (r.code) p.set("code", r.code);
  if (format === "csv") p.set("format", "csv");
  else { p.set("page", String(r.state.page)); p.set("pageSize", String(r.pageSize ?? 50)); }
  return `/api/records/${r.season}/${kind}?${p.toString()}`;
}
