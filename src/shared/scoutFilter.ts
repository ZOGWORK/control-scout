// Which scout entries a filter picks, and in what order: one definition for the Scout page's feed
// (filtered on the device, offline too) and the workspace CSV export (server/scout/export.ts), so the
// export always holds exactly the entries the feed shows. The parameters are the export's
// (src/shared/scoutExport.ts) and live in the page URL under the same names:
//   team    team numbers                       (lists: comma-separated or repeated, at most 50 values;
//   event   event codes, any case               an entry matches any value of a list, and every
//   author  Control Point account ids           filter given)
//   match   match labels, e.g. Q12, any case
//   kind    match | pit
//   q       free text: every word must appear in the team number, event code, match label, notes,
//           author or last editor, or a field's answer (decoded values; a toggle reads true / false).
//           Unicode case-insensitive, substrings, at most 200 characters.
// Deleted entries never match. Anything malformed is an error (the export's 400), never a dropped filter.

export type EntryKind = "match" | "pit";

export interface EntryFilters {
  team?: number[];
  /** Upper case. */
  event?: string[];
  kind?: EntryKind;
  author?: number[];
  /** Upper case (ASCII letters only, as SQLite's UPPER folds them). */
  match?: string[];
  /** Folded words that must each appear somewhere in the entry. */
  q?: string[];
}

export interface ExportFilters extends EntryFilters { season: number }

/** The filter parameters (all but season), in URL order. */
export const ENTRY_FILTER_PARAMS = ["team", "event", "author", "match", "kind", "q"] as const;
export type EntryFilterParam = (typeof ENTRY_FILTER_PARAMS)[number];

export const MAX_LIST = 50;
export const MAX_QUERY = 200;

/** Text as q compares it: Unicode case folding (not SQLite's ASCII-only LOWER), composed accents. */
export const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("und");

/** Upper case as SQLite's UPPER does it (ASCII letters only), so the export's SQL and this predicate agree on every label. */
export const upperAscii = (s: string) => s.replace(/[a-z]+/g, (m) => m.toUpperCase());

/** A list parameter: comma-separated, or repeated. Null when it isn't plain text (e.g. team[x]=1, which the query parser makes an object). */
function listOf(v: unknown): string[] | null {
  const raw = Array.isArray(v) ? v : v === undefined ? [] : [v];
  if (!raw.every((x) => typeof x === "string")) return null;
  return (raw as string[]).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
}

type Parsed<T> = { ok: true; filters: T } | { ok: false; error: string; param: string };

/** One parameter's filter, or what's wrong with it. */
function parseParam(k: EntryFilterParam, v: unknown): { ok: true; value: EntryFilters[EntryFilterParam] } | { ok: false; error: string } {
  if (k === "kind") {
    if (v === undefined || v === "") return { ok: true, value: undefined };
    return v === "match" || v === "pit" ? { ok: true, value: v } : { ok: false, error: "kind must be match or pit" };
  }
  if (k === "q") {
    if (v === undefined) return { ok: true, value: undefined };
    if (typeof v !== "string" || v.length > MAX_QUERY) return { ok: false, error: `q must be up to ${MAX_QUERY} characters` };
    const words = fold(v).split(/\s+/).filter(Boolean);
    return { ok: true, value: words.length ? words : undefined };
  }
  const list = listOf(v);
  if (!list) return { ok: false, error: `${k} must be plain values` };
  if (list.length > MAX_LIST) return { ok: false, error: `at most ${MAX_LIST} values for ${k}` };
  if (!list.length) return { ok: true, value: undefined };
  switch (k) {
    case "team": {
      const teams = list.map(Number);
      return teams.some((t) => !Number.isInteger(t) || t < 1 || t > 999999) ? { ok: false, error: "team must be team numbers" } : { ok: true, value: teams };
    }
    case "event":
      return list.some((e) => !/^[A-Za-z0-9_-]{1,24}$/.test(e)) ? { ok: false, error: "event must be event codes" } : { ok: true, value: list.map((e) => e.toUpperCase()) };
    case "author": {
      const ids = list.map(Number);
      return ids.some((a) => !Number.isSafeInteger(a) || a < 1) ? { ok: false, error: "author must be account ids" } : { ok: true, value: ids };
    }
    case "match":
      return list.some((m) => m.length > 24) ? { ok: false, error: "match must be match labels" } : { ok: true, value: list.map(upperAscii) };
  }
}

/** The filters in a query (Express's req.query, or queryOf(URLSearchParams)), or the first thing wrong with them. */
export function parseEntryFilters(query: Record<string, unknown>): Parsed<EntryFilters> {
  const f: EntryFilters = {};
  for (const k of ENTRY_FILTER_PARAMS) {
    const r = parseParam(k, query[k]);
    if (!r.ok) return { ok: false, error: r.error, param: k };
    if (r.value !== undefined) (f as Record<string, unknown>)[k] = r.value;
  }
  return { ok: true, filters: f };
}

/** The export's filters: a season (required), then the entry filters. */
export function parseExportFilters(query: Record<string, unknown>): Parsed<ExportFilters> {
  const season = Number(query.season);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return { ok: false, error: "season required", param: "season" };
  const r = parseEntryFilters(query);
  return r.ok ? { ok: true, filters: { season, ...r.filters } } : r;
}

/** URL search params as Express reads a query: a key given once is a string, repeated an array. */
export function queryOf(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(sp.keys())) { const v = sp.getAll(k); out[k] = v.length === 1 ? v[0] : v; }
  return out;
}

/**
 * The page's filters from its URL. Each parameter is read on its own: one that the export would refuse
 * is listed in `invalid` (the page drops it from the URL, so the feed and the export never disagree).
 */
