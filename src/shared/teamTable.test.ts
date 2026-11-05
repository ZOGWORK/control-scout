// A search answer's team table (./teamTable.ts): its sorts and a stat leaderboard read as the same table.
import { describe, expect, it } from "vitest";
import { TEAM_COLUMNS, firstDir, hasPhases, sortTeamRows, teamColumns, teamTableOfLeaderboard, type TeamTableRow } from "./teamTable";

const row = (rank: number, team: number, opr: number | null, auto: number | null, w: number, l: number, t = 0, pen: number | null = 5): TeamTableRow => ({
  rank, team, name: `Team ${team}`, location: null, href: `/teams/${team}`, opr, auto, dc: opr == null ? null : opr / 2, endgame: 10, pen, wins: w, losses: l, ties: t,
});
// As the server lists them: by OPR, best first.
const ROWS = [row(1, 100, 150, 20, 8, 2), row(2, 200, 120, 40, 10, 0), row(3, 300, 90, 30, 4, 4, 2, 1), row(4, 400, null, null, 9, 1)];
const order = (rows: TeamTableRow[]) => rows.map((r) => r.team);

describe("sortTeamRows", () => {
  it("opens on OPR, best first, a team without one last", () => {
    expect(firstDir("opr")).toBe("desc");
    expect(order(sortTeamRows(ROWS, "opr"))).toEqual([100, 200, 300, 400]);
    // The other way round still keeps the missing number last.
    expect(order(sortTeamRows(ROWS, "opr", "asc"))).toEqual([300, 200, 100, 400]);
  });
  it("re-sorts by a phase OPR", () => {
    expect(order(sortTeamRows(ROWS, "auto"))).toEqual([200, 300, 100, 400]);
    // Penalties given away: fewest first.
    expect(firstDir("pen")).toBe("asc");
    expect(order(sortTeamRows(ROWS, "pen"))).toEqual([300, 100, 200, 400]);
  });
  it("re-sorts by record: win share (a tie counts half), then most wins", () => {
    // 200: 10-0-0 (100%); 400: 9-1-0 (90%); 100: 8-2-0 (80%); 300: 4-4-2 (50%).
    expect(order(sortTeamRows(ROWS, "record"))).toEqual([200, 400, 100, 300]);
    const same = [row(1, 1, 10, 1, 4, 1), row(2, 2, 9, 1, 8, 2)];
    expect(order(sortTeamRows(same, "record"))).toEqual([2, 1]); // both 80%: more wins first
  });
  it("back to the list's own order by rank, never changing the rows", () => {
    const sorted = sortTeamRows(ROWS, "auto");
    expect(order(sortTeamRows(sorted, "rank"))).toEqual([100, 200, 300, 400]);
    expect(order(ROWS)).toEqual([100, 200, 300, 400]);
  });
});

describe("the columns", () => {
  it("every definition fits on one line", () => {
    for (const c of [...TEAM_COLUMNS, ...teamColumns(true)]) expect(c.def.length, c.key).toBeLessThanOrEqual(90);
    // A season whose TeleOp includes the endgame names the column TeleOp, never DC.
    expect(teamColumns(true).find((c) => c.key === "dc")?.label).toBe("TeleOp");
  });
  it("hasPhases: a season with no phase numbers draws no phase columns", () => {
    expect(hasPhases(ROWS)).toBe(true);
    expect(hasPhases([{ ...ROWS[0], auto: null, dc: null, endgame: null, pen: null }])).toBe(false);
  });
});

describe("teamTableOfLeaderboard", () => {
  const lb = (statId: string) => teamTableOfLeaderboard(statId, statId === "win-rate" ? "Win rate" : "OPR", [
    { rank: 1, team: { label: "23268 Ultraviolet", href: "/teams/23268?season=2025" }, location: "Hackettstown, NJ", record: "33-17-1", opr: 157.9, value: 0.65, display: "65%", parts: { auto: 30, teleop: 90, endgame: 20, pen: 4 } },
  ]);
  it("an OPR list opens on OPR; its phases and penalties are the row's", () => {
    const t = lb("opr");
    expect(t.by).toBe("opr");
    expect(t.asked).toBeUndefined();
    expect(t.rows[0]).toMatchObject({ team: 23268, name: "Ultraviolet", opr: 157.9, auto: 30, dc: 90, endgame: 20, pen: 4, wins: 33, losses: 17, ties: 1 });
  });
  it("a phase list opens on that phase; any other stat is its own column, in the list's order", () => {
    expect(teamTableOfLeaderboard("teleop", "TeleOp OPR", []).by).toBe("dc");
    const t = lb("win-rate");
    expect(t).toMatchObject({ by: "rank", asked: { label: "Win rate" } });
    expect(t.rows[0].asked).toEqual({ value: 0.65, display: "65%" });
  });
  it("a lowest-first list opens lowest first on its own column, never a second copy of it", () => {
    const t = teamTableOfLeaderboard("teleop", "TeleOp OPR", [], false, true);
    expect(t).toMatchObject({ by: "dc", dir: "asc" });
    expect(t.asked).toBeUndefined();
    // By its place, counted from the top: the lowest has the largest, so the places run down.
    expect(teamTableOfLeaderboard("win-rate", "Win rate", [], false, true)).toMatchObject({ by: "rank", dir: "desc" });
    expect(teamTableOfLeaderboard("win-rate", "Win rate", []).dir).toBeUndefined();
  });
});
