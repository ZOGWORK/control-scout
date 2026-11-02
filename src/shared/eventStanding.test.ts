// An event page's Teams tab and the forecast's "Rank now" read FIRST's league standing at a league meet: 4215 and
// 6980 both showed 10-0-0 at 2025 USNJNOM3, where they went 5-1-0 and 2-4-0. They now show the meet's own.
import { describe, expect, it } from "vitest";
import { eventRoster, eventStanding, recordAddsUp } from "./eventStanding";

const meet = (rank: number, wins: number, losses: number) => ({ rank, rs: 1, tb: [], wins, losses, ties: 0, played: wins + losses });

describe("event standing", () => {
  it("a league meet shows the meet's own rank and record, not the league's", () => {
    expect(eventStanding({ rank: 12, wins: 10, losses: 0, ties: 0, meet: meet(2, 5, 1) })).toEqual({ rank: 2, wins: 5, losses: 1, ties: 0 });
    expect(eventStanding({ rank: 12, wins: 10, losses: 0, ties: 0, meet: null })).toEqual({ rank: null, wins: null, losses: null, ties: null });
  });

  it("any other event shows FIRST's", () => {
    expect(eventStanding({ rank: 3, wins: 4, losses: 1, ties: 0 })).toEqual({ rank: 3, wins: 4, losses: 1, ties: 0 });
  });

  it("a meet's roster is the teams with a counted match there; before one, the whole field", () => {
    const rows = [{ team: 1, meet: meet(1, 2, 0) }, { team: 2, meet: null }, { team: 3, meet: meet(2, 0, 2) }];
    expect(eventRoster(rows).map((r) => r.team)).toEqual([1, 3]);
    const before = [{ team: 1, meet: null }, { team: 2, meet: null }];
    expect(eventRoster(before).map((r) => r.team)).toEqual([1, 2]);
    const qualifier: { team: number; meet?: null }[] = [{ team: 1 }, { team: 2 }];
    expect(eventRoster(qualifier).map((r) => r.team)).toEqual([1, 2]);
  });

  it("a record adds up when W+L+T is the matches played", () => {
    expect(recordAddsUp(5, 1, 0, 6)).toBe(true);
    expect(recordAddsUp(10, 0, 0, 16)).toBe(false);
    expect(recordAddsUp(null, null, null, 6)).toBe(false);
  });
});
