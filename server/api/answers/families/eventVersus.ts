// Two to four events side by side ("<event> vs <event>"): how strong each field was (its teams' average OPR there),
// its best OPR, its high score and how many teams played. Each event by name, its newest season with a played match
// unless a season is named; its divisions count as the event.
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { VERSUS } from "../../../../src/shared/search.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { all, get } from "../../../db.js";
import { eventHref, teamHref } from "../matchSet.js";
import { LEXICON } from "../../query/lexicon.js";

/** The event as findEvent gives it. */
export type EventRow = { season: number; code: string; name: string; type: string | null; start: string | null; division: string | null };
export type FindEvent = (words: string, season: number | null) => Promise<EventRow | null>;

// A word only an event's name has ("Romania Championship", "Hudson Valley League Meet", "Super Qualifier").
const EVENT_WORD = /\b(?:championships?|qualifiers?|leagues?|meets?|tournaments?|interleague|premier|regionals?|scrimmages?|invitationals?|showcase|worlds|cmp)\b/i;

/** The sides of "<event> vs <event>", when every one (2 to 4) names an event by such a word; else null (teams'). */
export function readEventVersus(q: string): string[] | null {
  const sides = q.replace(/[?!]/g, " ").split(VERSUS).map((s) => s.replace(/^(?:(?:compare|the)\s+)+/i, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (sides.length < 2 || sides.length > 4) return null;
  // A team's number is a team, never an event.
  return sides.every((s) => EVENT_WORD.test(s) && !/\b\d{2,6}\b/.test(s.replace(/\b20\d\d\b/g, ""))) ? sides : null;
}

/** Each side's event, by `find`; null when one isn't found. The same event twice is one. `alias`: a side's short forms
 *  said in full, as search reads them ("Worlds" is the FIRST Championship). */
export async function eventsNamed(sides: string[], season: number | null, find: FindEvent, alias?: (w: string) => string): Promise<EventRow[] | null> {
  const evs: EventRow[] = [];
  for (const w of sides) {
    // A state's code in the name ("NJ Championship"), as events are named: its full name ("New Jersey Championship").
    const spelled = w.split(" ").map((x) => (x.length === 2 ? regionOf([x])?.name ?? x : x)).join(" ");
    let e: EventRow | null = null;
    // Said in full first: a short form ("Worlds" is the FIRST Championship, not an event with "worlds" in its name) and
    // a state spelled out ("NJ Championship" is New Jersey's, never an old division with "NJ0312" in its name); as typed
    // after.
    for (const words of [...new Set([...(alias ? [alias(spelled), alias(w)] : []), spelled, w])]) if ((e = await find(words, season))) break;
    if (!e) return null;
    if (!evs.some((x) => x.season === e.season && x.code === e.code)) evs.push(e);
  }
  return evs.length >= 2 ? evs : null;
}

export const eventVersusTitle = (evs: EventRow[]) => `Compare events: ${evs.map((e) => e.name).join(" vs ")}`;

type Facts = { teams: number; field: number | null; top: number | null; topTeam: number | null; high: number | null; matches: number };

/** One event's numbers, its divisions' rows included. */
async function factsOf(e: EventRow): Promise<Facts> {
  const scope = "s.season = ? AND (x.code = ? OR x.division_code = ?)";
  const args = [e.season, e.code, e.code];
  // A team in a division and the finals is one team: its best OPR there.
  const teams = await all<{ team: number; opr: number | null }>(`SELECT s.team, MAX(s.opr_np) opr FROM team_event_stats s JOIN events x ON x.season = s.season AND x.code = s.code
    WHERE ${scope} AND s.matches > 0 GROUP BY s.team`, args);
  const rated = teams.filter((t) => t.opr != null).sort((a, b) => Number(b.opr) - Number(a.opr) || a.team - b.team);
  const mScope = scope.replace("s.season", "m.season");
  // The high score is a score without penalties: a match with only its totals on record has none to offer.
  const m = await get<{ high: number | null; n: number }>(`SELECT MAX(MAX(COALESCE(m.red_np, m.blue_np), COALESCE(m.blue_np, m.red_np))) high, COUNT(*) n
    FROM matches m JOIN events x ON x.season = m.season AND x.code = m.code WHERE ${mScope} AND m.played = 1`, args);
  // Every team that played: on the field in a played match (a playoff-only or surrogate appearance, a remote event with
  // no stats rows) or with stats there.
  const played = await get<{ n: number }>(`SELECT COUNT(*) n FROM (
    SELECT t.team FROM match_teams t JOIN matches m ON m.season = t.season AND m.code = t.code AND m.level = t.level AND m.series = t.series AND m.number = t.number
      JOIN events x ON x.season = m.season AND x.code = m.code WHERE ${mScope} AND m.played = 1 AND t.on_field = 1
    UNION SELECT s.team FROM team_event_stats s JOIN events x ON x.season = s.season AND x.code = s.code WHERE ${scope} AND s.matches > 0)`, [...args, ...args]);
  return {
    teams: Number(played?.n ?? teams.length),
    field: rated.length ? rated.reduce((n, t) => n + Number(t.opr), 0) / rated.length : null,
    top: rated.length ? Number(rated[0].opr) : null, topTeam: rated.length ? Number(rated[0].team) : null,
    high: m?.high == null ? null : Number(m.high), matches: Number(m?.n ?? 0),
  };
}

const one = (x: number | null) => (x == null ? "—" : x.toFixed(1));

type Field = { rated: number; field: number | null; top: number | null; topTeam: number | null };
/** Each event's field from its teams' OPR rows alone (no match scan): a team counted once at its best OPR there, the
 *  event's divisions' rows too. One query for every event asked. */
async function fieldsOf(evs: EventRow[]): Promise<Field[]> {
  if (!evs.length) return [];
  const rows = await all<{ parent: string; team: number; opr: number }>(`SELECT x.parent, s.team, MAX(s.opr_np) opr FROM team_event_stats s
    JOIN (${evs.map(() => "SELECT ? parent, ? season, code FROM events WHERE season = ? AND (code = ? OR division_code = ?)").join(" UNION ALL ")}) x ON x.season = s.season AND x.code = s.code
    WHERE s.matches > 0 AND s.opr_np IS NOT NULL GROUP BY x.parent, s.team`, evs.flatMap((e) => [e.code, e.season, e.season, e.code, e.code]));
  return evs.map((e) => {
    const rated = rows.filter((r) => r.parent === e.code).sort((a, b) => Number(b.opr) - Number(a.opr) || a.team - b.team);
    return { rated: rated.length, field: rated.length ? rated.reduce((n, r) => n + Number(r.opr), 0) / rated.length : null, top: rated.length ? Number(rated[0].opr) : null, topTeam: rated.length ? Number(rated[0].team) : null };
  });
}

/** Every spelling search reads as OPR, and as a stat other than OPR (its lexicon: "auto", "end-game", "tele op",
 *  "penalties", "average score" …), hyphens read as spaces and each word with or without a plural "s" ("autos", the form a retry
 *  reads). "strength" is how hard a division is, never another stat here. */
const statWords = (vs: string[]) => LEXICON.filter((e) => e.syms.some((x) => x.k === "metric" && vs.includes(String(x.v))))
  .map((e) => e.words.join(" ").replace(/[-/]/g, " ")).filter((w) => w !== "strength");
const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrases = (ws: string[]) => new RegExp(`(?<![\\p{L}\\d])(?:${ws.map((w) => w.split(/\s+/).map((x) => `${escape(x)}s?`).join("\\s+")).join("|")})(?![\\p{L}\\d])`, "u");
const OPR_WORDS = phrases(statWords(["opr"]));
const OTHER_STAT = phrases(statWords(["auto", "teleop", "endgame", "penalty", "record", "winrate", "rating", "reliability", "score", "margin"]));
/** Whether `q` names a stat other than OPR, OPR's own names ("offensive power rating") and the words read as the
 *  question's place (`place` as typed: "DC" is Washington, never driver controlled) left out first. */
export function saysOtherThanOpr(q: string, place?: string | null): boolean {
  let t = q.toLowerCase();
  const typed = place?.toLowerCase().trim();
  if (typed) t = t.replace(new RegExp(`(?<![\\p{L}\\d])${escape(typed)}(?![\\p{L}\\d])`, "u"), " ");
  return OTHER_STAT.test(t.replace(/[-/]/g, " ").replace(new RegExp(OPR_WORDS.source, "gu"), " "));
}

/** Whether `q` asks which division of a championship was hardest or easiest ("which championship division was hardest
 *  this year, by average OPR"): "easiest" for the weakest first, else the strongest first; null when it isn't asked. */
export function readDivisionField(q: string): { easiest: boolean } | null {
  const t = q.toLowerCase();
  if (!/\bdivisions?\b/.test(t) || /\b\d{2,6}\b/.test(t.replace(/\b20\d\d(?:\s*[-–/]\s*\d\d)?\b/g, ""))) return null;
  if (/\b(?:easiest|weakest|softest|least competitive)\b/.test(t)) return { easiest: true };
  return /\b(?:hardest|toughest|strongest|most competitive|most stacked|stacked|deepest)\b/.test(t) ? { easiest: false } : null;
}

/** A championship's divisions side by side by field strength (each its teams' average OPR there), the strongest first,
 *  or the weakest when `easiest`. */
export async function divisionFieldAnswer(parent: EventRow, divisions: EventRow[], easiest: boolean): Promise<StatAnswer> {
  const facts = await fieldsOf(divisions);
  const order = divisions.map((_, i) => i).filter((i) => facts[i].field != null).sort((a, b) => (easiest ? facts[a].field! - facts[b].field! : facts[b].field! - facts[a].field!));
  const at = `${parent.name}, ${seasonLabel(parent.season)}`;
  const title = `${easiest ? "Easiest" : "Hardest"} division at ${parent.name}, ${seasonLabel(parent.season)}`;
  const base = {
    family: "event" as const, intent: "division-field", title, scope: [at, "By average OPR"],
    definition: "A division's field strength is the average OPR (penalties left out) of the teams that played in it: the higher, the harder. OPR is the points a team adds to its alliance per match.",
    source: `From ${facts.reduce((n, f) => n + f.rated, 0).toLocaleString("en-US")} teams' OPR in ${divisions.length} divisions`,
  };
  if (order.length < 2) return { ...base, blocks: [], none: `${at} has ${order.length ? "only one division" : "no division"} with OPR on record.` };
  const [first, second] = order;
  // A division by its own name ("Jackson Division"), the championship's said once in the title.
  const short = (d: EventRow) => d.name.startsWith(`${parent.name} - `) ? d.name.slice(parent.name.length + 3) : d.name;
  return {
    ...base,
    headline: {
      value: one(facts[first].field), label: `average OPR: ${short(divisions[first])} was the ${easiest ? "easiest" : "hardest"}`, href: eventHref(divisions[first].season, divisions[first].code), type: divisions[first].type,
      sub: `${Math.abs(facts[first].field! - facts[second].field!).toFixed(1)} ${easiest ? "below" : "above"} ${short(divisions[second])} (${one(facts[second].field)})`,
    },
    blocks: [{ kind: "table", title: "Every division", columns: [{ key: "rank", label: "#", num: true }, { key: "event", label: "Division" }, { key: "teams", label: "Teams", num: true }, { key: "field", label: "Avg OPR", num: true }, { key: "top", label: "Top OPR", num: true }],
      rows: order.map((i, k) => ({ cells: { rank: k + 1, event: short(divisions[i]), teams: facts[i].rated, field: one(facts[i].field), top: one(facts[i].top) }, href: eventHref(divisions[i].season, divisions[i].code), strong: k === 0, type: divisions[i].type })) }],
  };
}

/** One event's field ("the average OPR of teams at <event>"): its teams' average OPR there, its divisions' too when the
 *  event is the parent; a division named is that division alone. */
export async function eventFieldAnswer(e: EventRow): Promise<StatAnswer> {
  const [f] = await fieldsOf([e]);
  const at = `${e.name}, ${seasonLabel(e.season)}`;
  const base = {
    family: "event" as const, intent: "event-field", title: `Average OPR at ${e.name}, ${seasonLabel(e.season)}`, scope: [at],
    definition: "The field's average OPR: the mean of each team's OPR at the event (penalties left out), a team in a division and the finals counted once at its best. OPR is the points a team adds to its alliance per match.",
    source: `From ${f.rated.toLocaleString("en-US")} teams' OPR at ${e.name}`,
  };
  if (f.field == null) return { ...base, blocks: [], none: `No team has an OPR at ${at} on record yet.` };
  return {
    ...base,
    headline: {
      value: one(f.field), label: `average OPR of the ${f.rated} teams at ${e.name}`, href: eventHref(e.season, e.code), type: e.type,
      sub: f.top != null && f.topTeam != null ? `Top OPR ${one(f.top)} (team ${f.topTeam})` : undefined,
    },
    blocks: f.topTeam == null ? [] : [{ kind: "kpis", items: [{ label: `Top OPR at ${e.name}`, value: one(f.top), sub: `Team ${f.topTeam}`, href: teamHref(f.topTeam, e.season) }] }],
  };
}

export async function eventVersusAnswer(evs: EventRow[]): Promise<StatAnswer> {
  const facts = await Promise.all(evs.map(factsOf));
  const seasons = new Set(evs.map((e) => e.season));
  const scope = evs.map((e) => `${e.name}, ${seasonLabel(e.season)}`);
  const played = facts.filter((f) => f.matches > 0).length;
  // The strongest field: the highest average OPR (points it adds per match, penalties left out).
  const order = evs.map((_, i) => i).filter((i) => facts[i].field != null).sort((a, b) => facts[b].field! - facts[a].field!);
  // Events from different seasons play different games, scored on their own scales: side by side, no winner.
  const lead = seasons.size === 1 && order.length >= 2 && facts[order[0]].field !== facts[order[1]].field ? order[0] : null;
  const definition = "Field strength is the average OPR (penalties left out) of the teams that played the event, its divisions' too; top OPR is its best team's, high score an alliance's best score without penalties."
    + (seasons.size > 1 ? " These events are from different seasons, each its own game: their points aren't the same scale, so neither is called stronger." : "");
  return {
    family: "event", intent: "event-versus", title: eventVersusTitle(evs), scope, definition,
    source: `From ${facts.reduce((n, f) => n + f.matches, 0).toLocaleString("en-US")} played matches at ${evs.length} events`,
    ...(played < evs.length
      ? { none: `${evs.filter((_, i) => !facts[i].matches).map((e) => `${e.name}, ${seasonLabel(e.season)}`).join(" and ")} ha${evs.length - played > 1 ? "ve" : "s"} no played matches on record yet.` }
      : lead != null ? { headline: {
        value: `+${(facts[lead].field! - facts[order[1]].field!).toFixed(1)} OPR`,
        label: `${evs[lead].name} had the stronger field`,
        sub: order.map((i) => `${evs[i].name} ${one(facts[i].field)}`).join(" · "),
        href: eventHref(evs[lead].season, evs[lead].code), type: evs[lead].type,
      } } : {}),
    blocks: [
      // Short number columns, so a phone shows them all (each event's season is in the scope chips above).
      { kind: "table", title: "Side by side", columns: [{ key: "event", label: "Event" }, { key: "teams", label: "Teams", num: true }, { key: "field", label: "Avg OPR", num: true }, { key: "top", label: "Top OPR", num: true }, { key: "high", label: "High", num: true }],
        rows: evs.map((e, i) => ({ cells: { event: e.name, teams: facts[i].teams, field: one(facts[i].field), top: one(facts[i].top), high: facts[i].high }, href: eventHref(e.season, e.code), strong: lead === i, type: e.type })) },
      // Each event's best team, to open.
      { kind: "kpis", items: evs.flatMap((e, i) => facts[i].topTeam == null ? [] : [{ label: `Top OPR at ${e.name}`, value: one(facts[i].top), sub: `Team ${facts[i].topTeam}`, href: teamHref(facts[i].topTeam!, e.season) }]) },
    ],
  };
}
