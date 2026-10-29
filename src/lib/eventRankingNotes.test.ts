import { describe, expect, it } from "vitest";
import type { FieldRow } from "../shared/api";
import type { ProjectionRun } from "../shared/projections";
import { advOddsBasis, emptyColumns, oddsTabBasis, rankingCoverage, topSeed, unofficialNote } from "./eventRankingNotes";

const row = (team: number, rank: number | null, qualPlayed: number | null, meet?: FieldRow["meet"]): FieldRow =>
  ({ team, name: `T${team}`, city: null, state: null, rank, rp: null, wins: null, losses: null, ties: null, qualPlayed, opr: { np: null, auto: null, teleop: null, endgame: null, pen: null }, ...(meet !== undefined ? { meet } : {}) }) as unknown as FieldRow;
const meet = (rank: number, played = 5) => ({ rank, rs: 1, tb: [1], wins: 1, losses: 1, ties: 0, played });

describe("advOddsBasis", () => {
  it("names the stored projection with its runs and when it ran", () => {
    const run = { runs: 10_000, through: "Q24", computedAt: new Date(Date.now() - 5 * 60_000).toISOString() } as ProjectionRun;
    expect(advOddsBasis(run, null)).toBe("Adv. odds: the live projection, 10,000 simulated events after Match 24, run 5 min ago. The Odds tab shows the same projection.");
  });
  it("says the column is the pre-event forecast and why the Odds tab's figure differs", () => {
    const s = advOddsBasis(null, new Date(Date.now() - 2 * 3600_000).toISOString());
    expect(s).toMatch(/^Adv\. odds: the forecast as of the day before the event \(500 simulated events, ratings from earlier matches only\), recomputed with each stats update, last 2 h ago\. /);
    expect(s).toMatch(/"Now" re-simulates the event on demand \(2,000 simulated events\) with its results so far, so the two can differ/);
    expect(advOddsBasis(null, null)).toMatch(/recomputed with each stats update\. The Odds tab/);
  });
  it("gives the Odds tab the matching line", () => {
    expect(oddsTabBasis(true, "current")).toBe("The Rankings tab's Adv. odds column shows this same projection.");
    expect(oddsTabBasis(true, "pre-event")).toBe("The Rankings tab's Adv. odds column shows the live projection (\"Now\"), not this pre-event view.");
    expect(oddsTabBasis(false, "current")).toMatch(/day before the event \(500 simulated events, no hindsight\), so it can differ/);
    expect(oddsTabBasis(false, "pre-event")).toMatch(/this same kind of forecast, from its own 500 simulated events/);
  });
});

describe("rankingCoverage", () => {
  it("explains a league meet's ranking of its own teams", () => {
    const field = [row(1, 4, 5, meet(1)), row(2, 1, 10, meet(2)), row(3, 2, 10, null), row(4, 3, 0, null)];
    expect(rankingCoverage(field)).toBe("Ranked on this meet's matches alone: 2 of the league's 4 teams played here. The other 2 haven't played at this meet, so they aren't listed.");
  });
  it("counts teams that haven't played yet elsewhere", () => {
    expect(rankingCoverage([row(1, 1, 3), row(2, 2, 3), row(3, null, 0)])).toBe("2 of 3 teams have played a qualification match. The other 1 hasn't played yet, so it isn't listed.");
  });
  it("says nothing when every team (or nobody) has played", () => {
    expect(rankingCoverage([row(1, 1, 3), row(2, 2, 3)])).toBeNull();
    expect(rankingCoverage([row(1, null, 0), row(2, null, null)])).toBeNull();
  });
});

describe("topSeed", () => {
  it("uses this meet's #1 at a league meet, FIRST's #1 elsewhere", () => {
    const league = [row(10644, 1, 10, meet(2)), row(11193, 4, 5, meet(1))];
    expect(topSeed(league)).toMatchObject({ row: { team: 11193 }, label: "#1 at this meet" });
    expect(topSeed([row(5, 2, 3), row(6, 1, 3)])).toMatchObject({ row: { team: 6 }, label: "#1 seed" });
    expect(topSeed([row(5, null, 0)])).toBeNull();
  });
});

describe("unofficialNote", () => {
  it("labels a scrimmage without denying it stats: only the ratings leave it out", () => {
    expect(unofficialNote("Scrimmage", "Scrimmage")).toBe("No official record: a scrimmage is unofficial. Its ranking and stats below come from its own matches, but team ratings and predictions never learn from them.");
    expect(unofficialNote("Qualifier", "Qualifier")).toBeNull();
    expect(unofficialNote("LeagueMeet", "League Meet")).toBeNull();
    expect(unofficialNote(null, "")).toBeNull();
  });
});

describe("emptyColumns", () => {
  it("lists the columns with no value in any row", () => {
    const rows = [{ stats: { rank: 1, predictedWinPctAvg: null, advancementOdds: null } }, { stats: { rank: 2, predictedWinPctAvg: 50 } }];
    expect(emptyColumns(rows, ["rank", "predictedWinPctAvg", "advancementOdds"])).toEqual(["advancementOdds"]);
    expect(emptyColumns([], ["rank"])).toEqual([]);
  });
});
