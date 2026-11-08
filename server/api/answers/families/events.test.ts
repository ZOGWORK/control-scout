// A team's first or latest event asked for its rank ("12345 latest event ranking"): the rank leads, never the OPR; a
// league meet ranks no one on its own (its rank is the league's running standing), so the nearest ranked event is the
// answer and the meet is named as skipped.
import { describe, expect, it } from "vitest";
import type { TeamEvent } from "../eventSet";
import { readStatQuestion } from "../read";
import { eventAnswer } from "./events";

const ev = (code: string, start: string, type: string, rank: number | null, of: number | null, opr: number): TeamEvent => ({
  season: start < "2026-09-01" ? 2025 : 2026, code, name: `${code} Event`, type, start, end: start, city: "Town", state: "NJ", country: "USA", division: null,
  rank, of, opr, auto: null, teleop: null, endgame: null, matches: 5, avgScore: null, avgPen: null, wins: 3, losses: 2, ties: 0, rp: null,
  record: { wins: 3, losses: 2, ties: 0 },
});
const team = { number: 30001, name: "Test Team" };
const set = (events: TeamEvent[]) => ({ events, seasons: [] });

describe("an event's rank asked", () => {
  it("reads rank words as the rank of that event, and keeps the team", () => {
    for (const q of ["30001 latest event ranking", "30001 last event rank", "30001 most recent event standing"]) {
      expect(readStatQuestion(q), q).toMatchObject({ id: "last-event", rank: true, core: "30001" });
    }
    expect(readStatQuestion("30001 first event rank")).toMatchObject({ id: "first-event", rank: true, core: "30001" });
    expect(readStatQuestion("30001 latest event")).not.toHaveProperty("rank");
  });

  it("leads with the rank at the latest event", () => {
    const a = eventAnswer("last-event", team, set([ev("A", "2025-12-01", "Qualifier", 9, 30, 50), ev("B", "2026-02-01", "Qualifier", 4, 24, 60)]), { season: null }, { rank: true })!;
    expect(a.title).toBe("Latest event rank");
    expect(a.headline).toMatchObject({ value: "#4 of 24", label: "B Event" });
    expect(a.headline!.sub).not.toMatch(/no rank/);
  });

  it("skips a league meet, which has no rank of its own, and says so", () => {
    const a = eventAnswer("last-event", team, set([ev("A", "2026-02-01", "LeagueTournament", 14, 17, 42), ev("M", "2026-11-07", "LeagueMeet", null, null, 44)]), { season: null }, { rank: true })!;
    expect(a.headline).toMatchObject({ value: "#14 of 17", label: "A Event" });
    expect(a.headline!.sub).toMatch(/^M Event \(.+\) has no rank of its own: a league meet's rank is the league's running standing\. Latest ranked event/);
    // The table still lists the latest events, the meet first.
    const rows = (a.blocks[0] as { rows: { cells: Record<string, string> }[] }).rows;
    expect(rows[0].cells.event).toBe("M Event");
  });

  it("a first event's skip names the first ranked event", () => {
    const a = eventAnswer("first-event", team, set([ev("M", "2025-11-07", "LeagueMeet", null, null, 44), ev("A", "2026-02-01", "LeagueTournament", 14, 17, 42)]), { season: null }, { rank: true })!;
    expect(a.headline).toMatchObject({ value: "#14 of 17", label: "A Event" });
    expect(a.headline!.sub).toMatch(/has no rank of its own: a league meet's rank is the league's running standing\. First ranked event/);
  });

  it("says so when no event has a rank", () => {
    const a = eventAnswer("first-event", team, set([ev("M", "2026-11-07", "LeagueMeet", null, null, 44)]), { season: null }, { rank: true })!;
    expect(a.title).toBe("First event rank");
    expect(a.headline).toBeUndefined();
    expect(a.none).toMatch(/no qualification rank posted/);
  });
});
