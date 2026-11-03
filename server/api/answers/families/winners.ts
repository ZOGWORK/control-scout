// An event's (or a season's championship's) winning alliance, from the published awards and the final playoff series:
//   "ftc decode winning alliance"          → the DECODE FIRST Championship: each division's winners, then the finals'
//   "New Jersey Championship winning alliance" → that event (its newest season unless one is named), and its divisions'
// The winning alliance is the event's Winning Alliance award (FIRST's own list of its teams); the final match scores
// are the playoff matches of the event's last series (its finals). Not played yet: said so, never a guess. Also the
// Worlds follow-ups every Worlds answer ends with: the season's championship events as buttons, from the data, and the
// related Worlds questions.
import type { StatAnswer, StatBlock, StatMatchRow } from "../../../../src/shared/searchStat.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { all, get } from "../../../db.js";
import { SEASONS } from "../../../data/seasons.js";
import { CHAMPIONSHIP_TYPE } from "../clauses.js";
import { eventHref, matchHref, shortEvent, teamLinks } from "../matchSet.js";

const RULE = "The winning alliance is the event's Winning Alliance award, as FIRST publishes it. The final matches are the event's last playoff series (its finals). A championship with divisions crowns a winning alliance in each division; the finals between the division winners crown the champion.";

interface Ev { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null; division: string | null }

const evCols = "season, code, name, type, start, end, division_code division";
const gameOf = (s: number) => SEASONS.find((x) => x.season === s)?.game ?? seasonLabel(s);

/** The latest season with a FIRST Championship in the data. */
async function latestChampionship(): Promise<number | null> {
  const s = (await get<{ s: number | null }>("SELECT MAX(season) s FROM events WHERE type = ?", [CHAMPIONSHIP_TYPE]))?.s;
  return s == null ? null : Number(s);
}

/** One event's winners, with its final matches (the last playoff series), as a table and match rows. */
async function winnersOf(e: Ev): Promise<{ teams: number[]; finals: StatMatchRow[] } | null> {
  const ws = await all<{ team: number }>("SELECT team FROM awards WHERE season = ? AND code = ? AND type = 'Winner' ORDER BY placement", [e.season, e.code]);
  if (!ws.length) return null;
  const teams = ws.map((w) => Number(w.team));
  const last = await get<{ s: number | null }>("SELECT MAX(series) s FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND played = 1", [e.season, e.code]);
  const ms = last?.s == null ? [] : await all<any>(
    `SELECT m.level, m.series, m.number, m.label, m.time, m.red_total, m.blue_total, m.red_np, m.blue_np,
            (SELECT GROUP_CONCAT(team) FROM match_teams x WHERE x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.alliance = 'red' AND x.on_field = 1) red,
            (SELECT GROUP_CONCAT(team) FROM match_teams x WHERE x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.alliance = 'blue' AND x.on_field = 1) blue
     FROM matches m WHERE m.season = ? AND m.code = ? AND m.level = 'playoff' AND m.series = ? AND m.played = 1 ORDER BY m.number`, [e.season, e.code, last.s]);
  const nums = (s: string | null) => String(s ?? "").split(",").filter(Boolean).map(Number);
  const links = await teamLinks([...teams, ...ms.flatMap((m) => [...nums(m.red), ...nums(m.blue)])]);
  const finals = ms.map((m): StatMatchRow => {
    // Shown from the winners' side: their colour, their score first.
    const red = nums(m.red), blue = nums(m.blue);
    const side: "red" | "blue" = red.some((t) => teams.includes(t)) ? "red" : "blue";
    const own = Number(side === "red" ? m.red_total : m.blue_total) || 0, opp = Number(side === "red" ? m.blue_total : m.red_total) || 0;
    const link = (n: number) => links.get(n)!;
    return {
      label: m.label, href: matchHref({ season: e.season, code: e.code, level: m.level, series: Number(m.series), number: Number(m.number) }),
      event: { label: shortEvent(e.name, e.type), href: eventHref(e.season, e.code) }, season: seasonLabel(e.season), date: m.time ? dateRange(String(m.time).slice(0, 10)) : null,
      alliance: side, own, opp, result: own > opp ? "W" : own < opp ? "L" : "T",
      partners: (side === "red" ? red : blue).map(link), opponents: (side === "red" ? blue : red).map(link),
    };
  });
  return { teams, finals };
}

