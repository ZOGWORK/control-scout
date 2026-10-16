// The workspace scout CSV export (server/scout/export.ts): its filter
// parameters, shared so the Scout page passes exactly what the server applies.
//
// GET /api/scout/workspaces/:workspaceId/export.csv?season=YYYY[&team=…&event=…&kind=…&author=…&match=…&q=…]
//
// The server is the only judge of which entries go in: the page passes the
// filters it shows, never a list of entries. Every filter is optional except
// season. List filters take a comma-separated list (or the parameter repeated);
// an entry matches when it matches any value of a list, and every filter given.
//   season  the season (required): picks the template the columns come from
//   team    team numbers
//   event   event codes (any case)
//   kind    match | pit (also limits the columns to that kind's fields)
//   author  Control Point account ids of the entries' authors
//   match   match labels, e.g. Q12 (any case)
//   q       free text: every word must appear in the team number, event code,
//           match label, notes, author or last editor, or a field's answer
// Deleted entries are never exported. Parsing and matching: src/shared/scoutFilter.ts (shared with the
// Scout page's feed, so the export holds exactly what the feed shows).

export const EXPORT_FILTER_PARAMS = ["season", "team", "event", "kind", "author", "match", "q"] as const;
export type ExportFilterParam = (typeof EXPORT_FILTER_PARAMS)[number];

/** The export URL for a workspace, carrying the filters in `params` that the export knows (anything else is left out). */
export function workspaceExportUrl(workspaceId: string, params: URLSearchParams | Record<string, string | number | undefined | null>): string {
  const src = params instanceof URLSearchParams ? params : new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
  const out = new URLSearchParams();
  for (const k of EXPORT_FILTER_PARAMS) for (const v of src.getAll(k)) if (v.trim()) out.append(k, v.trim());
  return `/api/scout/workspaces/${encodeURIComponent(workspaceId)}/export.csv?${out}`;
}

/** The download's file name: scout-<workspace slug>-<season>.csv. */
export function exportFilename(workspaceName: string, workspaceId: string, season: number): string {
  const slug = workspaceName.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `scout-${slug || workspaceId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}-${season}.csv`;
}
