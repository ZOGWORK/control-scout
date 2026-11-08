// "Which event had the most teams in California this season", "biggest events in NJ", "largest qualifier in Texas": the
// events of a place and season ranked by how many teams they list (an event with divisions counted once, every
// division's teams together). The place, kind of event and season are read as event searches read them.
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { eventTypesOf, readEventQuery, type EventQuery } from "../../../../src/shared/searchEventQuery.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { all } from "../../../db.js";
import { CURRENT_SEASON } from "../../../data/seasons.js";
import { eventHref } from "../matchSet.js";

/** `min`: only events listing at least that many teams ("with more than 40 teams" is 41), as `said` words it. */
export interface BiggestEventsQuestion { e: EventQuery; n: number; min?: { teams: number; said: string } }

/** "Biggest event", "largest qualifiers", "which event had the most teams", "events with the most teams". Search may hand
 *  the words over singular ("the most team"), so both. */
const KIND = String.raw`(events?|competitions?|tournaments?|qualifiers?|meets?|championships?)`;
const MOST_TEAMS = String.raw`the\s+most\s+teams?`;
const ASKED = new RegExp(String.raw`\b(?:the\s+)?(?:biggest|largest)\s+${KIND}\b|\b(?:which|what)\s+${KIND}\s+(?:had|has|have|got)\s+${MOST_TEAMS}\b|\b${KIND}\s+with\s+${MOST_TEAMS}\b`, "i");
const THIS_SEASON = /\b(?:this|the\s+current)\s+(?:season|year)\b/i;
const COUNT = /\btop\s+(\d{1,2})\b/i;
/** "With more than 40 teams", "over 40 teams", "at least 40 teams", "40+ teams" (read as "40 or more"), "40 or more teams". */
const FLOOR = /\b(?:with|having|that\s+(?:had|has|have))\s+(?:(more\s+than|over|at\s+least)\s+(\d{1,4})|(\d{1,4})\s+or\s+more)\s+teams?\b/i;
const KIND_WORD = new RegExp(String.raw`\b${KIND}\b`, "i");

/** The question `raw` asks, or null. The words keep their case as typed: a state code that is also a word ("IN", "OR")
 *  is a place only in capitals, as event searches read it. */
export function readBiggestEvents(raw: string): BiggestEventsQuestion | null {
  let q = ` ${raw.replace(/[?!.,]/g, " ").replace(/(\d)\+/g, "$1 or more")} `.replace(/\s+/g, " ");
  // "Events in Texas with more than 40 teams": the events over a size, biggest first.
  const floor = FLOOR.exec(q);
  let min: BiggestEventsQuestion["min"];
  if (floor) {
    const at = Number(floor[2] ?? floor[3]);
    const more = /^(?:more|over)/i.test(floor[1] ?? "");
    min = { teams: more ? at + 1 : at, said: floor[3] ? `${at} or more teams` : `${more ? "more than" : "at least"} ${at} teams` };
    q = q.replace(floor[0], " ");
  }
  const m = floor ? null : ASKED.exec(q);
  const k = floor ? KIND_WORD.exec(q) : null;
  if (!m && !k) return null;
  // The kind of event said inside the ask ("which qualifier had the most teams") stays to be read with the rest.
  const kind = (m ? (m[1] ?? m[2] ?? m[3]) : k![1]).toLowerCase();
  if (m) q = q.replace(m[0], ` ${kind} `);
  // "Top 3 biggest events": how many, taken out before the place and season are read.
  const said = COUNT.exec(q);
  const n = said ? Math.min(25, Math.max(1, Number(said[1]))) : min ? 25 : 10;
  if (said) q = q.replace(said[0], " ");
  const thisSeason = THIS_SEASON.test(q);
  // "Ever", "of all time": every season, never only the default one.
  const everRe = /\b(?:ever|of\s+all[\s-]+time|all[\s-]+time|in\s+(?:ftc\s+)?history)\b/i;
  const ever = everRe.test(q);
  q = q.replace(THIS_SEASON, " ").replace(everRe, " ").replace(/\b(?:the|in|of|so\s+far)\b\s*$/i, " ").replace(/\s+/g, " ").trim();
  // The kind alone ("the biggest event"): every event of the season.
  const bare = /^(?:the\s+)?(?:events?|competitions?|tournaments?|qualifiers?|meets?|championships?)$/i.test(q);
  const e = bare ? { kinds: [kind.replace(/s$/, "")], time: null, year: null, season: null, region: null, where: null, words: [] } : readEventQuery(q);
  // Every word has to be read as the place, season or kind: a name left over is a search for that event.
  if (!e || e.words.length || e.where || e.time) return null;
  if (ever && (e.season != null || e.year != null || thisSeason)) return null;
  return { e: { ...e, ...(thisSeason && e.season == null && e.year == null ? { season: CURRENT_SEASON } : {}), ...(ever ? { allSeasons: true } : {}) }, n, ...(min ? { min } : {}) };
}

