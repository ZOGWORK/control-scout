// A team's highlights (a search for the team alone, "4215", or with "highlights": server/api/query/execute.ts): its
// standout matches of its latest season with matches (or the season asked), at one event when one is named (an event,
// Worlds, a state championship), each a match box saying why it's there (best score, biggest win, latest playoff win,
// best Auto, closest win), so the answer's video (./video.ts) gives each its clip and the card plays the best one. Each
// match is listed once, under the first reason it meets; an event's few matches are never padded from elsewhere. Only
// matches the team's robot played in; points never compared across seasons.
import { seasonLabel } from "../../../src/shared/format.js";
import type { StatAnswer, StatMatchRow } from "../../../src/shared/searchStat.js";
import { dateRange } from "../../../src/shared/format.js";
import { eventHref, matchRow, teamLinks, teamMatches, type TeamMatch } from "./matchSet.js";
import { teamEventSet } from "./eventSet.js";

/** Where a team's highlights are read: its matches at an event named (or Worlds, or a state championship), and that
 *  place in words ("New Jersey Championship", "the FIRST Championship") for when it played none there. */
export interface TeamHighlightScope { has: (m: TeamMatch) => boolean; label: string }

const np = (m: TeamMatch) => m.ownNp ?? m.own;
const margin = (m: TeamMatch) => m.own - m.opp;
const key = (m: TeamMatch) => `${m.season}|${m.code}|${m.level}|${m.series}|${m.number}`;

/** Why each pick is a highlight, and how it's picked from the season's matches (null: none qualifies). */
export const HIGHLIGHT_REASONS: { note: string; pick: (xs: TeamMatch[]) => TeamMatch | undefined }[] = [
  { note: "Best score", pick: (xs) => best(xs, (m) => np(m)) },
  { note: "Biggest win", pick: (xs) => best(xs.filter((m) => m.result === "W"), margin) },
  // The last one played: the deepest the team went in a bracket that season.
  { note: "Latest playoff win", pick: (xs) => xs.filter((m) => m.level === "playoff" && m.result === "W").at(-1) },
  { note: "Best Auto", pick: (xs) => best(xs.filter((m) => m.ownAuto != null), (m) => m.ownAuto!) },
  { note: "Closest win", pick: (xs) => best(xs.filter((m) => m.result === "W"), (m) => -margin(m)) },
];

/** The highest by `by`; the earlier match on a tie (the list is oldest first). */
function best(xs: TeamMatch[], by: (m: TeamMatch) => number): TeamMatch | undefined {
  return xs.reduce<TeamMatch | undefined>((a, m) => (a == null || by(m) > by(a) ? m : a), undefined);
}

/** The highlights answer for `asked` (a season the search named) or else the team's latest season with matches, at
 *  `at` when an event is named; null when it has no played match in that season, or (an event named) the card saying
 *  it has none there, with its events. */
export async function teamHighlights(team: { number: number; name: string | null }, asked?: number, at?: TeamHighlightScope): Promise<StatAnswer | null> {
  const all = (await teamMatches(team.number)).filter((m) => m.onField && (asked == null || m.season === asked) && (!at || at.has(m)));
  if (!all.length) return at ? notThere(team, asked, at) : null;
  const season = Math.max(...all.map((m) => m.season));
  const xs = all.filter((m) => m.season === season);
  const seen = new Set<string>();
  const picks: { m: TeamMatch; note: string }[] = [];
  for (const r of HIGHLIGHT_REASONS) {
    const m = r.pick(xs);
    if (m && !seen.has(key(m))) { seen.add(key(m)); picks.push({ m, note: r.note }); }
  }
  const links = await teamLinks(picks.flatMap(({ m }) => [...m.partners, ...m.opponents]));
  const rows: StatMatchRow[] = picks.map(({ m, note }) => ({ ...matchRow(m, links, team.number), note }));
  const top = picks[0].m;
  const S = seasonLabel(season);
  return {
    // The event is said once, in the title: its first match's (a Worlds division before the finals it feeds).
    family: "superlative", intent: "team-highlights", title: `Highlights${at ? ` at ${xs[0].event}` : ""}, ${S}`, team, scope: [S],
    headline: { value: `${np(top)} points`, label: `Best score: ${top.label} at ${top.event}`, sub: `${top.own !== np(top) ? `${top.own} with penalties · ` : ""}${top.result === "W" ? "Won" : top.result === "L" ? "Lost" : "Tied"} ${top.own}–${top.opp}`, href: rows[0].href },
    blocks: [{ kind: "matches", title: `${picks.length} standout ${picks.length === 1 ? "match" : "matches"}`, rows }],
    definition: `The team's standout matches${at ? ` at ${xs[0].event}` : ""} of ${S}${asked == null ? `, its latest season with matches${at ? " there" : ""}` : ""}: its best score (points without penalties), biggest win (by margin), latest playoff win, best Auto and closest win, each match once. Only matches its robot played in. A match with a video plays here.`,
    source: `From ${xs.length} ${xs.length === 1 ? "match" : "matches"} in ${S}`,
  };
}

/** A team with no played match at the event named: said so, with its own events of the season (the latest it has
 *  events in, when none was asked), never another team's matches or the closest results. */
async function notThere(team: { number: number; name: string | null }, asked: number | undefined, at: TeamHighlightScope): Promise<StatAnswer> {
  const { events } = await teamEventSet(team.number);
  const season = asked ?? (events.length ? Math.max(...events.map((e) => e.season)) : null);
  const S = season == null ? null : seasonLabel(season);
  const theirs = events.filter((e) => e.season === season).reverse();
  const who = `${team.name ?? `Team ${team.number}`} (${team.number})`;
  return {
    family: "superlative", intent: "team-highlights", title: `No highlights at ${at.label}${asked != null && S ? `, ${S}` : ""}`, team, scope: S ? [S] : [],
    blocks: theirs.length ? [{ kind: "links", title: `Its ${S} events`, items: theirs.map((e) => ({ label: e.name, sub: dateRange(e.start, e.end) || undefined, href: eventHref(e.season, e.code, team.number) })) }] : [],
    definition: "A team's highlights at an event are its standout matches there: only matches its robot played in at that event, never padded from other events.",
    source: `From ${who}'s matches on record`,
    none: `${who} has no played matches at ${at.label}${asked != null && S ? ` in ${S}` : ""}.${theirs.length ? ` Its ${S} events are below.` : " It has no events on record."}`,
  };
}
