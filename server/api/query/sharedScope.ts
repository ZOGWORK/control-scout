// The event or season a query names beside a name several teams share ("green machine at worlds", "echo kites at the
// nj championship", "copper robotics opr 2024-25"), and which of those teams were at it (#2342). A team that was there
// is the one the question can be about: one alone is the team meant, several are the only ones asked about, none is
// said plainly. Read from the stored rosters and matches, the same for every name, event and season.
import type { Parsed } from "../../../src/shared/query/parse.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { all } from "../../db.js";
import { CHAMPIONSHIP_TYPE } from "../answers/clauses.js";
import { eventsNamed } from "./highlights.js";
import { fold } from "./names.js";
import { seasonOfDate } from "./time.js";
import { searchToday } from "../searchEvents.js";

export interface NamedScope {
  /** How the scope is said after "played" ("at Worlds", "at the New Jersey championship in 2024–25", "in 2024–25"). */
  label: string;
  /** The SQL over events `e` that keeps the scope's events, and its arguments. */
  sql: string;
  args: (string | number)[];
}

/** The scope `p` names that a team either played or didn't: Worlds, a state championship (in the place named), an
 *  event by its name, each in the season said; or a season alone. Null: none (or one this can't tell, such as a date
 *  window, every season, or an event read from a team's own events). */
export async function namedScope(p: Parsed, now?: number): Promise<NamedScope | null> {
  const t = p.time;
  const current = seasonOfDate(searchToday(now));
  const season = t?.kind === "season" ? (t.relative === "this" ? current : t.relative === "last" ? current - 1 : t.season) : null;
  if (t && t.kind !== "season") return null;
  if (t && season == null) return null;
  const sql: string[] = [];
  const args: (string | number)[] = [];
  let at = "";
  if (p.worlds) {
    sql.push("e.type = ?"); args.push(CHAMPIONSHIP_TYPE); at = "at Worlds";
  } else if (p.states) {
    sql.push("e.type = 'Championship'");
    const region = p.place && p.place.kind !== "city" ? p.place : null;
    if (region) { sql.push(region.state ? "e.country = ? AND e.state = ?" : "e.country = ?"); args.push(region.country, ...(region.state ? [region.state] : [])); }
    at = region ? `at the ${region.name} championship` : "at a state championship";
  } else if (p.event && !p.event.latest) {
    const evs = (await eventsNamed(p.event.words, null, season == null ? undefined : (e) => e.season === season)).sort((a, b) => b.season - a.season);
    if (!evs.length) return null;
    // An event and its divisions: a team plays a championship in one of them.
    sql.push(`(${evs.map(() => "(e.season = ? AND (e.code = ? OR e.division_code = ?))").join(" OR ")})`);
    args.push(...evs.flatMap((e) => [e.season, e.code, e.code]));
    at = `at ${evs[0].name}`;
  }
  if (season != null) { sql.push("e.season = ?"); args.push(season); }
  if (!sql.length) return null;
  return { label: [at, season != null ? `in ${seasonLabel(season)}` : ""].filter(Boolean).join(" "), sql: sql.join(" AND "), args };
}

/** Which of `teams` were at the scope's events: on an event's roster or in one of its matches. Null when no team at
 *  all is on record there (a Worlds with no roster yet, a season not begun): that says nothing about who played it. */
export async function playedIn(scope: NamedScope, teams: number[]): Promise<Set<number> | null> {
  const any = await all<{ x: number }>(
    `SELECT 1 x FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE ${scope.sql}
     UNION ALL SELECT 1 x FROM match_teams mt JOIN events e ON e.season = mt.season AND e.code = mt.code WHERE ${scope.sql} LIMIT 1`, [...scope.args, ...scope.args]);
  if (!any.length) return null;
  if (!teams.length) return new Set();
  const marks = teams.map(() => "?").join(", ");
  const rows = await all<{ team: number }>(
    `SELECT et.team FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE ${scope.sql} AND et.team IN (${marks})
     UNION SELECT mt.team FROM match_teams mt JOIN events e ON e.season = mt.season AND e.code = mt.code WHERE ${scope.sql} AND mt.team IN (${marks})`,
    [...scope.args, ...teams, ...scope.args, ...teams]);
  return new Set(rows.map((r) => Number(r.team)));
}

/** Other teams at the scope whose name holds the typed name as a run of its words, the last one perhaps longer ("green
 *  machine": Green Machines, Mean Green Machine), none of `except`: the teams a name none of its own teams fits may
 *  have meant. At most `max`, team number order. */
export async function similarIn(scope: NamedScope, typed: string, except: Set<number>, max = 3): Promise<{ number: number; name: string }[]> {
  const tw = fold(typed).split(" ").filter(Boolean);
  if (!tw.length) return [];
  const rows = await all<{ number: number; name: string | null }>(
    `SELECT DISTINCT t.number, t.name FROM teams t WHERE t.number IN (
       SELECT et.team FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE ${scope.sql}
       UNION SELECT mt.team FROM match_teams mt JOIN events e ON e.season = mt.season AND e.code = mt.code WHERE ${scope.sql})
     ORDER BY t.number`, [...scope.args, ...scope.args]);
  const holds = (name: string) => {
    const nw = fold(name).split(" ");
    for (let i = 0; i + tw.length <= nw.length; i++) {
      if (tw.every((w, j) => (j === tw.length - 1 ? nw[i + j].startsWith(w) : nw[i + j] === w))) return true;
    }
    return false;
  };
  return rows.filter((r) => r.name && !except.has(Number(r.number)) && holds(r.name)).slice(0, max).map((r) => ({ number: Number(r.number), name: r.name! }));
}
