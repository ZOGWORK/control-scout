import { describe, expect, it } from "vitest";
import type { EventDetail, FieldRow, MatchView } from "../shared/api";
import { displayModel, LATE_MS, progress, verdict, winners } from "./pitDisplay";
import { isBareRoute, pageModule, pageTitle } from "../shared/routes";

const T0 = Date.parse("2026-10-24T15:00:00Z");
const min = (n: number) => new Date(T0 + n * 60_000).toISOString();
const t = (n: number) => ({ number: n, surrogate: false, dq: false, onField: true });
const score = (x: number) => ({ total: x, np: x, auto: 0, teleop: 0, endgame: 0, pen: 0 });

function q(n: number, startMin: number | null, result?: [number, number], pRed = 0.6, level: "qual" | "playoff" = "qual"): MatchView {
  return {
    season: 2026, code: "X", key: `${level}:0:${n}`, level, series: 0, number: n, label: `${level === "qual" ? "Q" : "M"}${n}`, time: null,
    startsAt: startMin == null ? null : min(startMin), played: !!result,
    red: { teams: [t(n * 10 + 1), t(n * 10 + 2)], score: result ? score(result[0]) : null },
    blue: { teams: [t(n * 10 + 3), t(n * 10 + 4)], score: result ? score(result[1]) : null },
    video: null, prediction: { pRed, redMean: 100, blueMean: 90, tier: "moderate", kind: "live", predictedAt: null },
  };
}
const row = (team: number, rank: number | null): FieldRow => ({
  team, name: null, city: null, state: null, rank, rp: null, tbp: null, wins: 1, losses: 0, ties: 0, qualPlayed: 1,
  opr: { np: 50, auto: null, teleop: null, endgame: null, pen: null }, avgNp: null, rating: null,
});
function detail(matches: MatchView[], over: Partial<EventDetail["event"]> = {}, field: FieldRow[] = []): EventDetail {
  return {
    event: { season: 2026, code: "X", name: "Test", type: "Qualifier", typeLabel: "Qualifier", divisionCode: null, region: null, city: null, state: null, country: null, venue: null,
      start: "2026-10-24", end: "2026-10-24", remote: false, teams: 0, matchesPlayed: matches.filter((m) => m.played).length, matchesTotal: matches.length, status: "live",
      website: null, livestream: null, timezone: "UTC", source: "first", ...over },
    field, matches, alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null,
  } as EventDetail;
}

