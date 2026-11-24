// /next's choice of match (bot/next.ts): the earliest event with an unplayed match the team is in, in schedule order.
import { describe, expect, it } from "vitest";
import type { EventDetail, MatchView } from "../src/shared/api.js";
import { aheadEvents, inEvent, nextPlaying } from "./next.js";

/** A match: qualification Q<number> unless told otherwise, with `red`/`blue` teams. */
const match = (number: number, teams: number[], opts: { played?: boolean; level?: "qual" | "playoff"; series?: number } = {}): MatchView =>
  ({
    key: `${opts.level ?? "qual"}-${number}`, number, series: opts.series ?? 1, level: opts.level ?? "qual", played: !!opts.played,
    red: { teams: teams.map((n) => ({ number: n, name: null, onField: true })) },
    blue: { teams: [{ number: 9999, name: null, onField: true }] },
  } as unknown as MatchView);

/** An event with a schedule: only what the choice reads. */
const event = (code: string, matches: MatchView[]) => ({ event: { code, name: `Event ${code}` }, matches } as unknown as EventDetail);

describe("/next's match", () => {
  it("keeps an event whose last evening is still being played at the venue", () => {
    // 00:30 UTC on the 25th is 19:30 on the 24th in New York: the event ending on the 24th is not over there yet.
    const now = Date.parse("2026-11-25T00:30:00Z");
    const tonight = { start: "2026-11-24", end: "2026-11-24", timezone: "America/New_York" };
    const lastWeek = { start: "2026-11-14", end: "2026-11-15", timezone: "America/New_York" };
    expect(aheadEvents([lastWeek, tonight], now)).toEqual([tonight]);
    expect(aheadEvents([tonight], Date.parse("2026-11-25T06:00:00Z"))).toEqual([]);
  });

  it("keeps an event with no date published yet, after the dated ones", () => {
    const dated = { start: "2026-11-24", end: "2026-11-24", timezone: null };
    const undated = { start: null, end: null, timezone: null };
    expect(aheadEvents([undated, dated], Date.parse("2026-11-24T12:00:00Z"))).toEqual([dated, undated]);
  });

  it("takes the first unplayed match the team is in, in schedule order", () => {
    const e = event("A", [match(2, [4215]), match(1, [4215]), match(3, [4215])]);
    expect(nextPlaying([e], 4215)?.match.number).toBe(1);
  });

  it("never answers with a match already played, or one the team isn't in", () => {
    const e = event("A", [match(1, [4215], { played: true }), match(2, [6980]), match(3, [4215])]);
    expect(nextPlaying([e], 4215)?.match.number).toBe(3);
  });

  it("counts the team as a playoff alliance's third robot", () => {
    const e = event("A", [match(1, [1111, 2222, 4215], { level: "playoff" })]);
    expect(nextPlaying([e], 4215)?.match.key).toBe("playoff-1");
  });

  it("tells a schedule that has the team from one that doesn't, even with everything played", () => {
    const played = event("A", [match(1, [4215], { played: true })]);
    expect(nextPlaying([played], 4215)).toBeNull();
    expect(inEvent(played, 4215)).toBe(true);
    expect(inEvent(event("B", [match(1, [6980])]), 4215)).toBe(false);
  });

  it("reads the events in the order it is given them, so the earliest one answers", () => {
    const first = event("A", [match(1, [6980])]);
    const second = event("B", [match(1, [4215])]);
    expect(nextPlaying([first, second], 4215)?.event.event.code).toBe("B");
    expect(nextPlaying([null, second], 4215)?.event.event.code).toBe("B");
  });

  it("says nothing rather than guessing when no schedule has the team", () => {
    expect(nextPlaying([event("A", []), event("B", [match(1, [6980], { played: true })])], 4215)).toBeNull();
    expect(nextPlaying([], 4215)).toBeNull();
  });
});
