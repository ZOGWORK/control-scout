// The card for a season or a year with no events on record yet (a future one: "12345 opr 2027"): it says so, and offers
// the question without the year, never another season's numbers as if they were that year's. One card for every
// reader that meets such a year (the query pipeline, ../query/execute.ts, and the stat readers, ./index.ts).
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { get } from "../../db.js";

/** The newest season with events stored. */
export async function latestStoredSeason(): Promise<number> {
  return Number((await get<{ s: number | null }>("SELECT MAX(season) s FROM events"))?.s ?? NaN);
}

/** `q` without the year typed: the latest season's question. */
export const withoutYear = (q: string, typed: string) =>
  q.replace(new RegExp(`\\b${typed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ").replace(/\s+/g, " ").trim();

export function noEventsStat(o: { intent: string; team: { number: number; name: string | null }; what: string; scope: string; latestQ: string; latest: number }): StatAnswer {
  const who = `${o.team.name ?? `Team ${o.team.number}`} (${o.team.number})`;
  return {
    family: "event", intent: o.intent, title: `No ${o.what} yet`, team: o.team, scope: [o.scope],
    blocks: [{ kind: "related", title: "The latest on record instead", queries: [o.latestQ] }],
    definition: "A season's events are listed once FIRST publishes them; a year with none yet has nothing to answer from, so its answer is never the latest season's.",
    source: `Seasons on record: up to ${seasonLabel(o.latest)}`,
    none: `There are no ${o.what} on record yet, so ${who} has nothing there to show. Ask without the year for the latest.`,
  };
}
