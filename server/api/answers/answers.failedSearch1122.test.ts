// Logged failed searches #2149 and #2150, by the generic rules that answer them: a team's number said again before an
// event word is the same team's own event ("37032 record at 37032 meet" is "at their meet", its latest), never a second
// team; and stray letters typed on their own anywhere in a question ("what is t r best team"), not only at its end,
// are left out and said as not read. The clock is Nov 22 2026: the 2026–27 season has matches.
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
  const teams: [number, string, string, number][] = [
    [37032, "Rivers Edge Robotics", "MN", 120], [4215, "Hypnotic Robotics", "NJ", 150], [6980, "Bad Wolf", "NJ", 110], [30030, "Exodus", "TX", 140],
  ];
  for (const [n, name, state, rating] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (2026, ?, ?, 20, ?, 10, 10, 6, 4, 0)`, [n, rating - 20, rating]);
  }
  const ev = (code: string, name: string, state: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, ?, ?, 'LeagueMeet', 'Town', ?, 'USA', ?, ?, 't')", [code, name, state, start, start]);
  await ev("USMNBM1", "Bear Meet 1", "MN", "2026-11-07");
  await ev("USMNPLS", "Prior Lake Saturday", "MN", "2026-11-14");
  // Another state's meet, which 37032 never played: never the meet "their meet" names.
  await ev("USMOKAL", "Kaleidoscope Meet", "MO", "2026-11-15");
  let n = 0;
  const match = async (code: string, time: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [code, n, `Q${n}`, time, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, a]);
    }
  };
  // Bear Meet 1: 37032 wins one, loses one. Prior Lake Saturday, its latest: wins both.
  for (const code of ["USMNBM1", "USMNPLS"]) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, ?, 37032, 1)", [code]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2026, ?, 37032, 90, 2)", [code]);
  }
  await match("USMNBM1", "2026-11-07T10:00:00Z", 100, 80, [37032], [30030]);
  await match("USMNBM1", "2026-11-07T11:00:00Z", 60, 90, [37032], [30030]);
  await match("USMNPLS", "2026-11-14T10:00:00Z", 120, 70, [37032], [30030]);
  await match("USMNPLS", "2026-11-14T11:00:00Z", 130, 60, [37032], [30030]);
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, 'USMOKAL', 6980, 1)");
  await rebuildSearch();
  clearAllCaches();
  await refreshSearchSeason();
});

afterAll(() => {
  resetSearchSeason();
  vi.useRealTimers();
});

describe("a team's number said again before an event word (failed-search #2149)", () => {
  it("is the same team's own latest event, never a second team or another state's meet", async () => {
    const a = await full("What was 37032 record at 37032 meet");
    expect(a.understood?.kind).toBe("question");
    expect(a.understood?.label).toMatch(/^Rivers Edge Robotics \(37032\) · Record at Prior Lake Saturday/);
    expect(a.stat?.title).toBe("Record at Prior Lake Saturday");
    expect(a.stat?.none).toBeFalsy();
    // Said with "their" outright, the same answer.
    expect((await full("37032 record at their meet")).stat?.title).toBe("Record at Prior Lake Saturday");
  });
  it("two different numbers stay two teams", async () => {
    const a = await full("37032 record at 4215 meet");
    expect(a.stat?.title ?? "").not.toBe("Record at Prior Lake Saturday");
  });
});

describe("stray letters anywhere in a question (failed-search #2150)", () => {
  it("are left out, and said as not read", async () => {
    const clean = await full("what is the best team in the world right now");
    expect(clean.stat).toBeTruthy();
    const a = await full("What is t r best team in the world rn");
    expect(a.understood?.kind).toBe("question");
    expect(a.stat?.title).toBe(clean.stat!.title);
    expect(a.stat?.headline).toEqual(clean.stat!.headline);
    expect(a.understood?.unread).toEqual(["t", "r"]);
  });
  it("never a letter something reads, nor one beside a single word", async () => {
    // "u" is a short form ("you"); "a" and "i" are words.
    expect(await withoutStrayLetter("what is u best team in the world")).toBeNull();
    expect(await withoutStrayLetter("what is a best team in the world")).toBeNull();
    expect(await withoutStrayLetter("t opr")).toBeNull();
  });
});
