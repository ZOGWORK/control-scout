// The comparison /api/compare answers, assembled from its parts in one pure function. The server reads the parts
// from its database (server/api/teams.ts compareTeams); with no signal the app reads the very same parts from a
// saved event pack (src/lib/offline/answer.ts). Both call compareFromParts, so online and offline can't drift.
import type { CompareTeam, CompareView, MatchView, TeamEventRow, TeamInfo, TeamSeasonStats } from "./api";

/** Schedule order, as matchViews returns matches: by time (none first), event, quals before playoffs, series, number. */
export function bySchedule(a: { time: string | null; code: string; level: string; series: number; number: number }, b: typeof a): number {
  return (a.time ?? "").localeCompare(b.time ?? "") || a.code.localeCompare(b.code) || b.level.localeCompare(a.level) || a.series - b.series || a.number - b.number;
}

/** How a match relates the compared teams, seen from the first of them in it: "opponents" when another compared
 *  team was on the other side, "partners" when only on the same side, null when no other compared team played. */
export function relationOf(numbers: number[], red: number[], blue: number[]): "opponents" | "partners" | null {
  const base = numbers.find((n) => red.includes(n) || blue.includes(n));
  if (base == null) return null;
  const mine = red.includes(base) ? red : blue, theirs = mine === red ? blue : red;
  const others = numbers.filter((n) => n !== base);
  if (others.some((o) => theirs.includes(o))) return "opponents";
  return others.some((o) => mine.includes(o)) ? "partners" : null;
}

/** A team with no row in the teams table: its number and nothing else. */
export const unknownTeam = (number: number): TeamInfo => ({ number, name: null, fullName: null, school: null, sponsors: [], city: null, state: null, country: null, rookieYear: null, website: null, homeRegion: null });

/** The award rows compareBlock reads (the season's awards, newest event first). */
export interface CompareAwardRow { code: string; event: string; type: string; placement: number | string }

/** One team's column of a comparison, from its info, season stats, events and awards. */
export function compareBlock(number: number, info: TeamInfo | null, stats: TeamSeasonStats | null, events: TeamEventRow[], awards: CompareAwardRow[]): CompareTeam {
  return {
    team: info ?? unknownTeam(number),
    stats,
    events: events.map((e) => ({ code: e.code, name: e.name, start: e.start, opr: e.opr.np, auto: e.opr.auto, teleop: e.opr.teleop, endgame: e.opr.endgame, rank: e.rank })),
    awards: awards.map((a) => ({ code: a.code, event: a.event, type: a.type, placement: Number(a.placement) })),
  };
}

/**
 * The comparison of `numbers` in `season`: their blocks in the order asked, and the matches where at least two of
 * them played (opponents or partners), from each team's season matches (`matchesOf(n)`: every one but the last
 * team's is read, as a meeting always includes one of them). `relation` is from the side of the first requested
 * team that played. Merged in schedule order, so an event's matches stay together in one section.
 */
export function compareFromParts(numbers: number[], season: number, blocks: CompareTeam[], matchesOf: (team: number) => MatchView[]): CompareView {
  const meetings: CompareView["meetings"] = [];
  if (numbers.length >= 2) {
    const seen = new Set<string>();
    for (const n of numbers.slice(0, -1)) {
      for (const m of matchesOf(n)) {
        const id = `${m.code}:${m.key}`;
        if (!m.played || seen.has(id)) continue;
        const relation = relationOf(numbers, m.red.teams.map((t) => t.number), m.blue.teams.map((t) => t.number));
        if (!relation) continue;
        seen.add(id);
        meetings.push({ ...m, relation });
      }
    }
    meetings.sort(bySchedule);
  }
  return { season, teams: blocks, meetings };
}
