// A place's teams by their win streak ("who has the longest winning streak in Romania right now"): each team from there,
// its matches in date order over the current season and the one before, the streak counted as a team's own streak
// answer counts it (../answers/families/matches.ts: a tie ends it). Both lists: the longest run in those seasons and the
// run up to each team's latest match ("now" said leads with it). A place is needed: the world's every match is too many.
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat.js";
import type { Region } from "../../../src/shared/regions.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { all } from "../../db.js";
import { matchHref, shortEvent, teamLinks } from "../answers/matchSet.js";

interface Row { team: number; season: number; code: string; level: string; series: number; number: number; label: string; name: string; type: string | null; alliance: string; red_total: number; blue_total: number }

/** Whether the query asks for the streak going now ("right now", "current", "still"), not the longest of the seasons. */
export const asksNow = (q: string) => /\b(?:now|rn|currently|current|ongoing|active|still|at the moment)\b/i.test(q);

export async function streakBoardAnswer(o: { region: Region; season: number; now: boolean; losing: boolean; n: number }): Promise<StatAnswer> {
  const want = o.losing ? "L" : "W";
  const rows = await all<Row>(`SELECT t.team, m.season, m.code, m.level, m.series, m.number, m.label, e.name, e.type, t.alliance, m.red_total, m.blue_total
    FROM match_teams t JOIN matches m ON m.season = t.season AND m.code = t.code AND m.level = t.level AND m.series = t.series AND m.number = t.number
    JOIN events e ON e.season = m.season AND e.code = m.code JOIN teams tm ON tm.number = t.team
    WHERE t.on_field = 1 AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL AND m.season IN (?, ?)
      AND tm.country = ?${o.region.state ? " AND tm.state = ?" : ""}
    ORDER BY t.team, COALESCE(m.time, e.start), e.start, m.code, CASE m.level WHEN 'qual' THEN 0 ELSE 1 END, m.series, m.number`,
    [o.season - 1, o.season, o.region.country, ...(o.region.state ? [o.region.state] : [])]);
  const result = (r: Row) => (r.red_total === r.blue_total ? "T" : (r.red_total > r.blue_total) === (r.alliance === "red") ? "W" : "L");
  const byTeam = new Map<number, Row[]>();
  for (const r of rows) byTeam.set(Number(r.team), [...(byTeam.get(Number(r.team)) ?? []), r]);
  // Each team's longest run in the seasons, and its run up to its latest match (both shown: "now" is the second's).
  const longest: { team: number; run: Row[] }[] = [], going: { team: number; run: Row[] }[] = [];
  for (const [team, ms] of byTeam) {
    let run: Row[] = [], cur: Row[] = [];
    for (const m of ms) { if (result(m) === want) { cur.push(m); if (cur.length > run.length) run = [...cur]; } else cur = []; }
    if (run.length) longest.push({ team, run });
    if (cur.length) going.push({ team, run: cur });
  }
  const order = (xs: typeof longest) => xs.sort((x, y) => y.run.length - x.run.length || x.team - y.team);
  order(longest); order(going);
  const kind = o.losing ? "losing" : "win";
  const seasons = `${seasonLabel(o.season - 1)} and ${seasonLabel(o.season)}`;
  const lead = o.now ? going : longest;
  const title = `${o.now ? "Current" : "Longest"} ${kind} streaks in ${o.region.name}`;
  const definition = `A streak: matches in a row with the same result for one team, in date order across events and seasons (a tie ends it). Longest: the longest run in ${seasons}; going now: the run up to the team's latest match. Teams from ${o.region.name}, every match they played in ${seasons}, final scores with penalties.`;
  const base = { family: "aggregate" as const, intent: "streak-board", title, scope: [o.region.name, seasons], definition, source: `From ${rows.length.toLocaleString("en-US")} match results of ${byTeam.size.toLocaleString("en-US")} teams from ${o.region.name}` };
  if (!lead.length) return { ...base, blocks: [], none: byTeam.size ? `No team from ${o.region.name} is on a ${kind} streak${o.now ? " now: each one's latest match broke it" : ` in ${seasons}`}.` : `No matches played by teams from ${o.region.name} in ${seasons} on record.` };
  const links = await teamLinks([...longest.slice(0, o.n), ...going.slice(0, o.n)].map((r) => r.team));
  const label = (n: number) => links.get(n)?.label ?? String(n);
  const at = (m: Row) => `${m.label} at ${shortEvent(m.name, m.type)}`;
  const span = (r: { run: Row[] }) => `${at(r.run[0])} to ${at(r.run[r.run.length - 1])}`;
  const word = (n: number) => `${n} ${o.losing ? (n === 1 ? "loss" : "losses") : n === 1 ? "win" : "wins"}`;
  const table = (xs: typeof longest, title: string): StatBlock => ({
    kind: "table", title,
    columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "streak", label: "Streak" }, { key: "from", label: "From – to" }],
    rows: xs.slice(0, o.n).map((r, i) => ({ cells: { rank: i + 1, team: label(r.team), streak: word(r.run.length), from: span(r) }, href: links.get(r.team)?.href ?? `/teams/${r.team}` })),
  });
  const first = lead[0];
  const ties = lead.filter((r) => r.run.length === first.run.length).length;
  const now = table(going, `Going now, up to each team's latest match`), most = table(longest, `Longest in ${seasons}`);
  const blocks = (o.now ? [now, most] : [most, now]).filter((b) => b.kind === "table" && b.rows.length);
  return {
    ...base, blocks,
    headline: {
      value: word(first.run.length), href: matchHref(first.run[first.run.length - 1]),
      label: `${label(first.team)}${ties > 1 ? ` and ${ties - 1} more` : ""}, ${o.now ? "in a row up to the latest match" : "in a row"}`,
      sub: `${span(first)}${o.now ? "" : going.length ? ` · going now: ${label(going[0].team)}, ${word(going[0].run.length)}` : ""}`,
    },
  };
}
