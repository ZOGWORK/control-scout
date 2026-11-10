// A search answer's list of teams as table rows (src/shared/teamTable.ts), from the row each list's query already
// reads: the stored season numbers (team_season_stats, the ones each team page shows), never worked out here.
import type { TeamTable, TeamTableRow } from "../../src/shared/teamTable.js";
import { reportedTeleopIncludesEndgame } from "../data/seasons.js";
import { place } from "../../src/shared/format.js";

/** The stored phase OPRs a list's query adds to its SELECT (team_season_stats as `s`): one query, no extra reads. */
export const PHASE_COLS = "s.opr_auto, s.opr_teleop, s.opr_endgame, s.opr_pen";
const num = (x: unknown) => (x == null ? null : Number(x));

/** A listed team's row: `r` is the query's row (team, name, city, state, country, opr_np, the PHASE_COLS, the record),
 *  `rank` its place in the list, `season` the one its link opens. */
export const tableRow = (r: any, rank: number, season: number, asked?: TeamTableRow["asked"]): TeamTableRow => ({
  rank, team: Number(r.team), name: (r.name ?? "").trim() || null, location: place(r.city, r.state, r.country && r.country !== "USA" ? r.country : null) || null,
  href: `/teams/${r.team}?season=${season}`, opr: num(r.opr_np), auto: num(r.opr_auto), dc: num(r.opr_teleop), endgame: num(r.opr_endgame), pen: num(r.opr_pen),
  wins: Number(r.wins ?? 0), losses: Number(r.losses ?? 0), ties: Number(r.ties ?? 0), ...(asked ? { asked } : {}),
});

/** A list's table, sorted first by `by` ("opr" for a list by OPR, "rank" for one in its own order): `rows` already
 *  made (with tableRow), or the query's rows. The season says whether its stored TeleOp OPR includes the endgame. */
export function tableOf(rows: any[], season: number, by: TeamTable["by"] = "opr", asked?: TeamTable["asked"], made = false): TeamTable {
  return {
    by, ...(asked ? { asked } : {}), ...(reportedTeleopIncludesEndgame(season) ? { teleopWithEndgame: true } : {}),
    rows: made ? rows : rows.map((r, i) => tableRow(r, i + 1, season)),
  };
}
