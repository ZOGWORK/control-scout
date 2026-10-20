import { describe, expect, it } from "vitest";
import type { EventDetail, FieldRow, MatchView } from "../src/shared/api";
import { dates, eventEmbed, movement, predictEmbed, rankingsEmbed, topByOpr, verdict, winBar } from "./views";

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

describe("winBar", () => {
  it("ten blocks and the percentage", () => {
    expect(winBar(0.62)).toBe("██████░░░░ 62%");
  });
  it("never a full or an empty bar (or 0% / 100%) before the match", () => {
    expect(winBar(0.999)).toBe("█████████░ 99%");
    expect(winBar(0.001)).toBe("█░░░░░░░░░ 1%");
  });
});

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

describe("verdict", () => {
  it("called, upset, tie, and nothing before the match", () => {
    expect(verdict(m({ played: true, red: { ...m().red, score: scored(150, 100) }, blue: { ...m().blue, score: scored(100, 100) } }))?.called).toBe(true);
    expect(verdict(m({ played: true, red: { ...m().red, score: scored(90, 90) }, blue: { ...m().blue, score: scored(100, 100) } }))?.text).toBe("❌ Upset");
    expect(verdict(m({ played: true, red: { ...m().red, score: scored(100, 100) }, blue: { ...m().blue, score: scored(100, 100) } }))?.called).toBeNull();
    expect(verdict(m())).toBeNull();
  });
});

describe("predictEmbed", () => {
  const d = { event: { name: "Austin Qualifier" } } as Pick<EventDetail, "event">;

  it("links the match report and says where the call came from", () => {
    const e = predictEmbed(d, m(), SITE);
    expect(e.url).toBe(`${SITE}/events/2025/USTXAUQ/match/qual:0:12`);
    expect(e.footer?.text).toBe("From today's ratings · Control Scout • controlscout.org");
  });

  it("a replayed (backtest) call is labelled as one, never as called before the match", () => {
    const p = { ...m().prediction!, kind: "backtest" as const };
    const e = predictEmbed(d, m({ played: true, prediction: p, red: { ...m().red, score: scored(150, 150) }, blue: { ...m().blue, score: scored(100, 100) } }), SITE);
    expect(e.footer?.text).toMatch(/^Replayed call \(walk-forward backtest\)/);
  });

  it("no predicted score when the season has nothing to base one on", () => {
    const e = predictEmbed(d, m({ prediction: { ...m().prediction!, noScoreBasis: true } }), SITE);
    expect(e.fields?.some((f) => f.name === "Predicted score")).toBe(false);
  });

  it("a played match lists the robots that were on the field", () => {
    const t = (n: number, onField: boolean) => ({ number: n, surrogate: false, dq: false, onField });
    const e = predictEmbed(d, m({ played: true, red: { teams: [t(1, true), t(2, true), t(5, false)], score: scored(10, 10) }, blue: { ...m().blue, score: scored(5, 5) } }), SITE);
    expect(e.fields?.[0].value).toBe("1 & 2");
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
    expect(e.fields?.find((f) => f.name === "Winning alliance")?.value).toBe("Alliance 2: 3 & 1");
    expect(e.description).toBe("Mar 1–2 · Austin, TX, USA · X");
    expect(e.fields?.find((f) => f.name === "Matches played")?.value).toBe("40 of 40");
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
