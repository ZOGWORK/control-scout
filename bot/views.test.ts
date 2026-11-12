import { describe, expect, it } from "vitest";
import type { EventDetail, FieldRow, MatchView } from "../src/shared/api";
import {
  PRIDE, VOLT, dates, embedBlocks, embedReadChars, eventEmbed, movement, preMatchEmbed, predictEmbed, rankingsEmbed, pride, resultEmbed,
  storyLine, topByOpr, verdict, winningAlliance,
} from "./views";
import fixture from "./fixtures/usnjnem3-2026-11-07.json";

const SITE = "https://controlscout.org";

function m(over: Partial<MatchView> = {}): MatchView {
  const t = (n: number, onField = true) => ({ number: n, surrogate: false, dq: false, onField });
  return {
    season: 2025, code: "USTXAUQ", key: "qual:0:12", level: "qual", series: 0, number: 12, label: "Qual 12", time: null, startsAt: null, played: false,
    red: { teams: [t(1), t(2)], score: null }, blue: { teams: [t(3), t(4)], score: null }, video: null,
    prediction: { pRed: 0.62, redMean: 148.4, blueMean: 120.6, tier: "confident", kind: "now", predictedAt: null },
    ...over,
  };
}
const scored = (red: number, blue: number) => ({ total: red, np: red, auto: 0, teleop: 0, endgame: 0, pen: 0 });

describe("movement", () => {
  it("arrows as the rankings page shows them", () => {
    expect([movement(3), movement(-2), movement(0), movement(null), movement("new")]).toEqual(["↑3", "↓2", "—", "—", "new"]);
  });
});

describe("dates", () => {
  it("one day, a span in a month, a span across months", () => {
    expect([dates("2026-10-25", "2026-10-25"), dates("2026-10-25", "2026-10-26"), dates("2026-10-31", "2026-11-01"), dates(null, null)])
      .toEqual(["Oct 25", "Oct 25–26", "Oct 31 – Nov 1", "Dates not posted"]);
  });
});

/** A played match with this call and final score. */
const played = (pRed: number, red: number, blue: number, means: [number, number] = [100, 90], kind: "live" | "backtest" = "live") =>
  m({ played: true, red: { ...m().red, score: scored(red, red) }, blue: { ...m().blue, score: scored(blue, blue) }, prediction: { ...m().prediction!, pRed, redMean: means[0], blueMean: means[1], kind } });

describe("verdict", () => {
  it("a favourite (55%+) is called or upset; an even call (45–55%) and a tie have no verdict", () => {
    expect(verdict(played(0.68, 150, 100))).toEqual({ called: true, text: "Called it ✅" });
    expect(verdict(played(0.29, 100, 80))).toEqual({ called: false, text: "Upset ❌" });
    expect(verdict(played(0.5, 80, 100))).toEqual({ called: null, text: "Even call" });
    expect(verdict(played(0.499, 81, 65))).toEqual({ called: null, text: "Even call" }); // Q16: Blue 50%
    expect(verdict(played(0.539, 30, 41))).toEqual({ called: null, text: "Even call" }); // Q17: Red 54%
    expect(verdict(played(0.546, 30, 41))?.called).toBe(false); // reads 55%: a favourite
    expect(verdict(played(0.454, 30, 41))?.called).toBe(true); // Blue reads 55%
    expect(verdict(played(0.544, 30, 41))?.called).toBeNull(); // reads 54%
    expect(verdict(played(0.7, 90, 90))).toEqual({ called: null, text: "Tie" });
    expect(verdict(m())).toBeNull();
  });
});