export function filtersFromSearch(sp: URLSearchParams): { filters: EntryFilters; invalid: EntryFilterParam[] } {
  const q = queryOf(sp);
  const filters: EntryFilters = {};
  const invalid: EntryFilterParam[] = [];
  for (const k of ENTRY_FILTER_PARAMS) {
    const r = parseParam(k, q[k]);
    if (!r.ok) invalid.push(k);
    else if (r.value !== undefined) (filters as Record<string, unknown>)[k] = r.value;
  }
  return { filters, invalid };
}

/** How many filters are on (each parameter counts once). */
export const activeFilterCount = (f: EntryFilters) => ENTRY_FILTER_PARAMS.filter((k) => f[k] !== undefined).length;

/** What the predicate reads of an entry: a ScoutEntry on the device, or a stored row as rowEntry() maps it. */
export interface FilterableEntry {
  team: number;
  eventCode: string | null;
  matchLabel: string | null;
  kind: string;
  notes: string | null;
  authorAccountId: number;
  authorDisplayName?: string | null;
  editorDisplayName?: string | null;
  /** The answers: an object, or the stored JSON text. */
  data: unknown;
  deleted?: boolean;
}

/** The answers as values (never the stored JSON's keys, quotes or escapes). */
function answersOf(data: unknown): unknown[] {
  let d = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return []; } }
  return d && typeof d === "object" && !Array.isArray(d) ? Object.values(d) : [];
}

/** Everything q looks in, folded. */
export function searchText(e: FilterableEntry): string {
  return fold([e.team, e.eventCode, e.matchLabel, e.notes, e.authorDisplayName, e.editorDisplayName,
    ...answersOf(e.data).map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v))].filter((v) => v != null).join("\n"));
}

/** Does the entry hold every word (already folded)? */
export function matchesWords(e: FilterableEntry, words: string[] | undefined): boolean {
  if (!words?.length) return true;
  const text = searchText(e);
  return words.every((w) => text.includes(w));
}

/** Does the entry pass every filter? Deleted entries never do. */
export function entryMatches(e: FilterableEntry, f: EntryFilters): boolean {
  if (e.deleted) return false;
  if (f.team && !f.team.includes(Number(e.team))) return false;
  if (f.event && !f.event.includes(upperAscii(e.eventCode ?? ""))) return false;
  if (f.author && !f.author.includes(Number(e.authorAccountId))) return false;
  if (f.match && !f.match.includes(upperAscii(e.matchLabel ?? ""))) return false;
  if (f.kind && e.kind !== f.kind) return false;
  return matchesWords(e, f.q);
}

// --- Sorting ---------------------------------------------------------------------------------------

export const ENTRY_SORTS = ["newest", "team", "match"] as const;
export type EntrySort = (typeof ENTRY_SORTS)[number];
export const sortFromSearch = (sp: URLSearchParams): EntrySort => {
  const s = sp.get("sort");
  return (ENTRY_SORTS as readonly string[]).includes(s ?? "") ? (s as EntrySort) : "newest";
};

/**
 * Where a match label falls in an event: qualifications first (Q12, QM3), then the playoffs (M3, M3-2,
 * SF1-1, QF2, P1), then finals (F1), then anything else; no label (pit entries) last.
 */
export function matchStage(label: string | null | undefined): number {
  if (!label?.trim()) return 4;
  const m = /^\s*([A-Za-z]*)/.exec(label)![1].toUpperCase();
  if (m === "Q" || m === "QM" || m === "QUAL" || m === "QUALS") return 0;
  if (m === "M" || m === "SF" || m === "QF" || m === "P" || m === "PO" || m === "PLAYOFF" || m === "R") return 1;
  if (m === "F" || m === "FINAL" || m === "FINALS") return 2;
  return 3;
}

/** Natural order: digit runs compare as numbers (Q2 before Q10), letters ignoring case. */
export function naturalCompare(a: string, b: string): number {
  const ta = a.toUpperCase().match(/\d+|\D+/g) ?? [];
  const tb = b.toUpperCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i], y = tb[i];
    const nx = /^\d/.test(x), ny = /^\d/.test(y);
    const c = nx && ny ? Number(x) - Number(y) || x.length - y.length : nx !== ny ? (nx ? -1 : 1) : x < y ? -1 : x > y ? 1 : 0;
    if (c) return c;
  }
  return ta.length - tb.length;
}

/** Match labels in playing order: by stage, then naturally. */
export const compareMatchLabels = (a: string | null, b: string | null) => matchStage(a) - matchStage(b) || naturalCompare(a ?? "", b ?? "");

type Sortable = Pick<FilterableEntry, "team" | "eventCode" | "matchLabel"> & { updatedAt: number; uuid: string };
const newest = (a: Sortable, b: Sortable) => b.updatedAt - a.updatedAt || (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);

/**
 * Entries in an order (a new array): newest edit first; by team number (then newest); or by match:
 * event by event (code A–Z, no event last), each in playing order (compareMatchLabels), then team.
 */
export function sortEntries<T extends Sortable>(entries: readonly T[], sort: EntrySort): T[] {
  const cmp: (a: T, b: T) => number =
    sort === "team" ? (a, b) => a.team - b.team || newest(a, b)
    : sort === "match" ? (a, b) => {
      const ea = (a.eventCode ?? "").toUpperCase(), eb = (b.eventCode ?? "").toUpperCase();
      return (!ea ? 1 : 0) - (!eb ? 1 : 0) || (ea < eb ? -1 : ea > eb ? 1 : 0) || compareMatchLabels(a.matchLabel, b.matchLabel) || a.team - b.team || newest(a, b);
    }
    : newest;
  return [...entries].sort(cmp);
}
