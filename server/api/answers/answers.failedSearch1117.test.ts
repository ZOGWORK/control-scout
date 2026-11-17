// Logged failed searches #1641–#1643 and #1151, by the generic rules that answer them: a place's winning alliance
// captains (the Winning Alliance award at its captain's place), an award's name cut off where it was won, a place's
// award winners stepping back a season when the current one has none yet, and a superlative said straight before a
// place ("top <state>"). #1640 (a team's conference place in the dropdown) is in families/conference.test.ts. The
// clock is Nov 16 2026: the 2026–27 season has matches, and no awards yet.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { awardCutOff } from "../spelling";
import { placeAwardsAnswer, readPlaceAwards } from "./families/placeAwards";
import { refreshSearchSeason, resetSearchSeason } from "./season";
import { readAsk } from "../searchAsks";
import { resultOf } from "../searchLayers";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
const cells = (a: Awaited<ReturnType<typeof full>>) => {
  const t = a.stat?.blocks.find((b) => b.kind === "table");
  return t && t.kind === "table" ? t.rows.map((r) => [r.cells.team, r.cells.award]) : [];
};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, number][] = [
    [4215, "Hypnotic Robotics", "NJ", 120], [6980, "Bad Wolf", "NJ", 110], [23268, "Ultraviolet", "NJ", 100], [7149, "Enforcers", "NJ", 90],
    [30030, "Exodus", "TX", 150], [38702, "Mech-dranos", "TX", 140], [10809, "Crow Force", "CA", 130],
  ];
  for (const [n, name, state, rating] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    for (const s of [2025, 2026]) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
      await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, rating_np, rating_matches, matches, wins, losses, ties)
        VALUES (?, ?, ?, 20, ?, 10, 10, 6, 4, 0)`, [s, n, rating - 20, rating]);
    }
  }
  const ev = (season: number, code: string, name: string, state: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', ?, 'USA', ?, ?, 't')", [season, code, name, state, start, start]);
  await ev(2025, "USNJQ1", "Oradell Qualifier", "NJ", "2026-01-10");
  await ev(2025, "USNJQ2", "Hackettstown Qualifier", "NJ", "2026-01-24");
  await ev(2025, "USTXQ1", "Austin Qualifier", "TX", "2026-01-11");
  await ev(2025, "USTXQ2", "Dallas Qualifier", "TX", "2026-02-07");
  await ev(2026, "USNJM1", "Northern League Meet", "NJ", "2026-11-08");
  // 2025–26's awards: at each NJ event the captain (1st) and its pick (2nd), and the Inspire Award; nothing yet in 2026–27.
  const award = (code: string, type: string, placement: number, team: number, name: string) =>
    run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2025, ?, ?, ?, ?, ?)", [code, type, placement, team, name]);
  await award("USNJQ1", "Winner", 1, 4215, "Winning Alliance - Captain");
  await award("USNJQ1", "Winner", 2, 6980, "Winning Alliance - 1st Team Selected");
  await award("USNJQ2", "Winner", 1, 23268, "Winning Alliance - Captain");
  await award("USNJQ2", "Winner", 2, 7149, "Winning Alliance - 1st Team Selected");
  await award("USNJQ1", "Inspire", 1, 6980, "Inspire Award");
  await award("USNJQ1", "Inspire", 2, 4215, "Inspire Award");
  await award("USTXQ1", "Winner", 1, 30030, "Winning Alliance - Captain");
  await award("USTXQ1", "Inspire", 1, 38702, "Inspire Award");
  // A source that gives every member of the alliance 1st place, the role unnamed: the captain is the alliance selection's.
  await award("USTXQ2", "Winner", 1, 30030, "Winning Alliance Award");
  await award("USTXQ2", "Winner", 1, 38702, "Winning Alliance Award");
  await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (2025, 'USTXQ2', 1, 38702, 30030)");
  // A Finalist Alliance counts for each of its teams, whatever its place.
  await award("USNJQ1", "Finalist", 1, 7149, "Finalist Alliance - Captain");
  await award("USNJQ1", "Finalist", 2, 23268, "Finalist Alliance - 1st Team Selected");
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});
afterAll(() => { vi.useRealTimers(); });

describe("a place's winning alliance captains (#1642, #1643)", () => {
  it("reads the captain as the Winning Alliance award's 1st place, the place kept", async () => {
    expect(await readPlaceAwards("teams in nj that won winning alliance captain")).toMatchObject({ place: { kind: "region", name: "New Jersey" }, types: ["Winner"], captain: true, season: null });
    expect(await readPlaceAwards("nj winning alliance captain")).toMatchObject({ place: { name: "New Jersey" }, types: ["Winner"], captain: true });
  });
  it("answers with the captains alone, from the latest season with any, saying so", async () => {
    for (const q of ["teams in nj that won winning alliance captain", "nj winning allaince captain"]) {
      const a = await full(q);
      expect(a.stat?.title, q).toBe("New Jersey Winning Alliance Captains, 2025–26");
      expect(a.stat?.scope[0], q).toBe("No 2026–27 Winning Alliance Captains yet in New Jersey; showing 2025–26");
      expect(cells(a), q).toEqual([["23268 Ultraviolet", "Winning Alliance Captain"], ["4215 Hypnotic Robotics", "Winning Alliance Captain"]]);
      expect(resultOf(a, { team: false, intent: true }), q).toBe("answered");
    }
    // The misspelled word is search's own: its answer is the spelled query's, offered as a correction.
    expect((await full("nj winning allaince captain")).didYouMean).toBe("nj winning alliance captain");
  });
  it("finds the captain where every member got 1st place, from the alliance selection", async () => {
    const a = await placeAwardsAnswer({ ...(await readPlaceAwards("texas winning alliance captains"))!, season: 2025 });
    expect(a.blocks[0].kind === "table" && a.blocks[0].rows.map((r) => r.cells.team)).toEqual(["38702 Mech-dranos", "30030 Exodus"]);
    expect(a.definition).not.toContain("counts for each of its teams");
    expect(a.definition).toContain("never its picks");
  });
  it("keeps every Finalist asked beside the captains, and words the latest captains anywhere as captains", async () => {
    const nj = (await readPlaceAwards("nj winning alliance captains"))!;
    const both = await placeAwardsAnswer({ ...nj, types: ["Winner", "Finalist"], season: 2025 });
    expect(both.blocks[0].kind === "table" && both.blocks[0].rows.map((r) => `${r.cells.team} ${r.cells.award}`).sort()).toEqual([
      "23268 Ultraviolet Finalist Alliance", "23268 Ultraviolet Winning Alliance Captain", "4215 Hypnotic Robotics Winning Alliance Captain", "7149 Enforcers Finalist Alliance"]);
    const any = await placeAwardsAnswer({ ...nj, place: null });
    expect(any.title).toMatch(/^The latest Winning Alliance Captains/);
    expect(any.headline?.label).toMatch(/^captained the winning alliance at /);
  });
  it("leaves a season said as said", async () => {
    const a = await full("teams in nj that won winning alliance captain 2026-27");
    expect(a.stat?.scope).toEqual(["New Jersey", "2026–27"]);
    expect(a.stat?.none).toContain("No Winning Alliance Captain won by teams from New Jersey in 2026–27");
  });
});

describe("a place's award winners with none in any season tried", () => {
  it("says so, and offers only seasons before the ones tried", async () => {
    const a = await full("nj think winners");
    expect(a.stat?.none).toContain("Nothing in 2025–26 either");
    const rel = a.stat?.blocks.find((b) => b.kind === "related");
    expect(rel && rel.kind === "related" && rel.queries).toEqual(["nj think winners 2024-25", "nj think winners 2023-24"]);
  });
});

describe("an award's name cut off where it was won (#1641)", () => {
  it("completes a start one award's name has, and only that", () => {
    expect(awardCutOff("teams in nj that won ins")).toBe("teams in nj that won inspire");
    // A start two awards share, a whole name, or a word not after a win: left as typed.
    expect(awardCutOff("teams in nj that won con")).toBeNull();
    expect(awardCutOff("teams in nj that won inspire")).toBeNull();
    expect(awardCutOff("teams in nj ins")).toBeNull();
    expect(awardCutOff("teams in nj that won in")).toBeNull();
  });
  it("answers the award's winners in the place, the latest season with any", async () => {
    const a = await full("teams in nj that won ins");
    expect(a.didYouMean).toBe("teams in nj that won inspire");
    expect(a.stat?.title).toBe("New Jersey Inspire Award winners, 2025–26");
    expect(a.stat?.scope[0]).toBe("No 2026–27 Inspire Awards yet in New Jersey; showing 2025–26");
    expect(cells(a)).toEqual([["6980 Bad Wolf", "Inspire Award"]]);
  });
});

describe("a superlative straight before a place (#1151)", () => {
  it("reads 'top <place>' as the place's leaderboard, and other words after 'top' as nothing", () => {
    expect(readAsk("top texas")).toMatchObject({ kind: "leaderboard", region: { key: "USA:TX" } });
    for (const q of ["top shelf", "best robotics", "best in show"]) expect(readAsk(q), q).toBeNull();
  });
  it("answers 'Top west Texas' with Texas's top teams, saying West Texas is all of Texas", async () => {
    const a = await full("Top west Texas");
    expect(a.step).not.toBe("recovery");
    expect(a.understood?.label).toContain("West Texas isn't a separate region: all of Texas");
    expect(JSON.stringify(a.stat ?? a.card)).toContain("30030");
    expect(JSON.stringify(a.stat ?? a.card)).not.toContain("4215");
  });
});
