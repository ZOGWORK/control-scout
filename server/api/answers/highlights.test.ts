import { describe, expect, it, vi } from "vitest";
import type { TeamMatch } from "./matchSet";

const ms = vi.hoisted(() => ({ rows: [] as TeamMatch[] }));
vi.mock("./matchSet.js", async (orig) => ({
  ...(await orig<typeof import("./matchSet.js")>()),
  teamMatches: async () => ms.rows,
  teamLinks: async () => new Map(),
}));
const { teamHighlights } = await import("./highlights");

let n = 0;
const m = (over: Partial<TeamMatch>): TeamMatch => ({
  season: 2025, code: "USNJCMP", level: "qual", series: 0, number: ++n, label: `Q${n}`, date: "2026-03-07", event: "NJ Championship", type: "Championship",
  country: "USA", state: "NJ", division: null, alliance: "red", own: 150, opp: 140, ownNp: 150, oppNp: 140, ownAuto: 30, ownTeleop: 90, ownEndgame: 30,
  ownPen: 0, oppPen: 0, counted: true, onField: true, result: "W", partners: [207], opponents: [6980, 16461], ...over,
});
const team = { number: 4215, name: "Hypnotic Robotics" };

describe("a team's highlights", () => {
  it("picks its best score, biggest win, latest playoff win, best Auto and closest win, each match once", async () => {
    ms.rows = [
      m({ season: 2024, own: 400, ownNp: 400, opp: 10 }), // an older season: never compared
      m({ own: 210, ownNp: 200, opp: 100, ownAuto: 40 }), // best score and biggest win
      m({ own: 160, ownNp: 160, opp: 158 }), // closest win
      m({ own: 120, ownNp: 120, opp: 150, result: "L", ownAuto: 70 }), // best Auto, in a loss
      m({ level: "playoff", label: "M2", own: 180, ownNp: 180, opp: 170 }),
      m({ level: "playoff", label: "M4", own: 170, ownNp: 170, opp: 165 }), // the later playoff win
      m({ own: 300, ownNp: 300, opp: 0, onField: false }), // a surrogate sitting out: not its match
    ];
    const a = (await teamHighlights(team))!;
    const rows = a.blocks[0].kind === "matches" ? a.blocks[0].rows : [];
    expect(rows.map((r) => [r.note, r.label])).toEqual([["Best score", "Q2"], ["Latest playoff win", "M4"], ["Best Auto", "Q4"], ["Closest win", "Q3"]]);
    expect(a.title).toBe("Highlights, 2025–26");
    expect(a.headline).toMatchObject({ value: "200 points", label: "Best score: Q2 at NJ Championship", sub: "210 with penalties · Won 210–100", href: rows[0].href });
    expect(a.source).toBe("From 5 matches in 2025–26");
  });
  it("a season the search named is the one shown, never a later one", async () => {
    ms.rows = [m({ season: 2024, label: "Q1", own: 120, ownNp: 120 }), m({ label: "Q9", own: 250, ownNp: 250 })];
    const a = (await teamHighlights(team, 2024))!;
    expect(a.title).toBe("Highlights, 2024–25");
    expect(a.headline?.label).toBe("Best score: Q1 at NJ Championship");
    expect(await teamHighlights(team, 2023)).toBeNull();
  });
  it("no played match: no answer", async () => {
    ms.rows = [m({ onField: false })];
    expect(await teamHighlights(team)).toBeNull();
  });
});
