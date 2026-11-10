// The rows stored before src/shared/placeClean.ts tidied what is written (and past seasons, which no sync writes
// again): each team's school and town and each event's town, cleaned the same way, only the rows it changes. Run once
// soon after the server starts (server/index.ts); a second run finds nothing to change.
import { all, db } from "../db.js";
import { cleanCity, cleanSchool } from "../../src/shared/placeClean.js";

interface TeamRow { number: number; school: string | null; city: string | null; state: string | null; country: string | null }
interface EventRow { season: number; code: string; city: string | null; state: string | null; country: string | null }

/** Clean the stored places; how many team and event rows changed. */
export async function tidyStoredPlaces(): Promise<{ teams: number; events: number }> {
  const teams = (await all<TeamRow>("SELECT number, school, city, state, country FROM teams WHERE school IS NOT NULL OR city IS NOT NULL"))
    .map((t) => ({ t, school: cleanSchool(t.school), city: cleanCity(t.city, t.state, t.country) }))
    .filter((x) => x.school !== x.t.school || x.city !== x.t.city);
  const events = (await all<EventRow>("SELECT season, code, city, state, country FROM events WHERE city IS NOT NULL"))
    .map((e) => ({ e, city: cleanCity(e.city, e.state, e.country) }))
    .filter((x) => x.city !== x.e.city);
  const writes = [
    ...teams.map(({ t, school, city }) => ({ sql: "UPDATE teams SET school = ?, city = ? WHERE number = ?", args: [school, city, t.number] })),
    ...events.map(({ e, city }) => ({ sql: "UPDATE events SET city = ? WHERE season = ? AND code = ?", args: [city, e.season, e.code] })),
  ];
  for (let i = 0; i < writes.length; i += 500) await db().batch(writes.slice(i, i + 500), "write");
  return { teams: teams.length, events: events.length };
}
