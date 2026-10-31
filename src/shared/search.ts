// Search hits as the app and the server show them: the header's dropdown and the /search page (the app),
// and /search's first paint (server/seoMeta.ts).
import type { SearchHit, SearchSection } from "./api.js";

/** The kinds in the order they're listed, with their group names. */
export const SEARCH_GROUPS: [SearchHit["kind"], string][] = [["place", "Places"], ["team", "Teams"], ["event", "Events"], ["match", "Matches"]];

/** How many hits the /search page lists (the API's most). */
export const SEARCH_PAGE_LIMIT = 25;

/** What a query can ask about a team or event besides its name ("hypnotic ranking points", "USNJCMP odds"). */
export type SearchTopic = "awards" | "matches" | "rankings" | "odds" | "playoffs" | "rp" | "opr" | "record" | "stats";

/** The words for each topic (lower case; a phrase is several words in a row). Longer phrases are tried first,
 *  so "ranking points" is the RP topic, not rankings. */
export const SEARCH_TOPICS: [string, SearchTopic][] = ([
  ["ranking points", "rp"], ["ranking point", "rp"], ["ranking score", "rp"], ["rp", "rp"], ["rps", "rp"],
  ["win rate", "record"], ["record", "record"], ["wins", "record"],
  ["opr", "opr"], ["oprs", "opr"],
  ["stats", "stats"], ["statistics", "stats"],
  ["award", "awards"], ["awards", "awards"],
  ["match", "matches"], ["matches", "matches"], ["schedule", "matches"], ["results", "matches"],
  ["rank", "rankings"], ["ranking", "rankings"], ["rankings", "rankings"], ["standings", "rankings"],
  ["odds", "odds"], ["advancement", "odds"], ["advancing", "odds"],
  ["playoff", "playoffs"], ["playoffs", "playoffs"], ["bracket", "playoffs"], ["elims", "playoffs"],
] as [string, SearchTopic][]).sort((a, b) => b[0].split(" ").length - a[0].split(" ").length);

/** Words that say nothing about which team or event ("ultra violet team", "how many awards did hypnotic win"):
 *  dropped when the whole query finds nothing. A question reads as its name and topic. */
export const SEARCH_FILLER = new Set([
  "team", "teams", "ftc", "the", "of", "for", "page", "info", "a", "an", "in", "at", "on", "this", "season", "year",
  "how", "many", "much", "what", "whats", "which", "who", "when", "where", "is", "are", "was", "were", "do", "does", "did",
  "has", "have", "had", "get", "got", "win", "won", "show", "me", "find", "their", "its", "my", "to",
]);

/** Where each topic opens a page: a team page's part (#awards, #events, #matches) or an event's tab (?tab=). */
const TOPIC_SECTION: Record<SearchTopic, Partial<Record<SearchHit["kind"], SearchSection>>> = {
  awards: { team: "awards", event: "awards" },
  matches: { team: "matches", event: "matches" },
  rankings: { team: "events", event: "rankings" },
  rp: { team: "events", event: "rankings" },
  record: { team: "events", event: "rankings" },
  opr: { event: "rankings" },
  stats: { event: "rankings" },
  odds: { event: "odds" },
  playoffs: { event: "playoffs" },
};

/** The section `topic` opens on this kind of page (none: the page's top). */
export const sectionFor = (kind: SearchHit["kind"], topic: SearchTopic | null | undefined): SearchSection | undefined =>
  topic ? TOPIC_SECTION[topic][kind] : undefined;

/** How a topic reads in a hit's subtitle ("Awards · Oradell, NJ, USA") when it has no numbers of its own. */
export const TOPIC_LABEL: Record<SearchTopic, string> = {
  awards: "Awards", matches: "Matches", rankings: "Rankings", odds: "Advancement odds", playoffs: "Playoffs",
  rp: "Ranking points", opr: "OPR", record: "Record", stats: "Stats",
};

export function hitHref(h: SearchHit): string {
  if (h.kind === "team" && h.atEvent) { const [s, c] = h.atEvent.split(":"); return `/events/${s}/${c}?team=${h.ref}`; }
  if (h.kind === "team") return `/teams/${h.ref}${h.linkSeason ? `?season=${h.linkSeason}` : ""}${h.section ? `#${h.section}` : ""}`;
  if (h.kind === "event") { const [s, c] = h.ref.split(":"); return `/events/${s}/${c}${h.section ? `?tab=${h.section}` : ""}`; }
  if (h.kind === "place") return `/events?region=${encodeURIComponent(h.ref)}`;
  const [s, c, level, series, number] = h.ref.split(":");
  return `/events/${s}/${c}?match=${level}:${series}:${number}`;
}

/** The id of /search's first-paint JSON block: the query and the hits the server listed (server/seoMeta.ts). */
export const SEARCH_HITS_ID = "cs-search-hits";
