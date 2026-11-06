// The related searches page (/related-searches?q=…): every follow-up a search has (./followUps.ts), grouped by what
// it's about, each a link to the live search with its answer's own line. Only searches answered directly are listed,
// the same check as on /search, and a group only with two or more. With no query, or one nothing follows from, the
// season's starting points: the searches that follow from no search at all, the same way.
import type { RelatedPageView, SearchAnswer, SearchFollowUp } from "../../../src/shared/api.js";
import { SEARCH_PAGE_LIMIT } from "../../../src/shared/search.js";
import { followUps, lineOf, pageAnswer } from "./followUps.js";

type RelatedGroup = RelatedPageView["groups"][number];

/** The groups' headings, in the page's order. */
const TITLES: Record<SearchFollowUp["family"], string> = { team: "About this team", leaders: "Top teams", compare: "Compare", events: "Events", awards: "Awards", predict: "Predictions" };
/** A group needs this many to have its own heading, which would otherwise head one link. */
const GROUP_MIN = 2;

/** The follow-ups as groups of two or more, in the headings' order. The ones a group of one would hold are "More
 *  searches" together (two or more), or join the biggest group (one alone): never left out, never a heading of one. */
export function grouped(items: SearchFollowUp[]): RelatedGroup[] {
  const all = (Object.keys(TITLES) as SearchFollowUp["family"][]).map((f) => ({ title: TITLES[f], items: items.filter((x) => x.family === f) })).filter((g) => g.items.length);
  const groups = all.filter((g) => g.items.length >= GROUP_MIN);
  const rest = all.filter((g) => g.items.length < GROUP_MIN).flatMap((g) => g.items);
  if (rest.length >= GROUP_MIN) return [...groups, { title: "More searches", items: rest }];
  const biggest = groups.reduce<RelatedGroup | null>((b, g) => (!b || g.items.length > b.items.length ? g : b), null);
  return biggest ? groups.map((g) => (g === biggest ? { ...g, items: [...g.items, ...rest] } : g)) : [];
}

const EMPTY: SearchAnswer = { q: "", hits: [], pages: [], step: "deterministic", weak: false };

/** Everything that follows from `q` (its answer's highlights, questions and related searches), or the starting
 *  points when nothing does. */
export async function relatedPage(raw: string, prefer: ReadonlySet<string> = new Set()): Promise<RelatedPageView> {
  const q = raw.trim();
  const all = async (x: string, a: SearchAnswer) => {
    const f = await followUps(x, a, prefer);
    return [...(f.highlights ? [f.highlights] : []), ...f.ask, ...f.related];
  };
  // Only a search that answered (or said sorry about something it read) has follow-ups of its own: one that found
  // nothing gets the starting points, said so.
  const a = q ? await pageAnswer(q, SEARCH_PAGE_LIMIT, prefer) : null;
  const groups = a && (lineOf(a) || a.sorry) ? grouped(await all(q, a)) : [];
  if (groups.length) return { q, found: true, groups };
  return { q, found: false, groups: grouped(await all("", EMPTY)) };
}
