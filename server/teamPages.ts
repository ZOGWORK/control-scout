// The shared team-page rule (src/shared/teamPages.ts) over the database: for code that holds team
// numbers without names (the stats job's ranks, the search index).
import { all } from "./db.js";
import { isTeamNumber, teamPageSql } from "../src/shared/teamPages.js";

/** A test of whether a team number has a public page, with the placeholder names read once. */
export async function teamPageTest(): Promise<(team: number) => boolean> {
  const hidden = new Set((await all<{ number: number }>(`SELECT number FROM teams WHERE NOT ${teamPageSql("number")}`)).map((r) => Number(r.number)));
  return (team) => isTeamNumber(team) && !hidden.has(team);
}