/** The winning-alliance answer for a season's championship (`core` empty) or a named event. Null when nothing names one. */
export async function winnersAnswer(core: string, season: number | null, championship: boolean, findEvent: (words: string, season: number | null) => Promise<Ev | null>): Promise<StatAnswer | null> {
  let parent: Ev | null;
  if (!core || championship) {
    // The season's FIRST Championship: the season named, else the latest with one.
    const s = season ?? await latestChampionship();
    if (s == null) return null;
    parent = (await get<Ev>(`SELECT ${evCols} FROM events WHERE season = ? AND type = ? AND division_code IS NULL ORDER BY start, code LIMIT 1`, [s, CHAMPIONSHIP_TYPE])) ?? null;
    if (!parent) {
      const label = `${gameOf(s)} (${seasonLabel(s)})`;
      return { family: "event", intent: "winning-alliance", title: `${label} championship winning alliance`, scope: ["FIRST Championship (Worlds)", seasonLabel(s)], blocks: [], definition: RULE, source: "No championship events in the data for this season", none: `No championship results yet for ${gameOf(s)}: the ${seasonLabel(s)} FIRST Championship isn't in the data.` };
    }
  } else parent = await findEvent(core, season);
  if (!parent) return null;
  const divisions = await all<Ev>(`SELECT ${evCols} FROM events WHERE season = ? AND division_code = ? ORDER BY name`, [parent.season, parent.code]);
  const worlds = parent.type === CHAMPIONSHIP_TYPE;
  const title = worlds ? `${gameOf(parent.season)} ${seasonLabel(parent.season)} FIRST Championship winning alliances` : `${shortEvent(parent.name, parent.type)} winning alliance`;
  const blocks: StatBlock[] = [];
  const top = await winnersOf(parent);
  const links = await teamLinks(top?.teams ?? []);
  const alliance = (ts: number[]) => ts.map((t) => links.get(t)?.label ?? String(t)).join(", ");
  if (top) blocks.push({ kind: "matches", title: worlds ? "Finals: the champions' matches" : "Final matches", rows: top.finals });
  const rows: { cells: Record<string, string>; href: string; strong?: boolean }[] = [];
  let decided = top ? 1 : 0;
  for (const d of divisions) {
    const w = await winnersOf(d);
    if (w) decided++;
    const dl = await teamLinks(w?.teams ?? []);
    rows.push({ cells: { division: shortEvent(d.name, d.type), alliance: w ? w.teams.map((t) => dl.get(t)?.label ?? String(t)).join(", ") : "Not decided in the data yet", final: w?.finals.map((f) => `${f.label} ${f.own}–${f.opp}`).join(", ") || "–" }, href: eventHref(d.season, d.code) });
  }
  if (rows.length) blocks.push({ kind: "table", title: worlds ? "Each division's winning alliance" : "Each division's winning alliance", columns: [{ key: "division", label: "Division" }, { key: "alliance", label: "Winning alliance" }, { key: "final", label: "Finals" }], rows });
  if (worlds) blocks.push(...(await worldsFollowUps(parent.season, null)));
  const base = { family: "event" as const, intent: "winning-alliance", title, scope: [worlds ? "FIRST Championship (Worlds)" : shortEvent(parent.name, parent.type), seasonLabel(parent.season)], definition: RULE, source: `From the published awards and playoff matches of ${1 + divisions.length} event${divisions.length ? "s" : ""}, ${dateRange(parent.start, parent.end)}` };
  if (!decided) return { ...base, blocks, none: worlds ? `No championship results yet for ${gameOf(parent.season)}: no winning alliance is published.` : `No winning alliance is published for ${shortEvent(parent.name, parent.type)} yet.` };
  return {
    ...base, blocks,
    ...(top ? { headline: { value: alliance(top.teams), label: worlds ? `${seasonLabel(parent.season)} FIRST Championship winners (the finals between the division winners)` : `Won ${shortEvent(parent.name, parent.type)}`, sub: top.finals.map((f) => `${f.label} ${f.own}–${f.opp}`).join(" · ") || undefined, href: eventHref(parent.season, parent.code) } } : {}),
  };
}

/** Below every Worlds answer: the season's championship events from the data (never from memory), and the related
 *  Worlds questions for the team asked about. A season with none in the data says so. */
export async function worldsFollowUps(season: number | null, team: { number: number } | null): Promise<StatBlock[]> {
  const s = season ?? await latestChampionship();
  const evs = s == null ? [] : await all<Ev>(`SELECT ${evCols} FROM events WHERE season = ? AND type = ? ORDER BY division_code IS NULL, name`, [s, CHAMPIONSHIP_TYPE]);
  const out: StatBlock[] = [{
    kind: "links", title: s != null ? `Worlds events, ${seasonLabel(s)}` : "Worlds events",
    items: evs.map((e) => ({ label: shortEvent(e.name, e.type).replace(/^Worlds · /, ""), href: eventHref(e.season, e.code), sub: e.division ? undefined : "finals" })),
    none: s != null ? `No championship events for ${seasonLabel(s)} in the data.` : "No championship events in the data.",
  }];
  const qs = team
    ? [`${team.number} worlds record`, `${team.number} highest score in worlds`, `how many matches has ${team.number} won at worlds`, `when did ${team.number} go to worlds`]
    : [];
  if (s != null) qs.push(`${gameOf(s).toLowerCase()} winning alliance`);
  out.push({ kind: "related", title: "You may also want to know", queries: qs });
  return out;
}
