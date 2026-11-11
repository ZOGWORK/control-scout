// Double-elimination lives on the server's match views: an event's playoff rows carry them, a team's own list (only
// its matches) gets the same lives from the event's whole playoff, and qualification rows and older seasons none.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { matchViews } from "./matches";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const season of [2025, 2023]) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'DE', 'Double Elim Qualifier', 'Qualifier', 'Town', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't')", [season]);
    const A: Record<number, number[]> = { 1: [1, 11], 2: [2, 22], 3: [3, 33], 4: [4, 44] };
    // M1 1v4, M2 2v3, M3 4v3 (lower), M4 1v2 (upper), M5 2v4 (lower final), M6 1v2 (final); plus one qualification match.
    const ms: [string, number, number, number, number, number][] = [["qual", 0, 1, 1, 2, 100], ["playoff", 1, 1, 1, 4, 200], ["playoff", 2, 1, 2, 3, 180], ["playoff", 3, 1, 4, 3, 150], ["playoff", 4, 1, 1, 2, 210], ["playoff", 5, 1, 2, 4, 160], ["playoff", 6, 1, 1, 2, 150]];
    for (const [level, series, number, r, b, rs] of ms) {
      const bs = level === "playoff" && series === 6 ? 190 : 100;
      await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'DE', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 't')`,
        [season, level, series, number, level === "qual" ? `Q${number}` : `M${series}`, `2026-01-10T1${series}:00:00`, rs, rs, bs, bs]);
      const teams = level === "qual" ? { red: [1, 2], blue: [3, 4] } : { red: A[r], blue: A[b] };
      for (const al of ["red", "blue"] as const) for (const t of teams[al]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'DE', ?, ?, ?, ?, ?, 1)", [season, level, series, number, t, al]);
    }
  }
});

describe("lives on match views", () => {
  it("an event's playoff rows carry them; its qualification rows don't", async () => {
    const ms = await matchViews({ season: 2025, code: "DE" });
    expect(ms.find((m) => m.key === "qual:0:1")!.lives).toBeUndefined();
    expect(ms.find((m) => m.key === "playoff:1:1")!.lives).toEqual({ red: { before: 2, after: 2 }, blue: { before: 2, after: 1 } });
    expect(ms.find((m) => m.key === "playoff:6:1")!.lives).toEqual({ red: { before: 2, after: 1, final: true }, blue: { before: 1, after: 1, final: true } });
  });
  it("a team's own list gets the lives the event's whole playoff gives (the opponent's earlier losses included)", async () => {
    const ms = await matchViews({ season: 2025, team: 4 });
    // Team 4's M5: alliance 2 lost M4 (a match team 4 didn't play), so it comes in with 1 life.
    expect(ms.find((m) => m.key === "playoff:5:1")!.lives).toEqual({ red: { before: 1, after: 1 }, blue: { before: 1, after: 0 } });
  });
  it("a season before double elimination has none", async () => {
    expect((await matchViews({ season: 2023, code: "DE" })).some((m) => m.lives)).toBe(false);
  });
});