/** The answer, worked out from each event's team list. */
export async function biggestEventsAnswer(b: BiggestEventsQuestion, defaultSeason: number): Promise<StatAnswer> {
  const { e } = b;
  const season = e.season ?? (e.year != null || e.allSeasons ? null : defaultSeason);
  const types = eventTypesOf(e.kinds);
  const sql: string[] = [], args: (string | number)[] = [];
  if (season != null) { sql.push("p.season = ?"); args.push(season); }
  // A calendar year: events held that year, from both seasons it touches.
  if (e.year != null) { sql.push("substr(p.start, 1, 4) = ?"); args.push(String(e.year)); }
  if (e.region) { sql.push("p.country = ?"); args.push(e.region.country); if (e.region.state) { sql.push("p.state = ?"); args.push(e.region.state); } }
  if (types) { sql.push(`p.type IN (${types.map(() => "?").join(", ")})`); args.push(...types); }
  // An event and its divisions are one: the parent (division_code null) with every division's teams counted.
  const rows = await all<{ season: number; code: string; name: string; type: string | null; start: string | null; end: string | null; city: string | null; teams: number }>(
    `SELECT p.season, p.code, p.name, p.type, p.start, p.end, p.city, COUNT(DISTINCT et.team) teams
     FROM events p JOIN events d ON d.season = p.season AND (d.code = p.code OR d.division_code = p.code)
     JOIN event_teams et ON et.season = d.season AND et.code = d.code
     WHERE p.division_code IS NULL${sql.length ? ` AND ${sql.join(" AND ")}` : ""}
     GROUP BY p.season, p.code${b.min ? " HAVING teams >= ?" : ""} ORDER BY teams DESC, p.start, p.code LIMIT ?`, [...args, ...(b.min ? [b.min.teams] : []), b.n]);
  const where = e.region ? ` in ${e.region.name}` : "";
  const when = season != null ? seasonLabel(season) : e.allSeasons ? "every season" : `held in ${e.year}`;
  const what = types ? (e.kinds[0] ?? "event").replace(/s$/, "") : "event";
  const plural = `${what}s`;
  const title = `${plural.replace(/^./, (c) => c.toUpperCase())} with ${b.min ? b.min.said : "the most teams"}${where}, ${when}`;
  const base = {
    family: "superlative" as const, intent: "biggest-events", title,
    scope: [e.region?.name ?? "Worldwide", season != null ? seasonLabel(season) : e.allSeasons ? "All seasons" : String(e.year), ...(types ? [plural.replace(/^./, (c) => c.toUpperCase())] : [])],
    definition: "An event's size is the number of teams on its team list, an event with divisions counted once with every division's teams together.",
    source: `From the team lists of the ${plural}${where}, ${when}`,
  };
  const span = season != null ? `in ${when}` : when;
  if (!rows.length) return { ...base, blocks: [], none: b.min ? `No ${what}${where} ${span} lists ${b.min.said}.` : `No ${what}${where} ${span} has a team list yet.` };
  const top = rows[0];
  // Over a size, the answer is how many events are: every one counted, the biggest listed.
  let over = 0;
  if (b.min) {
    const c = await all<{ n: number }>(
      `SELECT COUNT(*) n FROM (SELECT p.code FROM events p JOIN events d ON d.season = p.season AND (d.code = p.code OR d.division_code = p.code)
       JOIN event_teams et ON et.season = d.season AND et.code = d.code
       WHERE p.division_code IS NULL${sql.length ? ` AND ${sql.join(" AND ")}` : ""}
       GROUP BY p.season, p.code HAVING COUNT(DISTINCT et.team) >= ?)`, [...args, b.min.teams]);
    over = Number(c[0]?.n ?? rows.length);
  }
  return {
    ...base,
    headline: b.min
      ? { value: `${over} ${over === 1 ? what : plural}`, label: `with ${b.min.said}${where}${over > rows.length ? ` · the biggest ${rows.length} listed` : ""}`, sub: `Biggest: ${top.name}, ${top.teams} teams` }
      : { value: top.name, label: `${top.teams} teams`, sub: [dateRange(top.start, top.end), top.city].filter(Boolean).join(" · "), href: eventHref(Number(top.season), top.code), type: top.type },
    blocks: [{
      kind: "table", title: `By teams on the list${where}`,
      columns: [{ key: "event", label: "Event" }, { key: "date", label: "Date" }, { key: "teams", label: "Teams", num: true }],
      rows: rows.map((r, i) => ({ cells: { event: r.name, date: dateRange(r.start, r.end) ?? "", teams: Number(r.teams) }, href: eventHref(Number(r.season), r.code), strong: i === 0 })),
    }],
  };
}
