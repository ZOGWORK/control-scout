// The related searches page (/related-searches?q=…): every follow-up a search has (./followUps.ts), grouped by what
// it's about, each a link to the live search with its answer's own line. Only searches answered directly are listed,
// the same check as on /search, and a group only with two or more. With no query, or one nothing follows from, the
// season's starting points: the searches that follow from no search at all, the same way.
import type { RelatedPageView, SearchAnswer, SearchFollowUp } from "../../../src/shared/api.js";
import { SEARCH_PAGE_LIMIT, relatedQuery } from "../../../src/shared/search.js";
import { get } from "../../db.js";
import { followUps, lineOf, pageAnswer } from "./followUps.js";

type RelatedGroup = RelatedPageView["groups"][number];

/** The groups' headings, in the page's order. */
const TITLES: Record<SearchFollowUp["family"], string> = { team: "About this team", leaders: "Top teams", compare: "Compare", events: "Events", awards: "Awards", predict: "Predictions" };
/** A group needs this many to have its own heading, which would otherwise head one link. */
const GROUP_MIN = 2;

/** The follow-ups as groups of two or more, in the headings' order. The ones a group of one would hold are "More
 *  searches" together (two or more), or join the biggest group (one alone): never left out, never a heading of one.
 *  One search alone, with no group to join, is listed with no heading (title ""). */
export function grouped(items: SearchFollowUp[]): RelatedGroup[] {
  const all = (Object.keys(TITLES) as SearchFollowUp["family"][]).map((f) => ({ title: TITLES[f], items: items.filter((x) => x.family === f) })).filter((g) => g.items.length);
  const groups = all.filter((g) => g.items.length >= GROUP_MIN);
  const rest = all.filter((g) => g.items.length < GROUP_MIN).flatMap((g) => g.items);
  if (rest.length >= GROUP_MIN) return [...groups, { title: "More searches", items: rest }];
  const biggest = groups.reduce<RelatedGroup | null>((b, g) => (!b || g.items.length > b.items.length ? g : b), null);
  if (!biggest) return rest.length ? [{ title: "", items: rest }] : [];
  return groups.map((g) => (g === biggest ? { ...g, items: [...g.items, ...rest] } : g));
}

const EMPTY: SearchAnswer = { q: "", hits: [], pages: [], step: "deterministic", weak: false };

/** The team group's title for team `n`: its number and name, when every search in the group as grouped (a lone
 *  leftover joins it) is about it (each says its number); a group about two teams (a "vs" search's), or with a broader
 *  search in it ("top teams"), stays "About this team". */
export async function teamTitle(n: number, items: SearchFollowUp[]): Promise<string | undefined> {
  const said = new RegExp(`(?<![\\d])${n}(?![\\d])`);
  if (!items.length || !items.every((x) => said.test(x.q))) return undefined;
  const row = await get<{ name: string | null }>("SELECT name FROM teams WHERE number = ?", [n]);
  return `About ${n}${row?.name ? ` ${row.name}` : ""}`;
}

/** Everything that follows from `q` (its answer's highlights, questions and related searches), or the starting
 *  points when nothing does. */
export async function relatedPage(raw: string, prefer: ReadonlySet<string> = new Set()): Promise<RelatedPageView> {
  const q = relatedQuery(raw);
  // Grouped, the team group titled with the team it's about (the starting points' too: the season's leader).
  const all = async (x: string, a: SearchAnswer) => {
    const f = await followUps(x, a, prefer);
    const groups = grouped([...(f.highlights ? [f.highlights] : []), ...f.ask, ...f.related]);
    const team = groups.find((g) => g.title === TITLES.team);
    const title = team && f.about != null ? await teamTitle(f.about, team.items) : undefined;
    return title ? groups.map((g) => (g === team ? { ...g, title } : g)) : groups;
  };
  // The search's own follow-ups, the same /search shows beside it, for any search that found something: an answer, a
  // sorry about something it read, or results (a plain team search's). One that found nothing gets the starting
  // points, said so (the follow-ups /search offers under nothing found are those same starting points).
  const a = q ? await pageAnswer(q, SEARCH_PAGE_LIMIT, prefer) : null;
  const groups = a && (lineOf(a) || a.sorry || a.hits.length) ? await all(q, a) : [];
  if (groups.length) return { q, found: true, groups };
  return { q, found: false, groups: await all("", EMPTY) };
}