describe("predictEmbed", () => {
  const d = { event: { name: "Austin Qualifier" } } as Pick<EventDetail, "event">;

  it("before the match: the lineup and the call in one description, no fields, no win bars", () => {
    const e = predictEmbed(d, m({ startsAt: "2026-10-24T15:15:00Z" }), SITE);
    expect(e.title).toBe("Qual 12 · Austin Qualifier");
    expect(e.url).toBe(`${SITE}/events/2025/USTXAUQ/match/qual:0:12`);
    expect(e.fields).toBeUndefined();
    expect(e.description).toBe(`Starts <t:1792854900:R> (<t:1792854900:t>).\n🔴 [1](${SITE}/teams/1) & [2](${SITE}/teams/2) vs [3](${SITE}/teams/3) & [4](${SITE}/teams/4) 🔵 · Red 62% to win · predicted 148–121 · solid`);
    expect(e.description).not.toMatch(/█/);
    expect(e.footer?.text).toBe("From today's ratings · Control Scout • controlscout.org");
  });

  it("an even call before the match says so, with its confidence in plain words once", () => {
    const e = predictEmbed(d, m({ prediction: { ...m().prediction!, pRed: 0.52, tier: "provisional" } }), SITE);
    expect(e.description).toMatch(/· Even call · predicted 148–121 · rough guess$/);
    expect(e.description!.match(/rough guess/g)).toHaveLength(1);
  });

  it("a played match: score line, story and the event link; no Red/Blue/Final score/Predicted/Verdict fields", () => {
    const e = predictEmbed(d, played(0.68, 74, 52, [72, 58]), SITE);
    expect(e.fields).toBeUndefined();
    expect(e.description!.split("\n")).toEqual([
      `🔴 [1](${SITE}/teams/1) & [2](${SITE}/teams/2) **74** – 52 [3](${SITE}/teams/3) & [4](${SITE}/teams/4) 🔵`,
      "Called it ✅ — Red 68% (predicted 72–58), won by 22.",
      `[Event](${SITE}/events/2025/USTXAUQ)`,
    ]);
    expect(e.color).toBe(VOLT); // ad-hoc /predict: volt
    expect(e.description).not.toMatch(/confidence|rough guess|fair|solid/i);
  });

  it("the story: called, upset, even, tie and no logged call", () => {
    expect(storyLine(played(0.68, 74, 52, [72, 58]))).toBe("Called it ✅ — Red 68% (predicted 72–58), won by 22.");
    expect(storyLine(played(0.29, 78, 60, [55, 74]))).toBe("Upset ❌ — Blue was 71% (predicted 55–74), Red won by 18.");
    expect(storyLine(played(0.29, 60, 78, [55, 74]))).toBe("Called it ✅ — Blue 71% (predicted 55–74), won by 18.");
    expect(storyLine(played(0.539, 30, 41, [53, 43]))).toBe("Even call — predicted Red by 10, Blue won by 11.");
    expect(storyLine(played(0.7, 44, 44))).toBe("Tie at 44 — no winner to call.");
    expect(storyLine({ ...played(0.7, 50, 40), prediction: null })).toBe("No prediction was logged for this match.");
    const even = played(0.5, 74, 52);
    expect(storyLine({ ...even, prediction: { ...even.prediction!, noScoreBasis: true } })).toBe("Even call — Red won by 22.");
  });

  it("footer: no label on a live call, the kind on a replayed or today's-ratings one", () => {
    expect(predictEmbed(d, played(0.68, 74, 52), SITE).footer?.text).toBe("Control Scout • controlscout.org");
    expect(predictEmbed(d, played(0.68, 74, 52, [72, 58], "backtest"), SITE).footer?.text).toBe("Replayed call · Control Scout • controlscout.org");
  });

  it("no predicted score when the season has nothing to base one on", () => {
    const e = predictEmbed(d, m({ prediction: { ...m().prediction!, noScoreBasis: true } }), SITE);
    expect(e.description).not.toMatch(/predicted/);
  });

  it("a match marked played with one score still missing says so, never \"Starts\"", () => {
    const partial = m({ played: true, startsAt: "2026-10-24T15:15:00Z", red: { ...m().red, score: scored(80, 80) } });
    const e = predictEmbed(d, partial, SITE);
    expect(e.description!.split("\n")[0]).toBe("Played: the final score isn't posted yet.");
    expect(e.description).not.toMatch(/Starts/);
  });

  it("the next-match line links the followed team it names", () => {
    const next = m({ key: "qual:0:20", number: 20, label: "Qual 20" });
    const e = resultEmbed("Austin Qualifier", played(0.68, 74, 52), SITE, { next: { match: next, team: 3 } });
    expect(e.description!.split("\n")[2]).toMatch(/^Next for \[3\]\(https:\/\/controlscout\.org\/teams\/3\): Qual 20 · /);
  });

  it("a played match lists the robots that were on the field", () => {
    const t = (n: number, onField: boolean) => ({ number: n, surrogate: false, dq: false, onField });
    const e = predictEmbed(d, m({ played: true, red: { teams: [t(1, true), t(2, true), t(5, false)], score: scored(10, 10) }, blue: { ...m().blue, score: scored(5, 5) } }), SITE);
    expect(e.description).toMatch(/^🔴 \[1\]\(.*\) & \[2\]\(.*\) \*\*10\*\* – 5 /);
    expect(e.description).not.toMatch(/teams\/5\)/);
  });
});

