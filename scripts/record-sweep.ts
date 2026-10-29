// Sweep every team-season in the database for the two record checks of the team page (launch P0, 2026-10-28):
//  1. its event rows (/api/teams/:n?season=, server/api/teams.ts teamEvents) add up to its season record;
//  2. its season record (team_season_stats, the stats job) is every match on its record (src/shared/eventRecord.ts).
// Read-only. Prints the counts and the first few teams failing each check.
//   npx tsx scripts/record-sweep.ts                  every season
//   npx tsx scripts/record-sweep.ts --season 2025    one season
//   npx tsx scripts/record-sweep.ts --show 20        list up to 20 failing teams per check (default 5)
// DATABASE_URL picks the database, as for every script (default .data/scout.db).
import "../server/env.js";
import { all } from "../server/db.js";
import { SEASON_NUMBERS } from "../server/data/seasons.js";
import { recordSql } from "../src/shared/eventRecord.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
// --teams <module>: another copy of server/api/teams.ts to read the rows with (e.g. main's, for a before/after count).
const { seasonStats, teamEvents } = await import(arg("teams") ?? "../server/api/teams.js") as typeof import("../server/api/teams.js");
const seasons = arg("season") ? [Number(arg("season"))] : SEASON_NUMBERS;
const show = Number(arg("show") ?? 5);

type Wlt = { wins: number; losses: number; ties: number; matches: number };
const text = (r: Wlt) => `${r.wins}-${r.losses}-${r.ties} (${r.matches})`;
const same = (a: Wlt, b: Wlt) => a.wins === b.wins && a.losses === b.losses && a.ties === b.ties && a.matches === b.matches;

let teamSeasons = 0, rowsOff = 0, headOff = 0;
for (const season of seasons) {
  const t0 = Date.now();
  // Every team with a season row or a match on record this season.
  const teams = (await all<{ team: number }>(
    "SELECT team FROM team_season_stats WHERE season = ? UNION SELECT DISTINCT team FROM match_teams WHERE season = ? ORDER BY team", [season, season],
  )).map((r) => Number(r.team));
  // What the matches say, all events at once: team → its record over every counted match.
  const fromMatches = new Map<number, Wlt>();
  for (const r of await all<any>(recordSql("mt.season = ?"), [season])) {
    const a = fromMatches.get(Number(r.team)) ?? { wins: 0, losses: 0, ties: 0, matches: 0 };
    a.wins += Number(r.wins); a.losses += Number(r.losses); a.ties += Number(r.ties); a.matches += Number(r.played);
    fromMatches.set(Number(r.team), a);
  }
  let sRows = 0, sHead = 0;
  const badRows: string[] = [], badHead: string[] = [];
  for (const team of teams) {
    const [stats, rows] = await Promise.all([seasonStats(season, team), teamEvents(season, team)]);
    const head: Wlt = stats ? { wins: Number(stats.record.wins), losses: Number(stats.record.losses), ties: Number(stats.record.ties), matches: Number(stats.record.matches) } : { wins: 0, losses: 0, ties: 0, matches: 0 };
    // `played` is the rows' match count; before it existed, FIRST's qualPlayed was the closest a row came.
    const sum = rows.reduce<Wlt>((a, e: any) => ({ wins: a.wins + (e.wins ?? 0), losses: a.losses + (e.losses ?? 0), ties: a.ties + (e.ties ?? 0), matches: a.matches + (e.played ?? e.qualPlayed ?? 0) }), { wins: 0, losses: 0, ties: 0, matches: 0 });
    const all_ = fromMatches.get(team) ?? { wins: 0, losses: 0, ties: 0, matches: 0 };
    if (!same(sum, head)) { sRows++; if (badRows.length < show) badRows.push(`${team}: rows ${text(sum)} vs season ${text(head)}`); }
    if (!same(head, all_)) { sHead++; if (badHead.length < show) badHead.push(`${team}: season ${text(head)} vs matches ${text(all_)}`); }
  }
  teamSeasons += teams.length; rowsOff += sRows; headOff += sHead;
  console.log(`${season}: ${teams.length} team-seasons · rows ≠ season record: ${sRows} · season record ≠ matches: ${sHead} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  for (const b of badRows) console.log(`  rows   ${b}`);
  for (const b of badHead) console.log(`  season ${b}`);
}
console.log(`total: ${teamSeasons} team-seasons · rows ≠ season record: ${rowsOff} · season record ≠ matches: ${headOff}`);
