// Logged failed search #2334, "what is the best team rn and videos": videos asked for after the question with "and"
// (../searchAnswer.ts watchJoined). It is the question with the watch word after it, which the watch rules already read:
// the season's top team and its match videos, never "No team, event or match matched".
// The clock is Nov 22 2026: the 2026–27 season has matches.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer, watchJoined } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "./season";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // [number, name, rating]
  const teams: [number, string, number][] = [[30030, "Exodus", 150], [33333, "Lone Star", 110]];
  for (const [n, name, rating] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Austin', 'TX', 'USA', 2018)", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (2026, ?, ?, 20, 50, ?, 10, 10, 6, 4, 0)`, [n, rating - 20, rating]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, livestream, source) VALUES (2026, 'USTXAM1', 'Austin Meet 1', 'LeagueMeet', 'Austin', 'TX', 'USA', '2026-11-07', '2026-11-07', 'https://www.youtube.com/watch?v=Z2ArRHRiwh0', 't')");
  for (const [n, time] of [[1, "2026-11-07T10:00:00Z"], [2, "2026-11-07T11:00:00Z"]] as const) {
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, video, source)
      VALUES (2026, 'USTXAM1', 'qual', 0, ?, ?, ?, 1, 120, 120, 30, 80, 10, 50, 50, 10, 30, 10, 'https://www.youtube.com/watch?v=ruupjlPEQns', 't')`, [n, `Q${n}`, time]);
    for (const [t, a] of [[30030, "red"], [33333, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, 'USTXAM1', 'qual', 0, ?, ?, ?, 1)", [n, t, a]);
  }
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, 'USTXAM1', 30030, 1), (2026, 'USTXAM1', 33333, 2)");
  await rebuildSearch();
  clearAllCaches();
  await refreshSearchSeason();
});

afterAll(() => {
  resetSearchSeason();
  vi.useRealTimers();
});

describe("watchJoined", () => {
  it("takes out the 'and' joining a watch word onto the question's end", () => {
    expect(watchJoined("what is the best team rn and videos")).toBe("what is the best team rn videos");
  });
  it("keeps a question that ends in no watch word, and one whose words before already ask to watch", () => {
    expect(watchJoined("what is the best team rn")).toBe("what is the best team rn");
    expect(watchJoined("highlights and clips")).toBe("highlights and clips");
  });
});

describe("the best team right now and videos (#2334)", () => {
  it("answers as the question with the watch word after it: the top team and its match videos", async () => {
    const a = await full("what is the best team rn and videos");
    const b = await full("what is the best team rn videos");
    expect(a.step).not.toBe("recovery");
    expect(b.step).not.toBe("recovery");
    expect(a.stat?.intent).toBe(b.stat?.intent);
    expect(a.stat?.title).toBe(b.stat?.title);
    expect(a.understood?.label).toBe(b.understood?.label);
    expect(a.understood?.label).toContain("Exodus (30030)");
    expect(a.stat?.blocks.some((x) => x.kind === "videos" || x.kind === "matches")).toBe(true);
  });
});
