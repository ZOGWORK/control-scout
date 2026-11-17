// A place's own pages, for search answers about it: "nj" (New Jersey alone) links its rankings, its leagues and, for
// New Jersey, its conferences; "nj rankings", "nj leagues" and "nj conferences" link the one they ask for, first.
// Generic: any place regionOf reads (a state's name or code, a country's), never a list of places written here.
import type { SearchPageLink } from "./api.js";
import { CONFERENCE_REGION } from "./conferences.js";
import { regionHref } from "./regionRankings.js";
import type { Region } from "./regions.js";
import { regionOf } from "./searchEventQuery.js";

export type PlacePage = "rankings" | "leagues" | "conferences";

/** The words that ask for one of a place's pages ("nj rankings"): each with the page it asks for. */
const ASKS: Record<string, PlacePage> = {
  rankings: "rankings", ranking: "rankings", ranked: "rankings", rank: "rankings",
  leagues: "leagues", league: "leagues",
  conferences: "conferences", conference: "conferences",
};
/** Said around a place and its page words without asking for anything else ("show me the nj rankings"). */
const FRAME = new Set(["the", "in", "of", "for", "show", "me", "all", "list", "ftc"]);

/** FIRST's region code for a place (New Jersey: "USNJ"), as conferences and leagues store it. */
const firstRegion = (r: Region) => (r.country === "USA" ? `US${r.state}` : null);

/** The pages a place has, in this order. Conferences: New Jersey's alone (src/shared/conferences.ts). */
export function placePages(r: Region, which: readonly PlacePage[] = ["rankings", "leagues", "conferences"]): SearchPageLink[] {
  const out: SearchPageLink[] = [];
  if (which.includes("rankings")) out.push({ title: `Rankings in ${r.name}`, href: regionHref(r.key) });
  if (which.includes("leagues")) out.push({ title: `Leagues in ${r.name}`, href: `/leagues?q=${encodeURIComponent(r.name)}` });
  if (which.includes("conferences") && firstRegion(r) === CONFERENCE_REGION) out.push({ title: `Conferences in ${r.name}`, href: `/search?q=${encodeURIComponent(`${r.name} conferences`)}` });
  return out;
}

/** The place `q` names and the pages it asks for: every one for the place alone, else those its words ask for. Null
 *  when the query is more than a place and those words (a team, an event's name, a time). */
export function placeAsk(q: string): { region: Region; pages: PlacePage[] } | null {
  const words = q.replace(/[?!.,]/g, " ").split(/\s+/).filter(Boolean);
  const asked = [...new Set(words.map((w) => ASKS[w.toLowerCase()]).filter((p): p is PlacePage => !!p))];
  const rest = words.filter((w) => !ASKS[w.toLowerCase()] && !FRAME.has(w.toLowerCase()));
  const region = rest.length ? regionOf(rest) : null;
  if (!region) return null;
  return { region, pages: asked.length ? asked : ["rankings", "leagues", "conferences"] };
}

/** `pages` with the place's own first. A page the answer links already (its season named, "?season=2025") is the
 *  answer's: kept where it was, never linked twice. */
export function withPlacePages(q: string, pages: SearchPageLink[]): SearchPageLink[] {
  const ask = placeAsk(q);
  if (!ask) return pages;
  const path = (href: string) => href.split("#")[0].split("?")[0];
  // Asked for by name ("nj conferences"), a page that is itself a search is this answer: never linked to itself.
  const asked = ask.pages.length < 3;
  const own = placePages(ask.region, ask.pages).filter((o) => !(asked && path(o.href) === "/search") && !pages.some((p) => path(p.href) === path(o.href) && path(o.href) !== "/search"));
  return [...own, ...pages.filter((p) => !own.some((o) => o.href === p.href))];
}
