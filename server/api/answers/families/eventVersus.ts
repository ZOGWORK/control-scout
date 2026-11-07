// Two to four events side by side ("<event> vs <event>"): how strong each field was (its teams' average OPR there),
// its best OPR, its high score and how many teams played. Each event by name, its newest season with a played match
// unless a season is named; its divisions count as the event.
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { VERSUS } from "../../../../src/shared/search.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { all, get } from "../../../db.js";
import { eventHref, teamHref } from "../matchSet.js";

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

/** Each side's event, by `find`; null when one isn't found. The same event twice is one. */
export async function eventsNamed(sides: string[], season: number | null, find: FindEvent): Promise<EventRow[] | null> {
  const evs: EventRow[] = [];
  for (const w of sides) {
    // A state's code in the name ("NJ Championship"), as events are named: its full name ("New Jersey Championship").
    const spelled = w.split(" ").map((x) => (x.length === 2 ? regionOf([x])?.name ?? x : x)).join(" ");
    const e = (await find(w, season)) ?? (spelled !== w ? await find(spelled, season) : null);
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
  const m = await get<{ high: number | null; n: number }>(`SELECT MAX(MAX(COALESCE(m.red_np, m.red_total), COALESCE(m.blue_np, m.blue_total))) high, COUNT(*) n
    FROM matches m JOIN events x ON x.season = m.season AND x.code = m.code WHERE ${scope.replace("s.season", "m.season")} AND m.played = 1`, args);
  return {
    teams: teams.length,
    field: rated.length ? rated.reduce((n, t) => n + Number(t.opr), 0) / rated.length : null,
    top: rated.length ? Number(rated[0].opr) : null, topTeam: rated.length ? Number(rated[0].team) : null,
    high: m?.high == null ? null : Number(m.high), matches: Number(m?.n ?? 0),
  };
}

const one = (x: number | null) => (x == null ? "—" : x.toFixed(1));

export async function eventVersusAnswer(evs: EventRow[]): Promise<StatAnswer> {
  const facts = await Promise.all(evs.map(factsOf));
  const seasons = new Set(evs.map((e) => e.season));
  const scope = evs.map((e) => `${e.name}, ${seasonLabel(e.season)}`);
  const played = facts.filter((f) => f.matches > 0).length;
  // The strongest field: the highest average OPR (points it adds per match, penalties left out).
  const order = evs.map((_, i) => i).filter((i) => facts[i].field != null).sort((a, b) => facts[b].field! - facts[a].field!);
  const lead = order.length >= 2 && facts[order[0]].field !== facts[order[1]].field ? order[0] : null;
  const definition = "Field strength is the average OPR (penalties left out) of the teams that played the event, its divisions' too; top OPR is its best team's, high score an alliance's best score without penalties."
    + (seasons.size > 1 ? " These events are from different seasons, each its own game: their points aren't the same scale." : "");
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
