// Search hits as the app and the server show them: the header's dropdown and the /search page (the app),
// and /search's first paint (server/seoMeta.ts).
import type { SearchHit, SearchPageLink, SearchSection } from "./api.js";

/** The kinds in the order they're listed, with their group names. */
export const SEARCH_GROUPS: [SearchHit["kind"], string][] = [["place", "Places"], ["team", "Teams"], ["event", "Events"], ["match", "Matches"]];

/** How many hits the /search page lists (the API's most). */
export const SEARCH_PAGE_LIMIT = 25;

/** What a query can ask about a team or event besides its name ("hypnotic ranking points", "USNJCMP odds"). */
export type SearchTopic = "awards" | "matches" | "rankings" | "odds" | "playoffs" | "rp" | "opr" | "record" | "stats" | "difficulty" | "history";

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
  ["schedule difficulty", "difficulty"], ["strength of schedule", "difficulty"], ["difficulty", "difficulty"], ["sos", "difficulty"],
  ["history", "history"], ["event history", "history"], ["road map", "history"],
] as [string, SearchTopic][]).sort((a, b) => b[0].split(" ").length - a[0].split(" ").length);

/** Words that say nothing about which team or event ("ultra violet team", "how many awards did hypnotic win"):
 *  dropped when the whole query finds nothing. A question reads as its name and topic. */
export const SEARCH_FILLER = new Set([
  "team", "teams", "ftc", "the", "of", "for", "page", "info", "a", "an", "in", "at", "on", "this", "season", "year",
  "how", "many", "much", "what", "whats", "which", "who", "when", "where", "is", "are", "was", "were", "do", "does", "did",
  "has", "have", "had", "get", "got", "win", "won", "show", "me", "find", "their", "its", "my", "to",
  "through", "across", "over", "all", "events", "every", "by",
]);

/** Words that put two teams side by side: "hypnotic versus bad wolf" opens Compare. */
export const VERSUS = /\s+(?:vs\.?|versus|v\.?|against)\s+/i;

/**
 * Site pages a whole query word names, listed in their own group below the results. Only pages that exist as routes
 * (src/shared/routes.ts), and never the navigation shortcuts search leaves out (My team, Predict, the track record,
 * Settings, the events list). A word must equal the token exactly: "rec" names nothing.
 */
export const SEARCH_PAGES: { words: string[]; page: SearchPageLink }[] = [
  { words: ["records", "record", "teams"], page: { title: "Team records", href: "/teams" } },
  { words: ["records", "matches"], page: { title: "Match records", href: "/matches" } },
  { words: ["rankings", "ranking"], page: { title: "Rankings", href: "/rankings" } },
  { words: ["compare"], page: { title: "Compare teams", href: "/compare" } },
  { words: ["rules", "manual"], page: { title: "Rules", href: "/rules" } },
  { words: ["faq", "help"], page: { title: "FAQ", href: "/faq" } },
  { words: ["download", "downloads"], page: { title: "Download FTC data", href: "/download" } },
  { words: ["contact"], page: { title: "Contact", href: "/contact" } },
  { words: ["privacy"], page: { title: "Privacy", href: "/privacy" } },
  { words: ["terms"], page: { title: "Terms of use", href: "/terms" } },
];

/** The pages a query's whole words name (each once, in table order). */
export function pagesFor(q: string): SearchPageLink[] {
  const tokens = new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return SEARCH_PAGES.filter((p) => p.words.some((w) => tokens.has(w))).map((p) => p.page);
}

/** Where a visitor can always go next: every team, every event. */
export const SEARCH_BROWSE: SearchPageLink[] = [{ title: "Browse all teams", href: "/teams" }, { title: "Browse all events", href: "/events" }];

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
  difficulty: { team: "schedule-difficulty" },
  history: { team: "events" },
};

/** The section `topic` opens on this kind of page (none: the page's top). */
export const sectionFor = (kind: SearchHit["kind"], topic: SearchTopic | null | undefined): SearchSection | undefined =>
  topic ? TOPIC_SECTION[topic][kind] : undefined;

/** How a topic reads in a hit's subtitle ("Awards · Oradell, NJ, USA") when it has no numbers of its own. */
export const TOPIC_LABEL: Record<SearchTopic, string> = {
  awards: "Awards", matches: "Matches", rankings: "Rankings", odds: "Advancement odds", playoffs: "Playoffs",
  rp: "Ranking points", opr: "OPR", record: "Record", stats: "Stats", difficulty: "Schedule difficulty", history: "Season road map",
};

export function hitHref(h: SearchHit): string {
  // A feature the server picked (Compare): always a site path.
  if (h.href?.startsWith("/") && !h.href.startsWith("//")) return h.href;
  if (h.kind === "team" && h.atEvent) { const [s, c] = h.atEvent.split(":"); return `/events/${s}/${c}?team=${h.ref}`; }
  if (h.kind === "team") return `/teams/${h.ref}${h.linkSeason ? `?season=${h.linkSeason}` : ""}${h.section ? `#${h.section}` : ""}`;
  if (h.kind === "event") { const [s, c] = h.ref.split(":"); return `/events/${s}/${c}${h.section ? `?tab=${h.section}` : ""}`; }
  if (h.kind === "place") return `/events?region=${encodeURIComponent(h.ref)}`;
  const [s, c, level, series, number] = h.ref.split(":");
  return `/events/${s}/${c}?match=${level}:${series}:${number}`;
}

/** The id of /search's first-paint JSON block: the query and the hits the server listed (server/seoMeta.ts). */
export const SEARCH_HITS_ID = "cs-search-hits";

const SECTION_LABEL: Partial<Record<NonNullable<SearchHit["section"]>, string>> = {
  awards: "Awards", matches: "Matches", events: "Events and history", "schedule-difficulty": "Schedule difficulty", rankings: "Rankings", odds: "Advancement odds", playoffs: "Playoffs",
};
/** "4215 Hypnotic Robotics" → "Hypnotic Robotics (4215)". */
const teamName = (h: SearchHit) => { const m = /^(\d+)\s+(.+)$/.exec(h.title); return m ? `${m[2]} (${m[1]})` : h.title; };

/** What the results page shows, in a line ("Hypnotic Robotics (4215) vs Bad Wolf (6980) — Compare"): the top result
 *  as the answer read it, and what it opens on. Null when nothing was found. */
export function showingLine(a: { hits: SearchHit[]; step: string; card?: { title: string } }): string | null {
  const top = a.hits[0];
  if (!top || a.step === "recovery") return null;
  if (top.href?.startsWith("/compare")) {
    const sides = top.title.split(" vs ").map((t) => teamName({ ...top, title: t }));
    return `${sides.join(" vs ")} — Compare${top.href.endsWith("#awards") ? " events and awards" : ""}`;
  }
  if (top.kind === "team") {
    const what = a.card?.title ?? (top.atEvent ? "At an event" : top.section ? SECTION_LABEL[top.section] : null);
    return `${teamName(top)}${what ? ` — ${what}` : ""}`;
  }
  return top.title;
}
