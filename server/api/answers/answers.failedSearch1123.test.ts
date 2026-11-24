// Logged failed searches #2199, #2200, #2204 and #2211, by the generic rules that answer them:
//   - a place's teams "ranked" ("fl team ranked") is the place's ranked list, the teams word between them going with it;
//   - "… in their last", nothing after it, is their last event ("thier" is "their" by the spelling check, ../spelling.ts);
//   - two questions joined by "and", the second asking where ("top rookie teams and where is 36013"): each answered, the
//     team's place under the list; asked where with nothing named, the list says where each team is from. "Where id" is
//     "where is" (never a stray two-letter word).
// The clock is Nov 22 2026: the 2026–27 season has matches.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer, withoutStrayLetter } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "./season";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // [number, name, city, state, rookie year, rating]
  const teams: [number, string, string, string, number, number][] = [
    [30030, "Exodus", "Austin", "TX", 2018, 140],
    [36013, "Decagonator", "Miami", "FL", 2026, 90],
    [11111, "Gator Gears", "Tampa", "FL", 2015, 150],
    [22222, "Orange Bots", "Orlando", "FL", 2019, 120],
    [33333, "Lone Star", "Dallas", "TX", 2026, 110],
  ];
  for (const [n, name, city, state, rookie, rating] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, ?, ?, 'USA', ?)", [n, name, city, state, rookie]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (2026, ?, ?, 20, 50, ?, 10, 10, 6, 4, 0)`, [n, rating - 20, rating]);
  }
  const ev = (code: string, name: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, ?, ?, 'LeagueMeet', 'Austin', 'TX', 'USA', ?, ?, 't')", [code, name, start, start]);
  await ev("USTXAM1", "Austin Meet 1", "2026-11-07");
  await ev("USTXAM2", "Austin Meet 2", "2026-11-14");
  let n = 0;
  // Exodus's TeleOp: 90 at its first meet; 40 and 55 at Austin Meet 2, its last.
  const match = async (code: string, time: string, teleop: number) => {
    n++;
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, source)
      VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, 10, ?, 5, 50, 50, 10, 30, 10, 't')`, [code, n, `Q${n}`, time, teleop + 15, teleop + 15, teleop]);
    for (const [t, a] of [[30030, "red"], [33333, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, a]);
  };
  for (const code of ["USTXAM1", "USTXAM2"]) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, ?, 30030, 1)", [code]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2026, ?, 30030, 120, 2)", [code]);
  }
  await match("USTXAM1", "2026-11-07T10:00:00Z", 90);
  await match("USTXAM2", "2026-11-14T10:00:00Z", 40);
  await match("USTXAM2", "2026-11-14T11:00:00Z", 55);
  await rebuildSearch();
  clearAllCaches();
  await refreshSearchSeason();
});

afterAll(() => {
  resetSearchSeason();
  vi.useRealTimers();
});

describe("a place's teams ranked (#2204)", () => {
  it("answers 'fl team ranked' with Florida's rankings", async () => {
    const a = await full("fl team ranked");
    expect(a.stat?.family).toBe("leaderboard");
    expect(a.understood?.place).toMatchObject({ name: "Florida" });
    const board = a.stat!.blocks.find((b) => b.kind === "leaderboard");
    expect(board && board.kind === "leaderboard" && board.rows.map((r) => r.team.label)).toEqual(["11111 Gator Gears", "22222 Orange Bots", "36013 Decagonator"]);
  });
});

describe("a team's best in their last (#2211)", () => {
  it("reads 'in thier last' as their last event", async () => {
    const a = await full("Exodus best teleop in thier last");
    expect(a.stat?.intent).toBe("highest-teleop");
    expect(a.stat?.headline?.value).toBe("60 points"); // 55 TeleOp + 5 endgame at its last meet, never the first meet's 90
    expect(a.stat?.title).toContain("Austin Meet 2");
    expect(a.understood?.unread ?? []).toEqual([]);
    expect(a.didYouMean).toBe("Exodus best teleop in their last");
  });
});

describe("two questions joined by 'and' (#2199, #2200)", () => {
  it("answers the rookie list and where the team named is", async () => {
    const a = await full("top rookie teams and where is 36013");
    expect(a.stat?.intent).toBe("best-rookie");
    const board = a.stat!.blocks.find((b) => b.kind === "leaderboard");
    expect(board && board.kind === "leaderboard" && board.rows.map((r) => r.team.label)).toEqual(["33333 Lone Star", "36013 Decagonator"]);
    expect(a.card?.kind).toBe("info");
    expect(a.card?.lines.map((l) => l.text).join(" ")).toContain("Miami");
    expect(a.hits.some((h) => h.kind === "team" && h.ref === "36013")).toBe(true);
    expect(a.understood?.label).toMatch(/^Best rookie teams · Decagonator \(36013\)/);
    // The page asks by its limit (/api/search?answer=1&limit=25), not by `full`: the same card.
    expect((await searchAnswer("top rookie teams and where is 36013", { limit: 25, learn: false })).card?.kind).toBe("info");
  });
  it("answers the rookie list when asked where with nothing named: each row says where the team is from", async () => {
    const a = await full("top rookie teams and where id");
    expect(a.stat?.intent).toBe("best-rookie");
    const board = a.stat!.blocks.find((b) => b.kind === "leaderboard");
    expect(board && board.kind === "leaderboard" && board.rows.map((r) => r.location)).toEqual([expect.stringContaining("Dallas"), expect.stringContaining("Miami")]);
    expect(a.understood?.label).toBe("Best rookie teams · where each is from");
    expect(a.understood?.unread ?? []).toEqual([]);
  });
  it("never takes the last word of a short form's phrase for a stray one", async () => {
    expect(await withoutStrayLetter("top rookie teams and where id")).toBeNull();
  });
});