describe("the real Nov 7, 2026 posts (P1-5 PM Northeast League Meet)", () => {
  const ev = fixture as unknown as EventDetail;
  const q = (n: number) => ev.matches.find((x) => x.level === "qual" && x.number === n)!;

  it("Q16: an even call, never an upset; 4 blocks, under 600 characters", () => {
    const e = resultEmbed(ev.event.name, q(16), SITE);
    expect(e.title).toBe("Q16 · P1-5 PM Northeast League Meet");
    expect(e.description!.split("\n").slice(0, 2)).toEqual([
      `🔴 [23314](${SITE}/teams/23314) & [8902](${SITE}/teams/8902) **81** – 65 [4215](${SITE}/teams/4215) & [23545](${SITE}/teams/23545) 🔵`,
      // The logged call: Blue 50% to win, predicted 97–93 (Red by 4).
      "Even call — predicted Red by 4, Red won by 16.",
    ]);
    expect(e.description).not.toMatch(/Upset/);
    expect(embedBlocks(e)).toBeLessThanOrEqual(4);
    expect(embedReadChars(e)).toBeLessThanOrEqual(600);
  });

  it("Q17: the same shape and budget", () => {
    const e = resultEmbed(ev.event.name, q(17), SITE);
    expect(e.description!.split("\n")[1]).toBe("Even call — predicted Red by 10, Blue won by 11.");
    expect(embedBlocks(e)).toBeLessThanOrEqual(4);
    expect(embedReadChars(e)).toBeLessThanOrEqual(600);
  });

  it("every team number is a link, and no fact repeats in a field", () => {
    for (const n of [16, 17]) {
      const e = resultEmbed(ev.event.name, q(n), SITE);
      const bare = e.description!.replace(/\[[^\]]*\]\([^)]*\)/g, "").match(/\b\d{4,5}\b/g);
      expect(bare).toBeNull();
      expect(e.fields ?? []).toEqual([]);
    }
  });

  it("a reminder before Q16 stays inside 3 blocks and 400 characters", () => {
    const before = { ...q(16), played: false, red: { ...q(16).red, score: null }, blue: { ...q(16).blue, score: null } };
    const e = preMatchEmbed(ev.event.name, before, SITE, "[4215](x) on Blue with [23545](x), <t:1:R> (<t:1:t>).");
    expect(e.description!.split("\n")[1]).toMatch(/🔵 · Even call · predicted 97–93 · rough guess$/);
    expect(embedBlocks(e)).toBeLessThanOrEqual(3);
    expect(embedReadChars(e)).toBeLessThanOrEqual(400);
  });
});