describe("displayModel", () => {
  const matches = () => [q(1, -20, [120, 80]), q(2, -10, [70, 90]), q(3, 3), q(4, 10), q(5, 17), q(6, 24)];

  it("between matches: the last result, the next three, and a countdown to the next start", () => {
    const m = displayModel(detail(matches()), T0);
    expect(m.now).toMatchObject({ kind: "result", match: { number: 2 } });
    expect(m.upNext.map((x) => x.number)).toEqual([3, 4, 5]);
    expect(m.countdown).toEqual({ match: expect.objectContaining({ number: 3 }), start: Date.parse(min(3)) });
    expect(m.progress).toBe("Qual 3 of 6");
  });

  it("once a match's start has passed with no result, it's up now and leaves Up next", () => {
    const m = displayModel(detail(matches()), T0 + 4 * 60_000);
    expect(m.now).toMatchObject({ kind: "on-field", match: { number: 3 } });
    expect(m.upNext.map((x) => x.number)).toEqual([4, 5, 6]);
    expect(m.countdown?.match.number).toBe(4);
  });

  it("behind schedule (a match well past its start), no timer: just what's up next", () => {
    const m = displayModel(detail(matches()), T0 + 3 * 60_000 + LATE_MS + 1);
    expect(m.countdown).toMatchObject({ match: { number: 4 }, start: null });
  });

  it("before the event: the first three and a countdown to the first match; no schedule says so", () => {
    const m = displayModel(detail([q(1, 30), q(2, 37), q(3, 44), q(4, 51)], { status: "upcoming" }), T0);
    expect(m.now).toBeNull();
    expect(m.upNext.map((x) => x.number)).toEqual([1, 2, 3]);
    expect(m.countdown?.start).toBe(Date.parse(min(30)));
    expect(displayModel(detail([], { status: "upcoming" }), T0)).toMatchObject({ noSchedule: true, now: null, countdown: null, upNext: [] });
  });

  it("a finished event: final rankings, the last match, no countdown", () => {
    const d = detail([q(1, -20, [120, 80]), q(2, -10, [70, 90])], { status: "finished" }, [row(5, 2), row(7, 1), row(9, null)]);
    const m = displayModel(d, T0);
    expect(m.rankings).toEqual({ final: true, rows: [expect.objectContaining({ team: 7 }), expect.objectContaining({ team: 5 })] });
    expect(m.now).toMatchObject({ kind: "result", match: { number: 2 } });
    expect(m.countdown).toBeNull();
  });

  it("a finished event with matches never reported: nothing up now or next, and it says why", () => {
    const m = displayModel(detail([q(1, -20, [120, 80]), q(2, -10)], { status: "finished" }), T0);
    expect(m).toMatchObject({ now: { kind: "result", match: { number: 1 } }, upNext: [], countdown: null, unreported: 1, progress: "Event finished" });
  });

  it("your next match is pinned when it isn't already first up; highlight only, the same data otherwise", () => {
    const plain = displayModel(detail(matches()), T0);
    const mine = displayModel(detail(matches()), T0, new Set([51]));
    expect(mine.mine?.number).toBe(5);
    expect({ ...mine, mine: null }).toEqual(plain);
    expect(displayModel(detail(matches()), T0, new Set([31])).mine).toBeNull(); // Q3 is already first in Up next
  });

  it("top 8 by rank only", () => {
    const field = Array.from({ length: 12 }, (_, i) => row(100 + i, 12 - i));
    expect(displayModel(detail([], {}, field), T0).rankings.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("rules", () => {
  it("progress: the qual up, then playoffs", () => {
    expect(progress([q(1, 0, [1, 2]), q(2, 1)], null)).toBe("Qual 2 of 2");
    expect(progress([q(1, 0, [1, 2]), q(1, 5, undefined, 0.5, "playoff")], null)).toBe("Playoffs");
    expect(progress([], null)).toBeNull();
  });

  it("verdict: called, upset, nothing for a tie or an even call", () => {
    expect(verdict(q(1, 0, [100, 50], 0.7))).toBe("called");
    expect(verdict(q(1, 0, [50, 100], 0.7))).toBe("upset");
    expect(verdict(q(1, 0, [50, 50], 0.7))).toBeNull();
    expect(verdict(q(1, 0, [100, 50], 0.5))).toBeNull();
    expect(verdict(q(1, 0))).toBeNull();
  });

  it("winners only from the Winner award", () => {
    const alliances = [{ number: 2, name: null, captain: 1, pick1: 2, pick2: null, backup: null }];
    expect(winners({ awards: [{ type: "Winner", placement: 1, team: 1, name: null }], alliances })).toEqual({ alliance: 2, teams: [1] });
    expect(winners({ awards: [], alliances })).toBeNull();
  });
});

describe("route", () => {
  it("/events/:season/:code/display is the pit display, drawn bare", () => {
    expect(pageModule("/events/2026/USCAQ1/display")).toBe("EventDisplayPage");
    expect(pageModule("/events/2026/USCAQ1/Display/")).toBe("EventDisplayPage");
    expect(pageTitle("/events/2026/USCAQ1/display")).toBe("Pit display");
    expect(isBareRoute("/events/2026/USCAQ1/display")).toBe(true);
    expect(isBareRoute("/events/2026/USCAQ1")).toBe(false);
  });
});
