// A team's highlights (a search for the team alone, "4215"): its standout matches of its latest season with matches,
// each a match box saying why it's there (best score, biggest win, latest playoff win, best Auto, closest win), so
// the answer's video (./video.ts) gives each its clip and the card plays the best one. Each match is listed once,
// under the first reason it meets. Only matches the team's robot played in; points never compared across seasons.
import { seasonLabel } from "../../../src/shared/format.js";
import type { StatAnswer, StatMatchRow } from "../../../src/shared/searchStat.js";
import { matchRow, teamLinks, teamMatches, type TeamMatch } from "./matchSet.js";

const np = (m: TeamMatch) => m.ownNp ?? m.own;
const margin = (m: TeamMatch) => m.own - m.opp;
const key = (m: TeamMatch) => `${m.season}|${m.code}|${m.level}|${m.series}|${m.number}`;

/** Why each pick is a highlight, and how it's picked from the season's matches (null: none qualifies). */
const REASONS: { note: string; pick: (xs: TeamMatch[]) => TeamMatch | undefined }[] = [
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

/** The highlights answer, or null when the team has no played match on record. */
export async function teamHighlights(team: { number: number; name: string | null }): Promise<StatAnswer | null> {
  const all = (await teamMatches(team.number)).filter((m) => m.onField);
  if (!all.length) return null;
  const season = Math.max(...all.map((m) => m.season));
  const xs = all.filter((m) => m.season === season);
  const seen = new Set<string>();
  const picks: { m: TeamMatch; note: string }[] = [];
  for (const r of REASONS) {
    const m = r.pick(xs);
    if (m && !seen.has(key(m))) { seen.add(key(m)); picks.push({ m, note: r.note }); }
  }
  const links = await teamLinks(picks.flatMap(({ m }) => [...m.partners, ...m.opponents]));
  const rows: StatMatchRow[] = picks.map(({ m, note }) => ({ ...matchRow(m, links, team.number), note }));
  const top = picks[0].m;
  const S = seasonLabel(season);
  return {
    family: "superlative", intent: "team-highlights", title: `Highlights, ${S}`, team, scope: [S],
    headline: { value: `${np(top)} points`, label: `Best score: ${top.label} at ${top.event}`, sub: `${top.own !== np(top) ? `${top.own} with penalties · ` : ""}${top.result === "W" ? "Won" : top.result === "L" ? "Lost" : "Tied"} ${top.own}–${top.opp}`, href: rows[0].href },
    blocks: [{ kind: "matches", title: `${picks.length} standout ${picks.length === 1 ? "match" : "matches"}`, rows }],
    definition: `The team's standout matches of ${S}, its latest season with matches: its best score (points without penalties), biggest win (by margin), latest playoff win, best Auto and closest win, each match once. Only matches its robot played in. A match with a video plays here.`,
    source: `From ${xs.length} ${xs.length === 1 ? "match" : "matches"} in ${S}`,
  };
}