describe("pride borders", () => {
  it("every sent embed gets one of the pride flag's six colours, the same one for the same post", () => {
    const titles = ["Q1 · Meet", "Q2 · Meet", "Q3 · Meet", "Q4 · Meet", "Q5 · Meet", "Q6 · Meet", "Schedule posted: Meet", "Something went wrong"];
    const colours = titles.map((title) => pride({ title, color: VOLT }).color);
    for (const c of colours) expect(PRIDE).toContain(c);
    expect(new Set(colours).size).toBeGreaterThan(2);
    expect(pride({ title: "Q1 · Meet", color: VOLT }).color).toBe(colours[0]);
    expect(PRIDE).toEqual([0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x004cff, 0x732982]);
  });
});

describe("eventEmbed", () => {
  const row = (team: number, opr: number | null, seasonOpr: number | null = null): FieldRow => ({
    team, name: `T${team}`, city: null, state: null, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null,
    opr: { np: opr, auto: null, teleop: null, endgame: null, pen: null }, avgNp: null, rating: null, seasonOpr,
  });

  it("top five by event OPR; before the event, by season OPR (and says so)", () => {
    expect(topByOpr([row(1, 50), row(2, 70), row(3, null), row(4, 10), row(5, 20), row(6, 30), row(7, 40)]).rows.map((r) => r.team)).toEqual([2, 1, 7, 6, 5]);
    expect(topByOpr([row(1, null, 12), row(2, null, 30)])).toMatchObject({ season: true, rows: [{ team: 2 }, { team: 1 }] });
  });

  it("a finished event names its winning alliance", () => {
    const d = {
      event: { season: 2025, code: "X", name: "Final", status: "finished", start: "2026-03-01", end: "2026-03-02", city: "Austin", state: "TX", country: "USA", matchesPlayed: 40, matchesTotal: 40, teams: 3 },
      field: [row(1, 50), row(2, 40), row(3, 30)],
      alliances: [{ number: 2, name: null, captain: 3, pick1: 1, pick2: null, backup: null }],
      awards: [{ type: "Winner", placement: 1, team: 3, name: null }, { type: "Winner", placement: 1, team: 1, name: null }],
    } as unknown as EventDetail;
    const e = eventEmbed(d, SITE);
    expect(e.fields?.find((f) => f.name === "Winning alliance")?.value).toBe(`Alliance 2: [3](${SITE}/teams/3) & [1](${SITE}/teams/1)`);
    expect(e.description).toBe("Mar 1–2 · Austin, TX, USA · X");
    expect(e.fields?.find((f) => f.name === "Matches played")?.value).toBe("40 of 40");
  });
});

describe("winningAlliance", () => {
  const alliances = [{ number: 1, name: null, captain: 10, pick1: 11, pick2: null, backup: null }, { number: 4, name: null, captain: 40, pick1: 41, pick2: 42, backup: null }];

  it("the Winner award's teams and their alliance", () => {
    expect(winningAlliance({ awards: [{ type: "Winner", placement: 1, team: 40, name: null }, { type: "Winner", placement: 1, team: 41, name: null }], alliances })).toEqual({ alliance: 4, teams: [40, 41] });
  });

  it("nothing before the awards are posted: a scored playoff match never stands in for the championship", () => {
    expect(winningAlliance({ awards: [{ type: "Inspire", placement: 1, team: 10, name: null }], alliances })).toBeNull();
  });
});

describe("rankingsEmbed", () => {
  it("ten rows, linked, with movement and the rating to one place", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, team: 100 + i, name: `Team ${i}`, state: null, country: null, rating: 80 - i, move: i === 0 ? 2 : null, dRating: null, trend: null }));
    const e = rankingsEmbed(rows, "2026–27", SITE);
    const lines = e.description!.split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe(`**1.** \`↑2 \` [100](${SITE}/teams/100) Team 0 · **80.0**`);
    expect(e.url).toBe(`${SITE}/rankings`);
  });
});
