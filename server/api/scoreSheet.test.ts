// A match's full score sheet (FIRST's /scores breakdown, row by row): only the season sheet's numbers are kept,
// written with the match, and served in its details; a season with no sheet, or a totals-only match, has none.
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, setDb, writeBatch } from "../db";
import { scoreDetail, splitFirstScore } from "../data/seasons";
import { bundleStatements, type EventBundle, type MatchRow } from "../data/bundle";
import { matchDetail, sheetOf } from "./matches";

// One BIOBUZZ alliance as FIRST's Events API returned it (USNVLVS Q1, blue; the flower arrays trimmed).
const blue = {
  alliance: "Blue", team: 0, autoHiveTips: 0, autoRobot1Leave: true, autoRobot2Leave: true, autoRobot1Park: false, autoRobot2Park: true,
  autoLeavePoints: 6, autoParkPoints: 5, autoHivePoints: 0, teleopHiveTips: 0, teleopHivePollenNectar: 0, scoringFlower: ["POLLEN"],
  teleopGardenPollenNectar: 0, teleopRobot1Park: false, teleopRobot2Park: false, teleopHivePoints: 0, teleopFlowerPoints: 0,
  teleopGardenPoints: 0, teleopParkPoints: 0, autoPoints: 11, teleopPoints: 0, foulPointsCommitted: 0, preFoulTotal: 11,
  swarmRP: false, pollinator1RP: false, pollinator2RP: false, totalPoints: 11, majorFouls: 0, minorFouls: 0,
};
const red = { ...blue, alliance: "Red", autoHivePoints: 12, autoPoints: 23, teleopHivePoints: 16, teleopFlowerPoints: 4, teleopGardenPoints: 3, teleopParkPoints: 10, teleopPoints: 33, majorFouls: 1, foulPointsCommitted: 15, totalPoints: 56 };

describe("score sheet", () => {
  it("keeps only the numbers its season's sheet shows (no robot flags, no flower arrays)", () => {
    const d = scoreDetail(2026, red)!;
    expect(d).toEqual({ autoPoints: 23, autoLeavePoints: 6, autoParkPoints: 5, autoHivePoints: 12, teleopPoints: 33, teleopHivePoints: 16,
      teleopFlowerPoints: 4, teleopGardenPoints: 3, teleopParkPoints: 10, foulPointsCommitted: 15, majorFouls: 1, minorFouls: 0 });
  });

  it("a season with no sheet keeps none", () => {
    expect(scoreDetail(2025, red)).toBeNull();
    expect(sheetOf(2025, "{}", "{}")).toBeNull();
  });

  it("rows in sheet order, groups then their parts, foul tallies marked as counts", () => {
    const rows = sheetOf(2026, JSON.stringify(scoreDetail(2026, red)), JSON.stringify(scoreDetail(2026, blue)))!;
    expect(rows.map((r) => `${r.depth ? "  " : ""}${r.label} ${r.red}-${r.blue}`)).toEqual([
      "Auto 23-11", "  Leave 6-6", "  Park 5-5", "  Hive 12-0",
      "TeleOp 33-0", "  Hive 16-0", "  Flower 4-0", "  Garden 3-0", "  Park 10-0",
      "Fouls given away 15-0", "  Major fouls 1-0", "  Minor fouls 0-0",
    ]);
    expect(rows.filter((r) => r.count).map((r) => r.label)).toEqual(["Major fouls", "Minor fouls"]);
  });
});

describe("stored with the match, served in its details", () => {
  const S = 2026;
  const team = (n: number) => ({ team: n, station: null, surrogate: false, dq: false, onField: true });
  const row = (number: number, o: Partial<MatchRow> = {}): MatchRow => ({
    level: "qual", series: 0, number, label: `Q${number}`, description: null, time: `2026-11-07T09:0${number}:00`, played: true,
    red: [team(1), team(2)], blue: [team(3), team(4)], redScore: splitFirstScore(S, red, blue), blueScore: splitFirstScore(S, blue, red),
    redDetail: scoreDetail(S, red), blueDetail: scoreDetail(S, blue), ...o,
  });
  const bundle = (matches: MatchRow[]): EventBundle => ({
    event: { season: S, code: "EV", name: "EV", type: "Qualifier", divisionCode: null, region: null, league: null, venue: null, city: null, state: null, country: null,
      start: "2026-11-07", end: "2026-11-07", timezone: null, remote: false, hybrid: false, website: null, livestream: null, source: "first", upstreamUpdated: null },
    teams: [],
    detail: { entries: [], matches, alliances: [], awards: [], advancement: undefined },
  });

  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    // Q1 with its sheet; Q2 totals only (FTC Scout, or FIRST before the breakdown posts); Q3 not played yet.
    await writeBatch(bundleStatements(bundle([row(1), row(2, { redDetail: null, blueDetail: null, breakdown: false }), row(3, { played: false, redScore: null, blueScore: null })])));
  });

  it("a played match with its sheet serves it", async () => {
    const d = (await matchDetail(S, "EV", "qual:0:1"))!;
    expect(d.sheet?.[0]).toEqual({ label: "Auto", depth: 0, red: 23, blue: 11 });
    expect(d.sheet).toHaveLength(12);
  });

  it("a totals-only or unplayed match has none (the details fall back to the engine's split)", async () => {
    expect((await matchDetail(S, "EV", "qual:0:2"))!.sheet).toBeNull();
    expect((await matchDetail(S, "EV", "qual:0:3"))!.sheet).toBeNull();
    expect((await all<any>("SELECT red_detail FROM matches WHERE number = 3"))[0].red_detail).toBeNull();
  });
});
