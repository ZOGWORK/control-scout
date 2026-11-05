import { describe, expect, it } from "vitest";
import { matchRow, type TeamMatch } from "./matchSet";

const m = (season: number, over: Partial<TeamMatch> = {}) => ({
  season, code: "USNJCMP", level: "qual", series: 0, number: 1, label: "Q1", date: null, event: "NJ Championship", type: "Championship",
  country: "USA", state: "NJ", division: null, alliance: "red", own: 200, opp: 150, ownNp: 190, oppNp: 140, ownAuto: 40, ownTeleop: 110,
  ownEndgame: 30, ownPen: 10, oppPen: 0, counted: true, onField: true, result: "W", partners: [], opponents: [], ...over,
}) as TeamMatch;

describe("matchRow's phases", () => {
  it("TeleOp as FIRST reports it: with the endgame from 2024–25 on", () => {
    expect(matchRow(m(2024), new Map()).phases).toEqual({ auto: 40, teleop: 140, endgame: 30, pen: 10, teleopWithEndgame: true });
    expect(matchRow(m(2023), new Map()).phases).toEqual({ auto: 40, teleop: 110, endgame: 30, pen: 10 });
  });
  it("a missing split stays missing", () => {
    expect(matchRow(m(2024, { ownTeleop: null, ownEndgame: null }), new Map()).phases).toEqual({ auto: 40, teleop: null, endgame: null, pen: 10 });
    expect(matchRow(m(2024, { ownAuto: null, ownTeleop: null, ownEndgame: null }), new Map()).phases).toBeNull();
  });
});
