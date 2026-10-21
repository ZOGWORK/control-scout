import { describe, expect, it } from "vitest";
import type { EventDetail, FieldRow, MatchView } from "../src/shared/api";
import { EVE_HOUR, RECAP_AFTER_MS, eveEmbed, eventDue, recapEmbed, scheduleEmbed, venueClock } from "./eventAlerts";
import type { Follow } from "./follows";

const SITE = "https://controlscout.org";
const ZONE = "America/Chicago"; // UTC-5 in October
const local = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00-05:00`);
const t = (n: number) => ({ number: n, surrogate: false, dq: false, onField: true });
const sc = (x: number) => ({ total: x, np: x, auto: 0, teleop: 0, endgame: 0, pen: 0 });

function q(n: number, at: number, red: number[], blue: number[], result?: [number, number], pRed = 0.62): MatchView {
  return {
    season: 2026, code: "X", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null,
    startsAt: new Date(at).toISOString(), played: !!result,
    red: { teams: red.map(t), score: result ? sc(result[0]) : null }, blue: { teams: blue.map(t), score: result ? sc(result[1]) : null },
    video: null, prediction: { pRed, redMean: 100, blueMean: 90, tier: "moderate", kind: "live", predictedAt: null },
  };
}
const row = (team: number, extra: Partial<FieldRow> = {}): FieldRow => ({
  team, name: `Team ${team}`, city: null, state: null, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null,
  opr: { np: null, auto: null, teleop: null, endgame: null, pen: null }, avgNp: null, rating: null, ...extra,
});
function detail(matches: MatchView[], over: Partial<EventDetail["event"]> = {}, field: FieldRow[] = [row(1), row(2), row(3), row(4)]): EventDetail {
  return {
    event: { season: 2026, code: "X", name: "Austin Qualifier", type: "Qualifier", typeLabel: "Qualifier", divisionCode: null, region: null, city: "Austin", state: "TX", country: "USA",
      venue: "Arena", start: "2026-10-24", end: "2026-10-24", remote: false, teams: field.length, matchesPlayed: 0, matchesTotal: matches.length, status: "upcoming",
      website: null, livestream: null, timezone: ZONE, source: "first", ...over },
    field, matches, alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null,
  } as EventDetail;
}
const f = (team: number, channel = "c1"): Follow => ({ guild_id: "g", channel_id: channel, team, created_at: "2026-10-01T00:00:00Z", failures: 0 });

describe("venueClock", () => {
  it("the date and hour at the venue, not UTC's", () => {
    expect(venueClock(Date.parse("2026-10-24T03:00:00Z"), ZONE)).toEqual({ date: "2026-10-23", hour: 22 });
  });
});

describe("eventDue", () => {
  it("the evening before (from 4 pm at the venue), not earlier, not on the day", () => {
    const d = detail([]);
    expect(eventDue([f(1)], d, local("2026-10-23", `${EVE_HOUR}:05`)).map((x) => x.kind)).toEqual(["eve"]);
    expect(eventDue([f(1)], d, local("2026-10-23", "10:00"))).toEqual([]);
    expect(eventDue([f(1)], d, local("2026-10-24", "17:00")).map((x) => x.kind)).not.toContain("eve");
    expect(eventDue([f(9)], d, local("2026-10-23", "18:00"))).toEqual([]); // not entered
  });

  it("the schedule once the team's quals are posted, until the event is over", () => {
    const m = [q(1, local("2026-10-24", "10:00"), [1, 2], [3, 4])];
    expect(eventDue([f(1)], detail(m), local("2026-10-23", "09:00")).map((x) => x.kind)).toEqual(["schedule"]);
    expect(eventDue([f(1)], detail(m, { status: "finished" }), local("2026-10-23", "09:00"))).toEqual([]);
  });

  it("the day's recap only once the team's matches today are all scored, 30 minutes after its last", () => {
    const last = local("2026-10-24", "14:00");
    const done = [q(1, local("2026-10-24", "10:00"), [1, 2], [3, 4], [100, 80]), q(2, last, [1, 3], [2, 4], [70, 90])];
    const d = detail(done, { status: "live" });
    expect(eventDue([f(1)], d, last + RECAP_AFTER_MS - 1).map((x) => x.kind)).not.toContain("recap");
    expect(eventDue([f(1)], d, last + RECAP_AFTER_MS)).toContainEqual({ channel: "c1", teams: [1], kind: "recap", key: "recap:2026-10-24:1" });
    const pending = detail([...done, q(3, local("2026-10-24", "16:00"), [1, 4], [2, 3])], { status: "live" });
    expect(eventDue([f(1)], pending, last + RECAP_AFTER_MS).map((x) => x.kind)).not.toContain("recap");
  });

  it("two followed teams in one channel: one post naming both", () => {
    const due = eventDue([f(1), f(3)], detail([]), local("2026-10-23", "18:00"));
    expect(due).toEqual([{ channel: "c1", teams: [1, 3], kind: "eve", key: "eve" }]);
  });
});

describe("one post per team where it matters", () => {
  it("each followed team in a channel gets its own recap, whenever its day ends", () => {
    const d = detail([
      q(1, local("2026-10-24", "10:00"), [1, 2], [5, 6], [100, 80]),
      q(2, local("2026-10-24", "15:00"), [3, 4], [5, 6]), // team 3's day isn't over
    ], { status: "live" });
    const now = local("2026-10-24", "11:00");
    expect(eventDue([f(1), f(3)], d, now).filter((x) => x.kind === "recap")).toEqual([{ channel: "c1", teams: [1], kind: "recap", key: "recap:2026-10-24:1" }]);
  });

  it("each team's schedule is its own post (no single message past Discord's size limit)", () => {
    const d = detail([q(1, local("2026-10-24", "10:00"), [1, 2], [3, 4])]);
    expect(eventDue([f(1), f(3)], d, local("2026-10-23", "09:00")).map((x) => x.key).sort()).toEqual(["schedule:1", "schedule:3"]);
  });
});

describe("the posts", () => {
  it("the evening before: where, when, the team's season and the strongest teams there", () => {
    const d = detail([], {}, [row(1), row(2, { rating: { np: 80, sd: 5, matches: 9 } }), row(3, { rating: { np: 60, sd: 5, matches: 9 } })]);
    const e = eveEmbed({ channel: "c1", teams: [1], kind: "eve", key: "eve" }, d, [{ team: 1, name: "Gear Grinders", opr: 98.24, worldRank: 584 }], SITE);
    expect(e.title).toBe("Tomorrow: Austin Qualifier");
    expect(e.url).toBe(`${SITE}/events/2026/X`);
    const v = Object.fromEntries(e.fields!.map((x) => [x.name, x.value]));
    expect(v.Where).toBe("Arena, Austin, TX");
    expect(v["1 Gear Grinders"]).toBe("Season OPR **98.2** · #584 world");
    expect(v["Strongest there"]).toBe("2 Team 2 · 80.0\n3 Team 3 · 60.0");
  });

  it("the schedule: each qual with its time at the venue, side, partner and win odds", () => {
    const d = detail([q(12, local("2026-10-24", "10:42"), [1, 2], [3, 4], undefined, 0.62), q(15, local("2026-10-24", "11:30"), [3, 4], [1, 2], undefined, 0.7)]);
    const e = scheduleEmbed({ channel: "c1", teams: [1], kind: "schedule", key: "schedule" }, d, SITE);
    expect(e.fields![0]).toEqual({ name: "1: 2 qualification matches", value: "**Q12** 10:42 AM · red with 2 · 62% to win\n**Q15** 11:30 AM · blue with 2 · 30% to win" });
    expect(e.footer!.text).toMatch(/^Win odds from today's ratings, moderate confidence/);
  });

  it("the recap: rank, record, today's matches and how many calls were right", () => {
    const d = detail([
      q(1, local("2026-10-24", "10:00"), [1, 2], [3, 4], [100, 80], 0.7), // called
      q(2, local("2026-10-24", "11:00"), [1, 3], [2, 4], [70, 90], 0.6), // upset
    ], { status: "live" }, [row(1, { rank: 3, wins: 1, losses: 1, ties: 0 }), row(2), row(3), row(4)]);
    const e = recapEmbed({ channel: "c1", teams: [1], kind: "recap", key: "recap:2026-10-24" }, d, "2026-10-24", SITE);
    expect(e.fields![0]).toEqual({ name: "1 Team 1", value: "Rank **3** of 4 · 1–1–0 · 2 matches today · live calls right: 1 of 2" });
  });

  it("a record the source hasn't reported is left out, and replayed (backtest) calls don't count as calls right", () => {
    const replayed = { ...q(1, local("2026-10-24", "10:00"), [1, 2], [3, 4], [100, 80], 0.7) };
    replayed.prediction = { ...replayed.prediction!, kind: "backtest" };
    const d = detail([replayed], { status: "live" }, [row(1, { rank: 2 }), row(2), row(3), row(4)]);
    const e = recapEmbed({ channel: "c1", teams: [1], kind: "recap", key: "recap:2026-10-24:1" }, d, "2026-10-24", SITE);
    expect(e.fields![0].value).toBe("Rank **2** of 4 · 1 match today");
  });
});
