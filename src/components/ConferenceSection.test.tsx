// The conference page's pieces, pure: which conference a link opens (by slug, by code, by the marked team), the sort
// (rows with no value last, then league order, never renumbered), and the movers by Scout rating among the
// conference's teams (climbers, fallers, newcomers; an unrated team in none of them).
import { describe, expect, it } from "vitest";
import { conferenceKey, conferenceMovers, pickConference, sortConferenceRows, sourceText, unknownConference } from "./ConferenceSection";
import type { Conference, ConferenceRow } from "../shared/conferences";

const row = (team: number, rank: number | null, leagueRank: number | null, rs: number | null, extra: Partial<ConferenceRow> = {}): ConferenceRow => ({
  team, name: `Team ${team}`, rank, leagueRank, wins: rs == null ? null : 10, losses: rs == null ? null : 0, ties: rs == null ? null : 0, rs, tbp: rs == null ? null : rs * 20,
  played: rs == null ? null : 16, meets: rs == null ? null : 3, rating: rs == null ? null : 100 - (rank ?? 50), opr: rs == null ? null : 10 + team / 1000, ...extra,
});

const EB: Conference = {
  season: 2025, code: "USNJNOLT2", name: "East Bergen Conference", slug: "east-bergen-conference", firstName: null,
  event: "East Bergen Conference Northern League Tournament", start: "2026-03-08", venue: null, city: null,
  status: "finished", teamsFrom: "field", registered: null, rs: { kind: "final", asOf: null, lastMeet: "2026-02-01" }, leagueOf: 48,
  rows: [row(6980, 1, 7, 4.0), row(23717, 2, 9, 3.9), row(15762, 3, 11, 3.9), row(4215, 4, 12, 3.8), row(18155, 5, 44, 0.7), row(30680, null, null, null)],
  winner: null, seasons: [],
};
const FN: Conference = { ...EB, code: "USNJNOLT", name: "Far North Conference", slug: "far-north-conference", rows: [row(14450, 1, 1, 5)] };

describe("conference page pieces", () => {
  it("opens the conference a link names, by slug or code, else the marked team's, else the latest with teams", () => {
    expect(pickConference([FN, EB], "far-north-conference", 4215)!.code).toBe("USNJNOLT");
    expect(pickConference([FN, EB], "usnjnolt", null)!.code).toBe("USNJNOLT");
    expect(pickConference([FN, EB], null, 4215)!.code).toBe("USNJNOLT2");
    expect(pickConference([EB, { ...FN, rows: [] }], null, null)!.code).toBe("USNJNOLT2");
    // A slug two conferences share is no one conference: its link names the code instead.
    const twin = { ...FN, code: "USNJNOLT9", slug: EB.slug };
    expect(unknownConference([FN, EB, twin], EB.slug)).toBe(true);
    expect(unknownConference([FN, EB, twin], "USNJNOLT9")).toBe(false);
    expect([conferenceKey([FN, EB, twin], twin), conferenceKey([FN, EB, twin], FN)]).toEqual(["USNJNOLT9", "far-north-conference"]);
  });

  it("sorts without renumbering, rows with no value last either way", () => {
    // Records by win share, a tie half: 5-0-0 above 12-4-0 above 5-0-5's equal .750 (league order between those).
    const recs = [row(1, 1, 1, 3, { wins: 12, losses: 4, ties: 0 }), row(2, 2, 2, 3, { wins: 5, losses: 0, ties: 5 }), row(3, 3, 3, 3, { wins: 5, losses: 0, ties: 0 })];
    expect(sortConferenceRows(recs, "record", "desc").map((r) => r.team)).toEqual([3, 1, 2]);
    expect(sortConferenceRows(EB.rows, "rs", "asc").map((r) => r.team)).toEqual([18155, 4215, 23717, 15762, 6980, 30680]);
    expect(sortConferenceRows(EB.rows, "rs", "desc").map((r) => r.team)).toEqual([6980, 23717, 15762, 4215, 18155, 30680]);
    const moved = [row(1, 1, 1, 3, { move: -2 }), row(2, 2, 2, 3, { move: "new" }), row(3, 3, 3, 3, { move: 4 })];
    expect(sortConferenceRows(moved, "move", "desc").map((r) => r.team)).toEqual([3, 1, 2]);
  });

  it("finds the movers by Scout rating among the conference's teams, an unrated team in none", () => {
    const c: Conference = { ...EB, moves: { week: "2026-03-02", baseline: "2026-02-23" }, rows: [
      row(6980, 1, 7, 4.0, { move: 2, ratingRank: 1, rating: 40 }), row(23717, 2, 9, 3.9, { move: -3, ratingRank: 4, rating: 30 }),
      row(15762, 3, 11, 3.9, { move: 1, ratingRank: 2, rating: 35 }), row(4215, 4, 12, 3.8, { move: 0, ratingRank: 3, rating: 33 }),
      row(18155, 5, 44, 0.7, { move: "new", ratingRank: 5, rating: 10 }), row(30680, null, null, null, { move: null, ratingRank: null, rating: null })] };
    const m = conferenceMovers(c);
    expect(m.climbers.map((r) => [r.team, r.move, r.rank])).toEqual([[6980, 2, 1], [15762, 1, 2]]);
    expect(m.fallers.map((r) => [r.team, r.move])).toEqual([[23717, -3]]);
    expect([m.newcomers.map((r) => r.team), m.newTotal]).toEqual([[18155], 1]);
  });

  it("pairs a mover's place with the rating of the same week, not today's", () => {
    // Read at the tournament's week: 6980 was 1st on 40; today's rating (12) would sit under a #1 it didn't earn.
    const c: Conference = { ...EB, moves: { week: "2026-03-02", baseline: "2026-02-23" }, rows: [
      row(6980, 1, 7, 4.0, { move: 2, ratingRank: 1, rating: 12, ratingThen: 40 }), row(23717, 2, 9, 3.9, { move: -2, ratingRank: 3, rating: 50, ratingThen: 30 })] };
    const m = conferenceMovers(c);
    expect([m.climbers[0].rating, m.fallers[0].rating]).toEqual([40, 30]);
  });

  it("says where the league numbers come from", () => {
    expect(sourceText(EB)).toBe("Final league RS — league meets ended Feb 1, 2026, before this tournament.");
    expect(sourceText({ ...EB, rs: { kind: "gone" } })).toContain("no longer available");
  });
});
