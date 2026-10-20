// The team directory's state in the URL (/teams?view=listed&country=US&q=robo&sort=name&page=3),
// so paging, sorting, back/forward and a copied link all land on the same rows. The
// season is the page's own ?season= (RecordsPage). Other params are left alone. Pure, tested.
// An unknown ?country= is handled as the records tables handle it (urlState.ts countryUnknown):
// kept in the URL and shown as a problem until cleared, never silently widened to every country.
import { countryByCode } from "../../shared/countries";
import { DIRECTORY_PAGE_SIZE, DIRECTORY_SORTS, directorySearchProblem, type DirectorySort } from "../../shared/directory";

export interface DirectoryState {
  /** ISO alpha-2, or null for every country. */
  country: string | null;
  /** A ?country= that names no country we know (e.g. "ZZ"): kept until cleared, and no rows are asked for meanwhile. */
  countryUnknown: string | null;
  /** The search inside this season and country (trimmed), or null. One the server would refuse (too long, too
   *  many words) stays in the URL and is shown as a problem until cleared, and no rows are asked for meanwhile. */
  q: string | null;
  sort: DirectorySort;
  dir: "asc" | "desc";
  page: number;
}

/** The direction a sort starts in (the server's default too): teams with results first, everything else ascending. */
export const directoryDefaultDir = (sort: DirectorySort): "asc" | "desc" => (sort === "results" ? "desc" : "asc");

export function parseDirectoryState(sp: URLSearchParams): DirectoryState {
  const raw = sp.get("country");
  const country = countryByCode(raw)?.code ?? null;
  const sortRaw = sp.get("sort");
  const sort: DirectorySort = sortRaw && (DIRECTORY_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as DirectorySort) : "team";
  const dirRaw = sp.get("dir");
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : directoryDefaultDir(sort);
  const page = Math.max(1, Math.min(100000, Math.floor(Number(sp.get("page")) || 1)));
  const q = sp.get("q")?.trim() || null;
  return { country, countryUnknown: raw && !country ? raw : null, q, sort, dir, page };
}

/** Write a state into a copy of `sp`; defaults are left out so links stay short. An unknown country stays until cleared. */
export function writeDirectoryState(sp: URLSearchParams, s: DirectoryState): URLSearchParams {
  const out = new URLSearchParams(sp);
  const set = (k: string, v: string | null) => { if (v == null || v === "") out.delete(k); else out.set(k, v); };
  set("country", s.country ?? s.countryUnknown);
  set("q", s.q?.trim() || null);
  set("sort", s.sort === "team" ? null : s.sort);
  set("dir", s.dir === directoryDefaultDir(s.sort) ? null : s.dir);
  set("page", s.page > 1 ? String(s.page) : null);
  return out;
}

/** Why the URL's search can't be run (directorySearchProblem), or null. */
export const directorySearchIssue = (s: DirectoryState): string | null => (s.q ? directorySearchProblem(s.q) : null);

/** GET /api/directory/:season for a state (null while the URL names an unknown country or an unusable search: nothing to ask for). */
export function directoryUrl(season: number, s: DirectoryState, pageSize = DIRECTORY_PAGE_SIZE): string | null {
  if (s.countryUnknown || directorySearchIssue(s)) return null;
  const p = new URLSearchParams();
  if (s.country) p.set("country", s.country);
  if (s.q) p.set("q", s.q);
  p.set("sort", s.sort);
  p.set("dir", s.dir);
  p.set("page", String(s.page));
  p.set("pageSize", String(pageSize));
  return `/api/directory/${season}?${p}`;
}
