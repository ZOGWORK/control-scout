// Search hits as the app and the server show them: the header's dropdown and the /search page (the app),
// and /search's first paint (server/seoMeta.ts).
import type { SearchHit } from "./api.js";

/** The kinds in the order they're listed, with their group names. */
export const SEARCH_GROUPS: [SearchHit["kind"], string][] = [["place", "Places"], ["team", "Teams"], ["event", "Events"], ["match", "Matches"]];

/** How many hits the /search page lists (the API's most). */
export const SEARCH_PAGE_LIMIT = 25;

export function hitHref(h: SearchHit): string {
  if (h.kind === "team") return `/teams/${h.ref}`;
  if (h.kind === "event") { const [s, c] = h.ref.split(":"); return `/events/${s}/${c}`; }
  if (h.kind === "place") return `/events?region=${encodeURIComponent(h.ref)}`;
  const [s, c, level, series, number] = h.ref.split(":");
  return `/events/${s}/${c}?match=${level}:${series}:${number}`;
}

/** The id of /search's first-paint JSON block: the query and the hits the server listed (server/seoMeta.ts). */
export const SEARCH_HITS_ID = "cs-search-hits";
